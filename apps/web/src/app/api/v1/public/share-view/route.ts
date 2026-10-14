import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { clientIp, resolvePlatformCtx } from '@/lib/auth/session';
import { loadShare, recordShareView } from '@/services/leads/leadShares';

const body = z.object({ token: z.string().min(20).max(300) }).strict();

/**
 * A shared listing or project was opened (M4-30): called by the page's own
 * script once it is on screen, so a link preview (WhatsApp, Slack, a mail
 * scanner fetch the page and run no script) is not an opening. Nor is the
 * workspace looking at its own link: a browser signed in to that
 * workspace (the agent's Open; only the session is read, no actor) counts
 * nothing. Unauthenticated, as the page
 * is; a bad, revoked or lapsed token is a 404, as the page answers it, and
 * rate-limited per client as the page is.
 */
export const POST = route(
  { module: 'leads', action: 'VIEW', anonymous: true, body, rateLimit: { max: 60, windowSeconds: 60 } },
  async ({ body: b, req }) => {
    const share = await loadShare(b.token);
    const own = await resolvePlatformCtx(req, randomUUID()).then(
      (ctx) => ctx.activeTenantId === share.tenantId,
      () => false,
    );
    if (!own) await recordShareView(share, `${clientIp(req) ?? 'unknown'}|${req.headers.get('user-agent') ?? ''}`);
    return { ok: true };
  },
);
