import { notFound } from 'next/navigation';
import { requirePlatformPage } from '@/lib/platform-page';
import { loadUser } from '@/services/ai/console';
import UserView from './UserView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'User AI usage and token settings' };

export default async function AiUserPage({ params }: { params: Promise<{ tenantId: string; userId: string }> }) {
  await requirePlatformPage();
  const { tenantId, userId } = await params;
  const data = await loadUser(tenantId, userId);
  if (!data) notFound();
  return <UserView {...data} />;
}
