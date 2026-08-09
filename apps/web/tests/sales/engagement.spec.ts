import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { createPost, editPost, feed, moderatePost, react } from '@/services/engagement/feed';
import { canTransition, createContest, decideContest, leaderboard } from '@/services/engagement/contests';
import { closeCategory, nominate, results, vote } from '@/services/engagement/nominations';
import { randomBytes } from 'node:crypto';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { Ctx, Scope } from '@/lib/security/rbac';

/**
 * M11 — the feed, contests and awards.
 *
 * The properties worth pinning are the ones people argue about afterwards: that
 * a post taken down says who and why, that a closed contest's result cannot
 * change, and that a tie is reported as a tie rather than resolved by sort
 * order.
 */
let fixture: Fixture;
let member: Ctx;
let colleague: Ctx;
let moderator: Ctx;
let eventId = '';
let teamId = '';
let projectId = '';

const D = (n: number) => new Prisma.Decimal(n);
const suffix = randomBytes(4).toString('hex');

const perms = (extra: [string, Scope][] = []) =>
  new Map<string, Scope>([
    ['posts:VIEW', 'ORGANIZATION'],
    ['posts:CREATE', 'ORGANIZATION'],
    ['posts:EDIT', 'ORGANIZATION'],
    ['contests:VIEW', 'ORGANIZATION'],
    ['reports:VIEW', 'ORGANIZATION'],
    ...extra,
  ]);

beforeAll(async () => {
  fixture = await seedTwoTenants();
  const T = fixture.a.tenantId;

  member = buildCtx(buildActor({ id: fixture.a.userId, tenantId: T, permissions: perms() }));

  // Real User rows: nominating somebody checks they exist, which is the point.
  const seed = await prisma.user.findFirstOrThrow({ where: { tenantId: T }, select: { roleId: true } });
  const makeUser = async (label: string) =>
    prisma.user.create({
      data: {
        tenantId: T,
        email: `${label}-${suffix}@engagement.test`,
        fullName: label,
        roleId: seed.roleId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });

  const colleagueUser = await makeUser('Colleague');
  colleague = buildCtx(buildActor({ id: colleagueUser.id, tenantId: T, permissions: perms() }));

  const moderatorUser = await makeUser('Moderator');
  moderator = buildCtx(
    buildActor({
      id: moderatorUser.id,
      tenantId: T,
      permissions: perms([
        ['posts:DELETE', 'ORGANIZATION'],
        ['contests:CREATE', 'ORGANIZATION'],
        ['contests:EDIT', 'ORGANIZATION'],
      ]),
    }),
  );

  const event = await prisma.event.create({
    data: {
      tenantId: T,
      title: 'Summer offsite',
      startAt: new Date('2026-08-20T09:00:00Z'),
      endAt: new Date('2026-08-20T18:00:00Z'),
    },
  });
  eventId = event.id;

  const team = await prisma.team.create({
    data: { tenantId: T, name: 'Contest team', code: `ct-${Math.random().toString(36).slice(2, 7)}` },
  });
  teamId = team.id;

  const project = await prisma.project.create({
    data: { tenantId: T, name: 'Contest project', code: `CP-${Math.random().toString(36).slice(2, 7)}` },
  });
  projectId = project.id;
});

const clear = async () => {
  for (const tenantId of [fixture.a.tenantId, fixture.b.tenantId]) {
    await prisma.nominationVote.deleteMany({ where: { tenantId } });
    await prisma.nomination.deleteMany({ where: { tenantId } });
    await prisma.contestStanding.deleteMany({ where: { tenantId } });
    await prisma.contest.deleteMany({ where: { tenantId } });
    await prisma.postReaction.deleteMany({ where: { tenantId } });
    await prisma.post.deleteMany({ where: { tenantId } });
    await prisma.booking.deleteMany({ where: { tenantId } });
  }
};

beforeEach(clear);

afterAll(async () => {
  await clear();
  const T = fixture.a.tenantId;
  await prisma.event.deleteMany({ where: { tenantId: T } });
  await prisma.user.deleteMany({ where: { tenantId: T, email: { contains: `-${suffix}@engagement.test` } } });
  await prisma.userTeam.deleteMany({ where: { tenantId: T, teamId } });
  await prisma.team.deleteMany({ where: { tenantId: T } });
  await prisma.project.deleteMany({ where: { tenantId: T } });
  await fixture.cleanup();
});

describe('the feed', () => {
  it('refuses a post with nothing in it', async () => {
    await expect(createPost({ ctx: member, body: '   ' })).rejects.toMatchObject({ status: 422 });
  });

  it('refuses a clip that is both uploaded and linked', async () => {
    await expect(
      createPost({ ctx: member, body: 'Look at this', videoKey: 'k/1.mp4', videoUrl: 'https://example.com/v' }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('will not let an ordinary member pin their own post to the top', async () => {
    // Pinning holds a post above everyone else's; that is a leadership act.
    await expect(createPost({ ctx: member, body: 'Read me first', isPinned: true })).rejects.toMatchObject({
      status: 403,
    });
    const pinned = await createPost({ ctx: moderator, body: 'Read me first', isPinned: true });
    expect(pinned.isPinned).toBe(true);
  });

  it('puts pinned posts above newer ones', async () => {
    await createPost({ ctx: moderator, body: 'Notice', isPinned: true });
    await createPost({ ctx: member, body: 'Something newer' });

    const rows = await feed(member);
    expect(rows[0].body).toBe('Notice');
  });

  it('lets only the author rewrite their words', async () => {
    const post = await createPost({ ctx: member, body: 'My words' });
    await expect(editPost({ ctx: colleague, postId: post.id, body: 'Not my words' })).rejects.toMatchObject({
      status: 403,
    });
    const edited = await editPost({ ctx: member, postId: post.id, body: 'My better words' });
    expect(edited.body).toBe('My better words');
  });

  it('will not hide a post without saying who and why', async () => {
    const post = await createPost({ ctx: member, body: 'Something contentious' });

    await expect(moderatePost({ ctx: member, postId: post.id, hide: true, reason: 'because' })).rejects.toMatchObject({
      status: 403,
    });
    await expect(moderatePost({ ctx: moderator, postId: post.id, hide: true })).rejects.toMatchObject({ status: 422 });

    const hidden = await moderatePost({ ctx: moderator, postId: post.id, hide: true, reason: 'Off topic' });
    // Moderation that leaves no trace is indistinguishable from a bug.
    expect(hidden.hiddenById).toBe(moderator.actor.id);
    expect(hidden.hiddenReason).toBe('Off topic');
    expect(hidden.deletedAt).toBeNull();
  });

  it('hides a post from colleagues but not from its author', async () => {
    const post = await createPost({ ctx: member, body: 'Taken down' });
    await moderatePost({ ctx: moderator, postId: post.id, hide: true, reason: 'Off topic' });

    expect((await feed(colleague)).map((p) => p.id)).not.toContain(post.id);
    // A post that vanishes with no explanation is how somebody concludes the
    // software ate it.
    expect((await feed(member)).map((p) => p.id)).toContain(post.id);
  });

  it('keeps one reaction per person and lets them change it', async () => {
    const post = await createPost({ ctx: member, body: 'React to me' });

    await react({ ctx: colleague, postId: post.id, kind: 'LIKE' });
    await react({ ctx: colleague, postId: post.id, kind: 'CELEBRATE' });

    const rows = await feed(colleague);
    const seen = rows.find((p) => p.id === post.id)!;
    expect(seen.reactionTotal).toBe(1);
    expect(seen.reactionCounts).toEqual({ CELEBRATE: 1 });
    expect(seen.myReaction).toBe('CELEBRATE');

    await react({ ctx: colleague, postId: post.id, kind: null });
    expect((await feed(colleague)).find((p) => p.id === post.id)!.reactionTotal).toBe(0);
  });

  it('takes no reactions on a hidden post', async () => {
    const post = await createPost({ ctx: member, body: 'Gone' });
    await moderatePost({ ctx: moderator, postId: post.id, hide: true, reason: 'Off topic' });
    await expect(react({ ctx: colleague, postId: post.id, kind: 'LIKE' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('contests', () => {
  const WINDOW = { startAt: new Date('2026-08-01T00:00:00Z'), endAt: new Date('2026-08-31T23:59:59Z') };

  async function sale(ownerId: string, saleValue: number) {
    return prisma.booking.create({
      data: {
        tenantId: fixture.a.tenantId,
        reference: `BK-${Math.random().toString(36).slice(2, 10)}`,
        leadId: fixture.a.leadIds[0],
        projectId,
        ownerId,
        status: 'CONFIRMED',
        saleValue: D(saleValue),
        currency: 'AED',
        bookingDate: new Date('2026-08-10T00:00:00Z'),
      },
    });
  }

  it('permits only the moves a contest actually makes', () => {
    expect(canTransition('DRAFT', 'OPEN')).toBe(true);
    expect(canTransition('OPEN', 'CLOSED')).toBe(true);
    expect(canTransition('DRAFT', 'CLOSED')).toBe(false);
    expect(canTransition('CLOSED', 'OPEN')).toBe(false);
  });

  it('needs the permission to run one', async () => {
    await expect(
      createContest({ ctx: member, name: 'August push', metric: 'revenue', ...WINDOW }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a window that ends before it starts', async () => {
    await expect(
      createContest({
        ctx: moderator,
        name: 'Backwards',
        metric: 'revenue',
        startAt: WINDOW.endAt,
        endAt: WINDOW.startAt,
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('ranks live from the same numbers the leader dashboard uses', async () => {
    await sale(fixture.a.userId, 5_000_000);
    await sale(colleague.actor.id, 9_000_000);

    const contest = await createContest({ ctx: moderator, name: 'August push', metric: 'revenue', ...WINDOW });
    await decideContest({ ctx: moderator, contestId: contest.id, to: 'OPEN' });

    const board = await leaderboard(fixture.a.tenantId, contest.id);
    expect(board.frozen).toBe(false);
    expect(board.standings[0].userId).toBe(colleague.actor.id);
    expect(board.standings[0].rank).toBe(1);
  });

  it('freezes the result when it closes, so a later cancellation cannot change who won', async () => {
    const winning = await sale(colleague.actor.id, 9_000_000);
    await sale(fixture.a.userId, 5_000_000);

    const contest = await createContest({ ctx: moderator, name: 'August push', metric: 'revenue', ...WINDOW });
    await decideContest({ ctx: moderator, contestId: contest.id, to: 'OPEN' });
    await decideContest({ ctx: moderator, contestId: contest.id, to: 'CLOSED' });

    // The winner's sale falls through afterwards.
    await prisma.booking.update({
      where: { id: winning.id, tenantId: fixture.a.tenantId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Client withdrew' },
    });

    const board = await leaderboard(fixture.a.tenantId, contest.id);
    expect(board.frozen).toBe(true);
    // February's winner does not change in March.
    expect(board.standings[0].userId).toBe(colleague.actor.id);
    expect(board.standings[0].value).toBe('9000000');
  });

  it('closes cleanly when nobody scored', async () => {
    const contest = await createContest({ ctx: moderator, name: 'Empty', metric: 'revenue', ...WINDOW });
    await decideContest({ ctx: moderator, contestId: contest.id, to: 'OPEN' });
    await decideContest({ ctx: moderator, contestId: contest.id, to: 'CLOSED' });

    const board = await leaderboard(fixture.a.tenantId, contest.id);
    expect(board.frozen).toBe(true);
    expect(board.standings).toEqual([]);
  });

  it('restricts a team contest to that team', async () => {
    await sale(fixture.a.userId, 5_000_000);
    await sale(colleague.actor.id, 9_000_000);
    await prisma.userTeam.create({ data: { tenantId: fixture.a.tenantId, userId: fixture.a.userId, teamId } });

    const contest = await createContest({ ctx: moderator, name: 'Team only', metric: 'revenue', teamId, ...WINDOW });
    await decideContest({ ctx: moderator, contestId: contest.id, to: 'OPEN' });

    const board = await leaderboard(fixture.a.tenantId, contest.id);
    expect(board.standings).toHaveLength(1);
    expect(board.standings[0].userId).toBe(fixture.a.userId);
  });
});

describe('nominations and voting', () => {
  it('will not let somebody nominate themselves', async () => {
    await expect(
      nominate({ ctx: member, eventId, category: 'Best Newcomer', nomineeId: member.actor.id }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('refuses the same person twice in one category', async () => {
    await nominate({ ctx: member, eventId, category: 'Best Newcomer', nomineeId: colleague.actor.id });
    await expect(
      nominate({ ctx: member, eventId, category: 'Best Newcomer', nomineeId: colleague.actor.id }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('moves a vote rather than adding a second in the same category', async () => {
    const first = await nominate({ ctx: member, eventId, category: 'Best Newcomer', nomineeId: colleague.actor.id });
    const second = await nominate({ ctx: colleague, eventId, category: 'Best Newcomer', nomineeId: member.actor.id });

    await vote({ ctx: moderator, nominationId: first.id });
    const moved = await vote({ ctx: moderator, nominationId: second.id });
    expect(moved.moved).toBe(true);

    const groups = await results(moderator, eventId);
    const category = groups.find((g) => g.category === 'Best Newcomer')!;
    // Otherwise the only way to correct a misclick is to vote twice.
    expect(category.nominations.reduce((n, x) => n + x.votes, 0)).toBe(1);
  });

  it('refuses the same vote twice', async () => {
    const n = await nominate({ ctx: member, eventId, category: 'Best Newcomer', nomineeId: colleague.actor.id });
    await vote({ ctx: moderator, nominationId: n.id });
    await expect(vote({ ctx: moderator, nominationId: n.id })).rejects.toMatchObject({ status: 409 });
  });

  it('will not let a nominee vote for themselves', async () => {
    const n = await nominate({ ctx: member, eventId, category: 'Best Newcomer', nomineeId: colleague.actor.id });
    await expect(vote({ ctx: colleague, nominationId: n.id })).rejects.toMatchObject({ status: 422 });
  });

  it('reports a tie as a tie instead of picking one', async () => {
    const a = await nominate({ ctx: member, eventId, category: 'Best Newcomer', nomineeId: colleague.actor.id });
    const b = await nominate({ ctx: colleague, eventId, category: 'Best Newcomer', nomineeId: member.actor.id });

    await vote({ ctx: moderator, nominationId: a.id });
    // A different voter, so this is a second vote in the category, not a move.
    // It has to be colleague: member is b's nominee and may not vote for
    // themselves, which the service correctly refuses.
    await vote({ ctx: colleague, nominationId: b.id });

    const category = (await results(moderator, eventId)).find((g) => g.category === 'Best Newcomer')!;
    expect(category.tied).toBe(true);
    // An award going to whoever happened to sort first is how it goes to the
    // wrong person.
    expect(category.leaderId).toBeNull();

    await expect(closeCategory({ ctx: moderator, eventId, category: 'Best Newcomer' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('declares the winner once there is a clear one', async () => {
    const a = await nominate({ ctx: member, eventId, category: 'Best Newcomer', nomineeId: colleague.actor.id });
    await nominate({ ctx: colleague, eventId, category: 'Best Newcomer', nomineeId: member.actor.id });

    await vote({ ctx: moderator, nominationId: a.id });

    const closed = await closeCategory({ ctx: moderator, eventId, category: 'Best Newcomer' });
    expect(closed.winnerId).toBe(colleague.actor.id);
    expect(closed.votes).toBe(1);

    const won = await prisma.nomination.findFirstOrThrow({
      where: { id: a.id, tenantId: fixture.a.tenantId },
    });
    expect(won.status).toBe('WON');
  });

  it('needs the permission to declare a winner', async () => {
    const a = await nominate({ ctx: member, eventId, category: 'Best Newcomer', nomineeId: colleague.actor.id });
    await vote({ ctx: moderator, nominationId: a.id });
    await expect(closeCategory({ ctx: member, eventId, category: 'Best Newcomer' })).rejects.toMatchObject({
      status: 403,
    });
  });
});
