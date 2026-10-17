import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { readPrefs } from '@/lib/notificationPrefs';
import { resolveWorkspacePage, SELF_SERVICE } from '@/lib/workspace-page';
import ListHeader from '@/components/workspace/ListHeader';
import NotificationPrefsForm from './NotificationPrefsForm';

export const metadata = { title: 'Notifications' };

/** How this person is told (audit M17-11): the bell always, phone and email as they choose. */
export default async function NotificationsPrefsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  let page: Awaited<ReturnType<typeof resolveWorkspacePage>>;
  try {
    page = await resolveWorkspacePage(workspaceSlug, { permission: SELF_SERVICE });
  } catch {
    redirect('/login');
  }
  const user = await prisma.user.findFirst({
    where: { tenantId: page.ctx.tenantId, id: page.ctx.actor.id },
    select: { notificationPrefs: true },
  });
  return (
    <>
      <ListHeader
        title="Notifications"
        description="Everything appears in the bell. Choose whether it also reaches your phone and your email."
      />
      <NotificationPrefsForm initial={readPrefs(user?.notificationPrefs)} />
    </>
  );
}
