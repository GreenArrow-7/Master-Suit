'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { registerNativePush } from '@/lib/pwa/nativePush';

/**
 * Registers this device for push, once the viewer is inside a workspace.
 *
 * Mounted in the workspace layout rather than the root one, and that is the
 * whole design: registration claims the handset for the signed-in account, so it
 * must not run on the login screen where there is no account to claim it for.
 *
 * A browser renders nothing and does nothing — see lib/pwa/nativePush.ts.
 */
export default function NativePush() {
  const router = useRouter();

  useEffect(() => {
    void registerNativePush((url) => router.push(url));
  }, [router]);

  return null;
}
