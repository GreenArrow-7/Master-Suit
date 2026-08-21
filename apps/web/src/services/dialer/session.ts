/**
 * The auto-dialer.
 *
 * Two promises, and every design decision here serves one of them.
 *
 * **Dialer state survives a page refresh.** The agent's position is
 * `DialerSession.currentContactId` — a column. There is no client state to
 * lose, so a refresh, a closed laptop or a flat battery resumes exactly where
 * it stopped. `resumeOrStart` is what the screen calls on load and it is
 * idempotent.
 *
 * **No call is lost or double-dialled.** Four mechanisms, because one is not
 * enough:
 *   1. One ACTIVE session per agent, enforced by a partial unique index.
 *   2. The next contact is claimed with `FOR UPDATE SKIP LOCKED`, so two agents
 *      working one campaign are never handed the same person.
 *   3. A cooldown on the *number*, not the contact row — the same person can sit
 *      in two campaigns, and the phone does not care which list it came from.
 *   4. A stale-claim sweep, so a session that stopped answering releases what it
 *      was holding instead of stranding it forever.
 */
import { Conflict, Invalid, NotFound } from '@/lib/errors';
import { prisma, withTx, type TxClient } from '@/lib/db';
import { logger } from '@/lib/logger';

/** A session idle longer than this has its claim released. */
const STALE_AFTER_MS = 15 * 60_000;

/**
 * A campaign's list is called while the campaign is RUNNING, and not otherwise.
 *
 * Nothing enforced this. Both the dialer route and the dialer page selected the
 * campaign's `status` and neither read it, which is the shape of an intention
 * somebody wrote down and did not finish — so a COMPLETED or CANCELLED campaign
 * was worked exactly like a live one, and pressing Cancel stopped nothing on the
 * floor. That is the direction that matters: a campaign is cancelled *because*
 * somebody wants the calling to stop, and a control that only takes effect when
 * an agent happens to refresh is not a control.
 *
 * RUNNING and only RUNNING, because that is what the status machine already
 * means — `CampaignStatusActions` offers Start from DRAFT, Start now from
 * SCHEDULED and Resume from PAUSED, so every refusal below names a state whose
 * way out is one button on the campaign the agent came from. A dialer that
 * worked a DRAFT campaign was dialling a list nobody had started.
 *
 * Building the queue is deliberately *not* gated on RUNNING — see
 * services/dialer/queue.ts. A list is curated before the campaign starts, which
 * is the normal order of the work.
 */
const DIALLABLE_STATUS = 'RUNNING';

/**
 * What to tell somebody, per state. Written for the agent looking at the screen
 * rather than for the log: each says what happened and what would change it,
 * because "not available" sends a person to ask their manager.
 */
const NOT_DIALLABLE: Record<string, string> = {
  DRAFT: 'This campaign has not been started yet. Press Start on the campaign to open its dialer.',
  SCHEDULED: 'This campaign starts on its start date. Use “Start now” on the campaign to call its list before then.',
  PAUSED: 'This campaign is paused. Resume it on the campaign page to keep calling.',
  COMPLETED: 'This campaign is complete. Nobody else is being called from its list.',
  CANCELLED: 'This campaign was cancelled. Its list is not being called.',
};

/**
 * `null` when the campaign may be called, otherwise the reason it may not.
 *
 * Advisory: it is what the screen shows. The rule is *enforced* inside
 * `claimNext`'s statement, so a campaign cancelled between this read and the
 * claim still hands out nobody.
 */
export async function dialerRefusal(tenantId: string, campaignId: string): Promise<string | null> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, tenantId, deletedAt: null },
    select: { status: true },
  });
  if (!campaign) throw NotFound('Campaign');
  if (campaign.status === DIALLABLE_STATUS) return null;
  return NOT_DIALLABLE[campaign.status] ?? `This campaign is ${campaign.status.toLowerCase()} and is not being called.`;
}

export interface DialerPolicy {
  cooldownSeconds: number;
  maxAttempts: number;
}

export async function dialerPolicy(tenantId: string): Promise<DialerPolicy> {
  const setting = await prisma.organizationSetting.findUnique({
    where: { tenantId },
    select: { dialerCooldownSeconds: true, dialerMaxAttempts: true },
  });
  // The schema defaults apply to a workspace that has never opened settings.
  return {
    cooldownSeconds: setting?.dialerCooldownSeconds ?? 300,
    maxAttempts: setting?.dialerMaxAttempts ?? 4,
  };
}

/**
 * Claims the next eligible contact for a session.
 *
 * `FOR UPDATE SKIP LOCKED` is the whole point: two agents advancing at the same
 * instant each take a different row rather than blocking on each other or, far
 * worse, both reading the same PENDING row and both ringing it. SKIP rather
 * than NOWAIT so the second agent gets the *next* person instead of an error.
 *
 * The cooldown is applied in the same statement. Checking it afterwards would
 * leave a window in which the row is claimed, found ineligible, released — and
 * meanwhile a third agent skipped past it.
 *
 * The campaign's own status is checked here for the same reason, and it is the
 * reason it is checked *here* rather than in the two callers: a campaign
 * cancelled while an agent is mid-shift must hand out nobody on their very next
 * press, and a read-then-claim leaves exactly the window where it hands out one
 * more. Returning null rather than throwing is deliberate — `advance` has
 * already written the disposition of the call that just happened by the time it
 * asks for the next number, and losing a real call's outcome to enforce this
 * would be a worse trade than one extra dial.
 */
async function claimNext(
  tx: TxClient,
  tenantId: string,
  campaignId: string,
  sessionId: string,
  policy: DialerPolicy,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH candidate AS (
      SELECT c."id"
      FROM "CampaignContact" c
      WHERE c."tenantId" = ${tenantId}
        AND c."campaignId" = ${campaignId}
        AND c."status" IN ('PENDING', 'CALLBACK')
        AND c."claimedBySessionId" IS NULL
        -- The campaign is being called at all. Same statement as the claim, so
        -- a cancellation cannot race one more person onto somebody's screen.
        AND EXISTS (
          SELECT 1 FROM "Campaign" mc
          WHERE mc."id" = c."campaignId"
            AND mc."tenantId" = c."tenantId"
            AND mc."deletedAt" IS NULL
            AND mc."status" = ${DIALLABLE_STATUS}
        )
        AND (c."nextAttemptAt" IS NULL OR c."nextAttemptAt" <= NOW())
        AND c."attempts" < ${policy.maxAttempts}
        -- The cooldown, against the number rather than this row: the same
        -- person may sit in two campaigns, and the handset does not care which
        -- list the call came from.
        AND NOT EXISTS (
          SELECT 1 FROM "Call" k
          WHERE k."tenantId" = ${tenantId}
            AND k."recipientNumber" = c."phone"
            AND k."startedAt" > NOW() - make_interval(secs => ${policy.cooldownSeconds}::double precision)
        )
      ORDER BY c."position" ASC, c."id" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "CampaignContact" t
    SET "status" = 'IN_PROGRESS',
        "claimedBySessionId" = ${sessionId},
        "claimedAt" = NOW(),
        "updatedAt" = NOW()
    FROM candidate
    WHERE t."id" = candidate."id"
    RETURNING t."id"
  `;

  return rows[0]?.id ?? null;
}

/** Releases whatever a session is holding, without deciding an outcome. */
async function releaseClaim(tx: TxClient, tenantId: string, sessionId: string) {
  await tx.campaignContact.updateMany({
    where: { tenantId, claimedBySessionId: sessionId, status: 'IN_PROGRESS' },
    data: { status: 'PENDING', claimedBySessionId: null, claimedAt: null },
  });
}

/**
 * Frees contacts held by sessions that stopped answering.
 *
 * A closed laptop must not strand a person at the front of the queue. Run on
 * every start and every advance rather than on a schedule: the only moment the
 * answer matters is when somebody is asking for the next number.
 */
export async function sweepStaleClaims(tenantId: string, campaignId: string): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);

  const stale = await prisma.dialerSession.findMany({
    where: { tenantId, campaignId, status: 'ACTIVE', lastActivityAt: { lt: cutoff } },
    select: { id: true },
    take: 100,
  });
  if (stale.length === 0) return 0;

  return withTx(tenantId, async (tx) => {
    const ids = stale.map((s) => s.id);
    const { count } = await tx.campaignContact.updateMany({
      where: { tenantId, claimedBySessionId: { in: ids }, status: 'IN_PROGRESS' },
      data: { status: 'PENDING', claimedBySessionId: null, claimedAt: null },
    });
    await tx.dialerSession.updateMany({
      where: { tenantId, id: { in: ids } },
      data: { status: 'ENDED', endedAt: new Date(), currentContactId: null, currentCallId: null },
    });
    logger.info({ sessions: ids.length, released: count }, 'dialer: stale sessions reaped');
    return count;
  });
}

export interface SessionView {
  session: {
    id: string;
    campaignId: string;
    status: string;
    dialed: number;
    connected: number;
    skipped: number;
    callbacks: number;
    startedAt: Date;
  };
  contact: {
    id: string;
    displayName: string | null;
    phone: string;
    leadId: string | null;
    attempts: number;
    notes: string | null;
  } | null;
  currentCallId: string | null;
  remaining: number;
  /**
   * Why there is no contact, when the reason is not "the queue is empty".
   *
   * Without it the console says “Queue empty · nobody is eligible right now” to
   * an agent whose campaign was cancelled thirty seconds ago — which is a true
   * sentence about the query and a false one about the world.
   */
  blockedBy: string | null;
}

async function view(tenantId: string, sessionId: string): Promise<SessionView> {
  const session = await prisma.dialerSession.findFirst({ where: { id: sessionId, tenantId } });
  if (!session) throw NotFound('Dialer session');

  const [contact, remaining, blockedBy] = await Promise.all([
    session.currentContactId
      ? prisma.campaignContact.findFirst({
          where: { id: session.currentContactId, tenantId },
          select: { id: true, displayName: true, phone: true, leadId: true, attempts: true, notes: true },
        })
      : null,
    prisma.campaignContact.count({
      where: { tenantId, campaignId: session.campaignId, status: { in: ['PENDING', 'CALLBACK'] } },
    }),
    dialerRefusal(tenantId, session.campaignId),
  ]);

  return {
    session: {
      id: session.id,
      campaignId: session.campaignId,
      status: session.status,
      dialed: session.dialed,
      connected: session.connected,
      skipped: session.skipped,
      callbacks: session.callbacks,
      startedAt: session.startedAt,
    },
    contact,
    currentCallId: session.currentCallId,
    remaining,
    blockedBy,
  };
}

/**
 * What the dialer screen calls on load, every load.
 *
 * Idempotent by construction: an agent who already has a live session on this
 * campaign gets it back, holding the same contact. An agent with a live session
 * on a *different* campaign is refused rather than silently switched — two
 * queues open at once is exactly the state the one-active-session index exists
 * to prevent, and switching for them would abandon whoever they were mid-call
 * with.
 */
export async function resumeOrStart(tenantId: string, userId: string, campaignId: string): Promise<SessionView> {
  // Before anything is created. `claimNext` would hand out nobody anyway, but a
  // session opened on a cancelled campaign and reporting an empty queue tells
  // the agent the wrong thing and leaves a row behind saying they started a
  // shift on it.
  const refusal = await dialerRefusal(tenantId, campaignId);
  if (refusal) throw Conflict(refusal);

  await sweepStaleClaims(tenantId, campaignId);

  const existing = await prisma.dialerSession.findFirst({
    where: { tenantId, userId, status: 'ACTIVE' },
    select: { id: true, campaignId: true },
  });

  if (existing && existing.campaignId !== campaignId) {
    throw Conflict('You already have a dialer running on another campaign. End it before starting this one.');
  }
  if (existing) {
    const resumed = await ensureContact(tenantId, existing.id, campaignId);
    return resumed;
  }

  const session = await withTx(tenantId, async (tx) =>
    tx.dialerSession.create({ data: { tenantId, userId, campaignId } }),
  );

  return ensureContact(tenantId, session.id, campaignId);
}

/** Gives a session a contact if it has none, and returns the view either way. */
async function ensureContact(tenantId: string, sessionId: string, campaignId: string): Promise<SessionView> {
  const current = await prisma.dialerSession.findFirstOrThrow({
    where: { id: sessionId, tenantId },
    select: { currentContactId: true },
  });

  if (!current.currentContactId) {
    const policy = await dialerPolicy(tenantId);
    await withTx(tenantId, async (tx) => {
      const contactId = await claimNext(tx, tenantId, campaignId, sessionId, policy);
      await tx.dialerSession.update({
        where: { id: sessionId, tenantId },
        data: { currentContactId: contactId, currentCallId: null, lastActivityAt: new Date() },
      });
    });
  }

  return view(tenantId, sessionId);
}

export type AdvanceAction = 'next' | 'skip' | 'callback';

export interface AdvanceInput {
  tenantId: string;
  userId: string;
  sessionId: string;
  action: AdvanceAction;
  /** The disposition, for `next`. What actually happened on the call. */
  outcome?: string;
  /** When to ring back, for `callback`. */
  callbackAt?: Date;
  notes?: string;
}

/**
 * Finish the contact in front of the agent, and hand them the next one.
 *
 * One endpoint for all three ways a contact ends, because the sequence is
 * identical and only the disposition differs — separate endpoints would be
 * three copies of the claim-and-advance dance, and the third copy is where the
 * release gets forgotten.
 */
export async function advance(input: AdvanceInput): Promise<SessionView> {
  const policy = await dialerPolicy(input.tenantId);

  await withTx(input.tenantId, async (tx) => {
    const session = await tx.dialerSession.findFirst({
      where: { id: input.sessionId, tenantId: input.tenantId, userId: input.userId },
    });
    if (!session) throw NotFound('Dialer session');
    if (session.status !== 'ACTIVE') throw Conflict('This dialer session has ended.');

    if (session.currentContactId) {
      const contact = await tx.campaignContact.findFirst({
        where: { id: session.currentContactId, tenantId: input.tenantId },
        select: { id: true, attempts: true },
      });

      if (contact) {
        const attempts = contact.attempts + (input.action === 'skip' ? 0 : 1);

        // Skipping is not an attempt. An agent passing on a row because they
        // recognise the name must not burn one of the four tries the number
        // gets, or a campaign quietly exhausts its own list.
        const status =
          input.action === 'skip'
            ? 'SKIPPED'
            : input.action === 'callback'
              ? 'CALLBACK'
              : attempts >= policy.maxAttempts && !CONNECTED_OUTCOMES.has(input.outcome ?? '')
                ? 'EXHAUSTED'
                : CONNECTED_OUTCOMES.has(input.outcome ?? '')
                  ? 'COMPLETED'
                  : 'PENDING';

        await tx.campaignContact.update({
          where: { id: contact.id, tenantId: input.tenantId },
          data: {
            status,
            attempts,
            lastAttemptAt: input.action === 'skip' ? undefined : new Date(),
            // A retry waits out the cooldown; a callback waits for the time the
            // client asked for.
            nextAttemptAt:
              input.action === 'callback'
                ? (input.callbackAt ?? new Date(Date.now() + 3_600_000))
                : status === 'PENDING'
                  ? new Date(Date.now() + policy.cooldownSeconds * 1000)
                  : null,
            outcome: input.outcome as never,
            lastCallId: session.currentCallId,
            notes: input.notes ?? undefined,
            claimedBySessionId: null,
            claimedAt: null,
          },
        });
      }
    }

    const contactId = await claimNext(tx, input.tenantId, session.campaignId, session.id, policy);

    await tx.dialerSession.update({
      where: { id: session.id, tenantId: input.tenantId },
      data: {
        currentContactId: contactId,
        currentCallId: null,
        lastActivityAt: new Date(),
        dialed: input.action === 'next' ? { increment: 1 } : undefined,
        connected: CONNECTED_OUTCOMES.has(input.outcome ?? '') ? { increment: 1 } : undefined,
        skipped: input.action === 'skip' ? { increment: 1 } : undefined,
        callbacks: input.action === 'callback' ? { increment: 1 } : undefined,
      },
    });
  });

  return view(input.tenantId, input.sessionId);
}

/** Outcomes that mean a human actually spoke. Everything else is a retry. */
const CONNECTED_OUTCOMES = new Set([
  'CONNECTED',
  'INTERESTED',
  'NOT_INTERESTED',
  'QUALIFIED',
  'CONVERTED',
  'CALLBACK_REQUESTED',
  'WRONG_NUMBER',
]);

/** Records the call the agent just placed against the session and the contact. */
export async function attachCall(tenantId: string, sessionId: string, callId: string, userId: string) {
  return withTx(tenantId, async (tx) => {
    const session = await tx.dialerSession.findFirst({
      where: { id: sessionId, tenantId, userId, status: 'ACTIVE' },
      select: { id: true, currentContactId: true },
    });
    if (!session) throw NotFound('Dialer session');
    if (!session.currentContactId) {
      throw Invalid([{ field: 'session', code: 'no_contact', message: 'There is nobody in front of you to call.' }]);
    }

    await tx.dialerSession.update({
      where: { id: session.id, tenantId },
      data: { currentCallId: callId, lastActivityAt: new Date() },
    });
    return { sessionId: session.id, contactId: session.currentContactId, callId };
  });
}

export async function endSession(tenantId: string, sessionId: string, userId: string): Promise<void> {
  await withTx(tenantId, async (tx) => {
    const session = await tx.dialerSession.findFirst({
      where: { id: sessionId, tenantId, userId },
      select: { id: true, status: true },
    });
    if (!session) throw NotFound('Dialer session');
    if (session.status === 'ENDED') return;

    // Released before the session closes, so the person the agent was looking
    // at goes back to the front of the queue rather than waiting for the sweep.
    await releaseClaim(tx, tenantId, session.id);
    await tx.dialerSession.update({
      where: { id: session.id, tenantId },
      data: { status: 'ENDED', endedAt: new Date(), currentContactId: null, currentCallId: null },
    });
  });
}

/**
 * A leader ending somebody else's session.
 *
 * Separate from `endSession` because it takes no userId: the whole point is
 * acting on a session that is not yours, and giving the ordinary path an
 * optional userId is how that check gets skipped by accident.
 */
export async function endSessionAsLeader(tenantId: string, sessionId: string): Promise<void> {
  await withTx(tenantId, async (tx) => {
    const session = await tx.dialerSession.findFirst({ where: { id: sessionId, tenantId }, select: { id: true } });
    if (!session) throw NotFound('Dialer session');
    await releaseClaim(tx, tenantId, session.id);
    await tx.dialerSession.update({
      where: { id: session.id, tenantId },
      data: { status: 'ENDED', endedAt: new Date(), currentContactId: null, currentCallId: null },
    });
  });
}

/**
 * The live session for one agent on one campaign, or null.
 *
 * A read, deliberately: the dialer *page* uses this rather than `resumeOrStart`,
 * because starting a shift is something an agent chooses, not something a URL
 * does to them. Rendering the page must not claim a contact.
 */
export async function activeSessionFor(
  tenantId: string,
  userId: string,
  campaignId: string,
): Promise<SessionView | null> {
  const session = await prisma.dialerSession.findFirst({
    where: { tenantId, userId, campaignId, status: 'ACTIVE' },
    select: { id: true },
  });
  return session ? view(tenantId, session.id) : null;
}

/** Live sessions on a campaign, for the leader watching the floor. */
export async function teamSessions(tenantId: string, campaignId: string) {
  const sessions = await prisma.dialerSession.findMany({
    where: { tenantId, campaignId, status: 'ACTIVE' },
    orderBy: { startedAt: 'asc' },
    take: 100,
  });
  if (sessions.length === 0) return [];

  const [users, contacts] = await Promise.all([
    prisma.user.findMany({
      where: { tenantId, id: { in: sessions.map((s) => s.userId) } },
      select: { id: true, fullName: true },
    }),
    prisma.campaignContact.findMany({
      where: {
        tenantId,
        id: { in: sessions.map((s) => s.currentContactId).filter((v): v is string => Boolean(v)) },
      },
      select: { id: true, displayName: true, phone: true },
    }),
  ]);

  const name = new Map(users.map((u) => [u.id, u.fullName]));
  const onNow = new Map(contacts.map((c) => [c.id, c]));

  return sessions.map((s) => ({
    id: s.id,
    agent: name.get(s.userId) ?? s.userId,
    startedAt: s.startedAt,
    lastActivityAt: s.lastActivityAt,
    dialed: s.dialed,
    connected: s.connected,
    skipped: s.skipped,
    callbacks: s.callbacks,
    onNow: s.currentContactId ? (onNow.get(s.currentContactId) ?? null) : null,
    /** No advance in a while: the agent may have walked away. */
    idleMinutes: Math.floor((Date.now() - s.lastActivityAt.getTime()) / 60_000),
  }));
}

export { view as sessionView };
