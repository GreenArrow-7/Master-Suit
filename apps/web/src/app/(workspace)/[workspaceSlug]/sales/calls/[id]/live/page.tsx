import { requirePageAccess } from '@/lib/workspace-page';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { prisma } from '@/lib/db';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { callScope } from '@/lib/security/record-scope';
import { leadCallContext } from '@/services/leads/callContext';
import { geminiCredential } from '@/lib/ai/gemini';
import { env } from '@/lib/env';
import { resolveTelephony } from '@/lib/integrations/telephony/resolve';
import { liveAudioMode } from '@/lib/integrations/telephony/liveAudio';
import { loadFieldRules } from '@/lib/security/fieldSecurity';
import { asLeadPhone } from '@/services/leads/createLead';
import { workspaceTimezone } from '@/services/hr/attendance';
import LiveCallWorkspace from './LiveCallWorkspace';

export const metadata = { title: 'Live Call' };

export default async function LiveCallPage({
  params: paramsPromise,
}: {
  params: Promise<{ workspaceSlug: string; id: string }>;
}) {
  const params = await paramsPromise;
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['calls', 'EDIT'] });

  // The live routes' rule (calls EDIT): outside the caller's scope is not found.
  const call = await prisma.call.findFirst({
    where: { ...(await callScope(ctx, 'EDIT')), id: params.id, deletedAt: null },
    include: { caller: { select: { id: true, fullName: true } }, consent: true },
  });
  if (!call) notFound();

  // A finished call has no live session — its story lives on the detail page.
  // Under whichever product the viewer came through: a Real Estate or Lead Eagle
  // workspace does not own Sales, so a hard-coded /sales/ would redirect into a
  // refusal.
  if (!['SCHEDULED', 'RINGING', 'IN_PROGRESS'].includes(call.status)) {
    const path = (await headers()).get('x-pathname') ?? '';
    const product = path.includes('/realty/') ? 'realty' : path.includes('/lead-eagle/') ? 'lead-eagle' : 'sales';
    redirect(`/${params.workspaceSlug}/${product}/calls/${call.id}`);
  }

  // The full pre-call briefing: profile, open requirement, last-call recap and
  // matching inventory — the same context the live coach prompt carries.
  const context = call.leadId ? await leadCallContext(ctx.tenantId, call.leadId) : null;
  // The lead's number, here and as the number the call goes to, reads as the
  // lead's phone does for this role. Placing the call still works when it is
  // masked: the provider dials the stored number, server-side.
  const leadRules = call.leadId ? await loadFieldRules(ctx, 'LEAD') : null;
  if (context && leadRules) context.lead.phone = asLeadPhone(ctx, leadRules, context.lead.phone);
  // The workspace's own key when it has one, the deployment's otherwise — the
  // same resolution the coach itself uses, so the banner cannot contradict it.
  const credential = await geminiCredential(ctx.tenantId).catch(() => null);
  // The workspace's calling provider, if one is connected: whether it can fork
  // live audio decides what this screen promises. Not connected is a state,
  // not an error, here.
  const telephony = await resolveTelephony(ctx.tenantId).catch(() => null);
  const liveAudio = liveAudioMode(telephony?.provider.capabilities, env.LIVE_STREAM_WS_URL || undefined);
  const consented = Boolean(call.consent?.consentGiven && !call.consent.withdrawnAt);

  // A call placed through a real vendor is displayed, not simulated: the
  // realtime engine produces its events and this page only shows them.
  const transport =
    call.externalCallId && call.providerName && !['demo-simulation', 'live-mic'].includes(call.providerName)
      ? ('vendor' as const)
      : ('demo' as const);

  return (
    <LiveCallWorkspace
      call={{
        id: call.id,
        status: call.status,
        direction: call.direction,
        recipientNumber: leadRules ? asLeadPhone(ctx, leadRules, call.recipientNumber) : call.recipientNumber,
        notes: call.notes,
        agentName: call.caller.fullName,
      }}
      transport={transport}
      liveAudio={liveAudio}
      vendor={telephony?.vendor ?? null}
      placed={Boolean(call.externalCallId)}
      consented={consented}
      context={context}
      hasGemini={Boolean(credential?.key)}
      timeZone={await workspaceTimezone(ctx)}
    />
  );
}
