import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound, Invalid } from '@/lib/errors';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import { demoScript, coachTick, heuristicHints } from '@/lib/ai/liveCoach';
import { analyseAndAudit } from '@/services/shared/callIntelligence';
import { logger } from '@/lib/logger';

const params = z.object({ id: z.string().cuid() });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The live-call stream: Server-Sent Events carrying transcript segments,
 * coaching hints and status changes for the live workspace.
 *
 * Today the only transport is the demo simulation — a scripted conversation
 * replayed in real time, coached by Gemini when GEMINI_API_KEY is set and by
 * the built-in heuristics otherwise. A telephony vendor's media stream would
 * plug in at the same seam: replace the script iterator with the vendor's
 * streaming-STT segments and everything downstream (coach ticks, finalise,
 * analysis, audit) is already wired.
 *
 * Finalisation is idempotent and runs on script completion or client abort:
 * the call is marked COMPLETED with its duration, the transcript is stored,
 * and the standard analyse → audit chain runs inline so the workspace shows a
 * full call audit moments after hanging up, without requiring a worker.
 */
export const GET = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params },
  async ({ ctx, params, req }) => {
    const call = await prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!call) throw NotFound('Call');

    const scope = scopeFor(ctx, 'calls', 'EDIT');
    if (call.callerId !== ctx.actor.id && SCOPE_RANK[scope] < SCOPE_RANK.TEAM) throw NotFound('Call');

    if (!['SCHEDULED', 'RINGING', 'IN_PROGRESS'].includes(call.status)) {
      throw Invalid([
        { field: 'status', code: 'not_live', message: `A ${call.status.toLowerCase()} call has no live session.` },
      ]);
    }

    const [lead, agent] = await Promise.all([
      call.leadId
        ? prisma.lead.findFirst({ where: { tenantId: ctx.tenantId, id: call.leadId }, select: { fullName: true } })
        : null,
      prisma.user.findFirst({ where: { tenantId: ctx.tenantId, id: call.callerId }, select: { fullName: true } }),
    ]);

    // The demo session assumes verbal consent, records that assumption, and
    // says so in the workspace banner. Real vendors go through the existing
    // consent endpoints before dialling.
    await prisma.recordingConsent.upsert({
      where: { callId: call.id, tenantId: ctx.tenantId },
      create: {
        tenantId: ctx.tenantId,
        callId: call.id,
        consentGiven: true,
        method: 'VERBAL',
        consentedBy: 'Demo simulation — verbal consent assumed at session start',
        givenAt: new Date(),
      },
      update: {},
    });

    const startedAt = new Date();
    await prisma.call.update({
      where: { id: call.id, tenantId: ctx.tenantId },
      data: { status: 'IN_PROGRESS', startedAt, answeredAt: startedAt, providerName: 'demo-simulation' },
    });

    const script = demoScript(agent?.fullName ?? 'The agent', lead?.fullName ?? 'the client');
    const tenantId = ctx.tenantId;
    const callId = call.id;

    let finalised = false;
    const spoken: string[] = [];

    async function finalise(reason: 'completed' | 'aborted') {
      if (finalised) return;
      finalised = true;
      try {
        const endedAt = new Date();
        const durationSecs = Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
        const content = spoken.join('\n');

        await prisma.call.update({
          where: { id: callId, tenantId },
          data: {
            status: 'COMPLETED',
            endedAt,
            durationSecs,
            ...(reason === 'completed' ? { outcome: 'CONNECTED' } : {}),
          },
        });

        if (content.length > 0) {
          await prisma.transcript.upsert({
            where: { callId, tenantId },
            create: {
              tenantId,
              callId,
              content,
              language: 'en',
              provider: 'demo-simulation',
              wordCount: content.split(/\s+/).filter(Boolean).length,
            },
            update: { content, provider: 'demo-simulation', wordCount: content.split(/\s+/).filter(Boolean).length },
          });

          // Inline analyse → audit: no worker required for the demo loop, and
          // both steps are claim-guarded so a running worker cannot double-fire.
          await analyseAndAudit(tenantId, callId);
        }
      } catch (err) {
        logger.error({ err: (err as Error).message, callId }, 'live call finalise failed');
      }
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        const aborted = () => req.signal.aborted;
        req.signal.addEventListener('abort', () => void finalise('aborted'));

        send({ type: 'status', status: 'IN_PROGRESS', startedAt: startedAt.toISOString() });
        send({
          type: 'coach',
          kind: 'COMPLIANCE',
          text: 'Open with the recording disclosure, your name and the reason for the call.',
          source: 'simulated',
          at: 0,
        });

        try {
          for (let i = 0; i < script.length; i++) {
            if (aborted()) break;

            const turn = script[i];
            // Reading pace: proportional to line length, clamped to feel live.
            await sleep(Math.min(4200, Math.max(1500, turn.text.length * 45)));
            if (aborted()) break;

            const at = Math.round((Date.now() - startedAt.getTime()) / 1000);
            spoken.push(`${turn.speaker}: ${turn.text}`);
            send({ type: 'segment', speaker: turn.speaker, text: turn.text, at });

            // Coach after each customer turn, on a rolling window. Heuristics
            // answer instantly; Gemini (when configured) adds model hints.
            if (turn.speaker === 'Customer') {
              const window = spoken.slice(-6).join('\n');
              const instant = heuristicHints(turn.text);
              for (const hint of instant) send({ type: 'coach', ...hint, at });
              // The workspace's own key when it has one, the deployment's
              // otherwise — `coachTick` degrades to heuristics with neither.
              if (i % 4 === 3) {
                const hints = await coachTick(window, ctx.tenantId);
                for (const hint of hints.filter((h) => h.source === 'gemini')) send({ type: 'coach', ...hint, at });
              }
            }
          }

          if (!aborted()) {
            send({ type: 'status', status: 'WRAPPING_UP' });
            await finalise('completed');
            send({ type: 'done', callId });
          }
        } catch (err) {
          logger.error({ err: (err as Error).message, callId }, 'live call stream error');
          await finalise('aborted');
        } finally {
          try {
            controller.close();
          } catch {
            /* already closed by abort */
          }
        }
      },
      cancel() {
        void finalise('aborted');
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  },
);
