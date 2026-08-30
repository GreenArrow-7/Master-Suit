import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { notFound, redirect } from 'next/navigation';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import { leadCallContext } from '@/services/leads/callContext';
import { geminiCredential } from '@/lib/ai/gemini';
import LiveCallWorkspace from './LiveCallWorkspace';

export const metadata = { title: 'Live Call' };

export default async function LiveCallPage({
  params: paramsPromise,
}: {
  params: Promise<{ workspaceSlug: string; id: string }>;
}) {
  const params = await paramsPromise;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['calls', 'EDIT'] });

  const call = await prisma.call.findFirst({
    where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
    include: { caller: { select: { id: true, fullName: true } } },
  });
  if (!call) notFound();

  const scope = scopeFor(ctx, 'calls', 'EDIT');
  if (call.callerId !== ctx.actor.id && SCOPE_RANK[scope] < SCOPE_RANK.TEAM) notFound();

  // A finished call has no live session — its story lives on the detail page.
  if (!['SCHEDULED', 'RINGING', 'IN_PROGRESS'].includes(call.status)) {
    redirect(`/${params.workspaceSlug}/sales/calls/${call.id}`);
  }

  // The full pre-call briefing: profile, open requirement, last-call recap and
  // matching inventory — the same context the live coach prompt carries.
  const context = call.leadId ? await leadCallContext(ctx.tenantId, call.leadId) : null;
  // The workspace's own key when it has one, the deployment's otherwise — the
  // same resolution the coach itself uses, so the banner cannot contradict it.
  const credential = await geminiCredential(ctx.tenantId).catch(() => null);

  return (
    <LiveCallWorkspace
      call={{
        id: call.id,
        status: call.status,
        direction: call.direction,
        recipientNumber: call.recipientNumber,
        notes: call.notes,
        agentName: call.caller.fullName,
      }}
      context={context}
      hasGemini={Boolean(credential?.key)}
    />
  );
}
