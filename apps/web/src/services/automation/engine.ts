import { ulid } from 'ulid';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { enqueue } from '@/lib/queue';
import { ctxForUser } from '@/lib/auth/session';
import { automationGraph, findNode, type AutomationGraph } from './graph';
import { evaluateFilterNode } from './evaluateFilter';
import { runAction } from './actions';
import { isAutomationObjectType, loadRecord, type AutomationObjectType } from './records';

/**
 * "record.created" / "record.updated" / etc. fired by service-layer domain events,
 * after commit. Finds every published automation on this object whose trigger spec
 * matches, and enrolls the record — one AutomationEnrollment per record per
 * automation, unless allowReEnrollment.
 *
 * ponytail: suppression rules, quiet hours, and concurrencyLimit from
 * docs/04-AUTOMATION-ENGINE.md §4 aren't enforced yet — every match enrolls
 * immediately. Add the checks here when a workflow needs them.
 */
export async function enrollMatchingAutomations(tenantId: string, event: string, object: string, recordId: string) {
  if (!isAutomationObjectType(object)) return;

  const automations = await prisma.automation.findMany({
    where: { tenantId, objectType: object, state: 'PUBLISHED', deletedAt: null, activeVersionId: { not: { equals: null } } },
    include: { versions: true },
  });

  for (const automation of automations) {
    const version = automation.versions.find((v) => v.id === automation.activeVersionId);
    if (!version) continue;

    const triggerSpec = version.triggerSpec as { event?: string };
    if (triggerSpec.event !== event) continue;

    if (!automation.allowReEnrollment) {
      const existing = await prisma.automationEnrollment.findFirst({
        where: { tenantId, automationId: automation.id, recordId },
      });
      if (existing) continue;
    }

    const graph = automationGraph.safeParse(version.graph);
    if (!graph.success) {
      logger.error({ automationId: automation.id, versionId: version.id, err: graph.error }, 'automation graph failed validation');
      continue;
    }

    const enrollment = await prisma.automationEnrollment.create({
      data: {
        tenantId, automationId: automation.id, versionId: version.id,
        objectType: object, recordId, currentNodeId: graph.data.entry,
      },
    });

    await enqueue('automation', 'run-node', { tenantId, enrollmentId: enrollment.id });
  }
}

/**
 * Executes exactly one node of one enrollment, per docs/04-AUTOMATION-ENGINE.md §4
 * ("step-at-a-time"). Persists the new currentNodeId and an AutomationExecution
 * row, then enqueues the next node — a crash between steps loses at most one node.
 */
export async function runEnrollmentNode(tenantId: string, enrollmentId: string) {
  const enrollment = await prisma.automationEnrollment.findFirst({
    where: { tenantId, id: enrollmentId },
    include: { automation: true, version: true },
  });
  if (!enrollment || enrollment.status !== 'ACTIVE') return;
  if (!enrollment.currentNodeId) return exit(tenantId, enrollment.id, 'no_current_node');
  if (!isAutomationObjectType(enrollment.objectType)) return exit(tenantId, enrollment.id, 'unsupported_object_type');

  const graph = automationGraph.safeParse(enrollment.version.graph);
  if (!graph.success) return exit(tenantId, enrollment.id, 'invalid_graph');

  const node = findNode(graph.data, enrollment.currentNodeId);
  if (!node) return exit(tenantId, enrollment.id, 'node_not_found');

  const record = await loadRecord(tenantId, enrollment.objectType, enrollment.recordId);
  if (!record) return exit(tenantId, enrollment.id, 'record_not_found');

  if (!enrollment.automation.createdById) return exit(tenantId, enrollment.id, 'no_owning_user');
  const ctx = await ctxForUser(enrollment.automation.createdById, tenantId, ulid());

  const started = Date.now();
  const execution = await prisma.automationExecution.create({
    data: { tenantId, enrollmentId: enrollment.id, nodeId: node.id, nodeType: node.type, status: 'RUNNING' },
  });

  try {
    let nextNodeId: string | null | undefined;

    switch (node.type) {
      case 'trigger':
        nextNodeId = node.next;
        break;

      case 'condition': {
        const matched = evaluateFilterNode(node.spec.filter, record);
        nextNodeId = matched ? node.branches.true : node.branches.false;
        break;
      }

      case 'action':
        await runAction({ ctx, objectType: enrollment.objectType, recordId: enrollment.recordId, spec: node.spec });
        nextNodeId = node.next;
        break;

      case 'wait': {
        const resumeAt = new Date(Date.now() + node.spec.durationMinutes * 60_000);
        await prisma.automationEnrollment.update({
          where: { tenantId, id: enrollment.id },
          data: { status: 'WAITING', currentNodeId: node.next ?? null, resumeAt },
        });
        await prisma.automationExecution.update({
          where: { tenantId, id: execution.id },
          data: { status: 'SUCCEEDED', finishedAt: new Date(), durationMs: Date.now() - started },
        });
        await enqueue('automation', 'run-node', { tenantId, enrollmentId: enrollment.id }, { delayMs: node.spec.durationMinutes * 60_000 });
        return;
      }

      case 'stop':
        await prisma.automationExecution.update({
          where: { tenantId, id: execution.id },
          data: { status: 'SUCCEEDED', finishedAt: new Date(), durationMs: Date.now() - started },
        });
        return exit(tenantId, enrollment.id, 'stop_node', 'COMPLETED');
    }

    await prisma.automationExecution.update({
      where: { tenantId, id: execution.id },
      data: { status: 'SUCCEEDED', finishedAt: new Date(), durationMs: Date.now() - started },
    });

    if (!nextNodeId) return exit(tenantId, enrollment.id, 'graph_end', 'COMPLETED');

    await prisma.automationEnrollment.update({ where: { tenantId, id: enrollment.id }, data: { currentNodeId: nextNodeId } });
    await enqueue('automation', 'run-node', { tenantId, enrollmentId: enrollment.id });
  } catch (err) {
    logger.error({ err, enrollmentId: enrollment.id, nodeId: node.id }, 'automation node failed');
    await prisma.automationExecution.update({
      where: { tenantId, id: execution.id },
      data: { status: 'FAILED', finishedAt: new Date(), durationMs: Date.now() - started, errorMessage: err instanceof Error ? err.message : String(err) },
    });
    throw err; // let BullMQ's retry policy (queue.ts RETRY.automation) handle re-attempts
  }
}

async function exit(tenantId: string, enrollmentId: string, reason: string, status: 'COMPLETED' | 'EXITED' = 'EXITED') {
  await prisma.automationEnrollment.update({
    where: { tenantId, id: enrollmentId },
    data: { status, exitReason: reason, completedAt: new Date() },
  });
}
