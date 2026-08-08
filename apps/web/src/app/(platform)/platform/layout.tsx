import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ulid } from 'ulid';
import { requirePlatformOwner } from '@/lib/auth/platform';
import PlatformSidebar from '@/components/platform/PlatformSidebar';
import TopBar from '@/components/nav/TopBar';

export const dynamic = 'force-dynamic';

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  let owner;
  try {
    owner = await requirePlatformOwner(new Request('http://internal/platform', { headers: await headers() }), ulid());
  } catch {
    redirect('/login');
  }

  return (
    <div className="lf-app-frame">
      <PlatformSidebar email={owner!.email} />
      <div className="lf-content-column">
        <TopBar module="platform" workspaceName="Platform control" />
        <main className="lf-page-main">{children}</main>
      </div>
    </div>
  );
}
