import { logger } from '@/lib/logger';
import { prisma } from '@/lib/db';
import { sendMail } from '@/lib/mailer';
import { entityRoute } from '@/lib/nav/entityRoute';
import { pushConfigured, pushTargets, sendPush } from '@/lib/push/send';
import { readPrefs } from '@/lib/notificationPrefs';
import { env } from '@/lib/env';

interface HrEventJob {
  tenantId: string;
  event: string;
  userIds: string[];
  title: string;
  body: string;
}

/**
 * A push about a record, whoever raised it.
 *
 * Nothing in this payload was ever HR-specific — it is a title, a body, some
 * recipients and a record to open — so the CRM side raises the same job rather
 * than growing a parallel one that would drift from it.
 */
interface RecordPushJob {
  tenantId: string;
  userIds: string[];
  title: string;
  body: string;
  objectType: string | null;
  recordId: string | null;
}

/**
 * Ring the phones the recipients are carrying.
 *
 * Separate from the email job on purpose — see the comment at the enqueue in
 * services/hr/notify.ts. It never throws: the in-app row is already written and
 * the email is already queued, so a push is the third copy of a message that has
 * arrived twice. Failing the job would only retry the two that worked — and
 * re-ring the phones that did receive it, with no delivery stamp to filter them.
 *
 * The destination is resolved here rather than carried in the payload, because
 * it needs the workspace slug and `entityRoute` is the one place allowed to turn
 * a record type into a path. A record with no route still pushes — it opens the
 * notification list, which is a worse destination than the record and a much
 * better one than nothing.
 */
export async function pushRecord(data: RecordPushJob) {
  // Each person's choices (M17-11): push unless turned off, email only if turned on
  // and not gathered into the morning summary instead (M17-04).
  const people = await prisma.user.findMany({
    where: { tenantId: data.tenantId, id: { in: data.userIds }, status: 'ACTIVE', deletedAt: null },
    select: { id: true, email: true, notificationPrefs: true },
  });
  const chose = people.map((p) => ({ ...p, prefs: readPrefs(p.notificationPrefs) }));
  const pushTo = chose.filter((p) => p.prefs.push).map((p) => p.id);
  const emailTo = chose.filter((p) => p.prefs.email && !p.prefs.digest).map((p) => p.email);

  let emailed = 0;
  if (emailTo.length) {
    try {
      emailed = await emailRecord(data, emailTo);
    } catch (error) {
      logger.warn({ err: error }, 'notification email failed');
    }
  }
  try {
    return { ...(await deliverPush({ ...data, userIds: pushTo })), emailed };
  } catch (error) {
    logger.warn({ err: error }, 'push notification failed');
    return { pushed: 0, emailed };
  }
}

/** The email copy (M17-03): the notification's title and text, and a link to the record. */
async function emailRecord(data: RecordPushJob, to: string[]) {
  const tenant = await prisma.tenant.findUnique({ where: { id: data.tenantId }, select: { slug: true } });
  if (!tenant) return 0;
  const path = entityRoute(data.objectType, data.recordId, tenant.slug) ?? `/${tenant.slug}/notifications`;
  const base = env.APP_URL.replace(/\/$/, '');
  const text = [data.body, `Open it: ${base}${path}`].filter(Boolean).join('\n\n');
  for (const address of to) await sendMail(address, data.title, text);
  return to.length;
}

async function deliverPush(data: RecordPushJob) {
  if (!pushConfigured() || data.userIds.length === 0) return { pushed: 0 };

  const [devices, tenant] = await Promise.all([
    pushTargets(data.userIds),
    prisma.tenant.findUnique({ where: { id: data.tenantId }, select: { slug: true } }),
  ]);
  if (!devices.length || !tenant) return { pushed: 0 };

  const { sent, stale } = await sendPush(devices, {
    title: data.title,
    body: data.body,
    url: entityRoute(data.objectType, data.recordId, tenant.slug) ?? `/${tenant.slug}/notifications`,
  });

  // The app was deleted, or the token was never valid. Removed rather than
  // retried: keeping it means paying for a rejected request on every future
  // notification to this person, forever.
  if (stale.length) await prisma.deviceToken.deleteMany({ where: { token: { in: stale } } });

  return { pushed: sent };
}

/**
 * Emails the notifications that have already been written in-app.
 *
 * The split matters: `notifyHr` writes the rows synchronously and queues this,
 * so an approval never waits on SMTP and a mail outage costs the email rather
 * than the notification. Delivery state is stamped back onto the rows, which is
 * what makes "sent, failed, retrying" answerable instead of a guess.
 *
 * Addresses are read here rather than carried in the payload. A queued job can
 * sit for minutes; resolving the address at send time means someone who changed
 * their email in between gets it at the new one, and a deactivated account gets
 * nothing at all.
 */
export async function emailHrEvent({ tenantId, event, userIds, title, body }: HrEventJob) {
  const users = await prisma.user.findMany({
    where: { tenantId, id: { in: userIds }, status: 'ACTIVE' },
    select: { id: true, email: true, fullName: true },
  });

  let sent = 0;
  const failures: string[] = [];
  for (const user of users) {
    try {
      await sendMail(user.email, title, `${user.fullName},\n\n${body || title}\n`);
      sent += 1;
    } catch (error) {
      // Collected rather than thrown immediately: one bad address must not
      // stop the other nine people being told.
      failures.push(user.id);
      logger.warn({ err: error, userId: user.id, event }, 'notification email failed');
    }
  }

  const delivered = users.filter((user) => !failures.includes(user.id)).map((user) => user.id);
  if (delivered.length) {
    await prisma.notification.updateMany({
      where: { tenantId, userId: { in: delivered }, kind: event, emailedAt: null },
      data: { emailedAt: new Date() },
    });
  }
  if (failures.length) {
    await prisma.notification.updateMany({
      where: { tenantId, userId: { in: failures }, kind: event, emailedAt: null },
      data: { emailError: 'Delivery failed; see worker logs.' },
    });
    // Rethrown so BullMQ retries the job. The rows already emailed are
    // filtered by `emailedAt: null`, so a retry does not send twice.
    throw new Error(`${failures.length} of ${users.length} notification emails failed`);
  }

  return { sent };
}
