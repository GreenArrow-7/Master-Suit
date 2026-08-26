/**
 * Publishing an answer back to Facebook or Instagram.
 *
 * The endpoints differ per provider and per kind, and `replyCapability.ts`
 * records why — this file only makes the call the capability layer has already
 * said is allowed. It deliberately does not re-derive permission or window
 * rules: two places deciding the same thing is how they end up disagreeing.
 *
 * Errors are returned, not thrown. A refusal from Meta is an ordinary outcome a
 * salesperson needs to read, not an exception for the platform to swallow.
 */
import { logger } from '@/lib/logger';

export const GRAPH_VERSION = 'v26.0';

export type ReplyKind = 'PUBLIC' | 'PRIVATE';

export interface SendReplyInput {
  provider: string;
  kind: ReplyKind;
  /** The comment being answered. */
  providerCommentId: string;
  /** Needed for private replies, which post to the Page rather than the comment. */
  pageId?: string | null;
  accessToken: string;
  body: string;
}

export type SendReplyResult = { ok: true; providerReplyId: string | null } | { ok: false; error: string };

/**
 * Where each answer goes. Both private replies post to the Page's `messages`
 * edge with the comment as the recipient — Meta routes it to whoever wrote the
 * comment, which is why no user id is needed and why it works for a commenter
 * who has never messaged the business.
 */
function endpointFor(input: SendReplyInput): { url: string; payload: Record<string, unknown> } | { error: string } {
  const base = `https://graph.facebook.com/${GRAPH_VERSION}`;

  if (input.kind === 'PRIVATE') {
    if (!input.pageId) return { error: 'No Facebook Page is selected for this connection.' };
    return {
      url: `${base}/${encodeURIComponent(input.pageId)}/messages`,
      payload: {
        recipient: { comment_id: input.providerCommentId },
        message: { text: input.body },
      },
    };
  }

  // Public replies go to the comment itself, but the edge is named differently
  // on each platform: Facebook nests comments under `comments`, Instagram has a
  // dedicated `replies` edge.
  const edge = input.provider === 'instagram' ? 'replies' : 'comments';
  return {
    url: `${base}/${encodeURIComponent(input.providerCommentId)}/${edge}`,
    payload: { message: input.body },
  };
}

export async function sendMetaReply(input: SendReplyInput): Promise<SendReplyResult> {
  const target = endpointFor(input);
  if ('error' in target) return { ok: false, error: target.error };

  try {
    const res = await fetch(target.url, {
      method: 'POST',
      // A salesperson is watching this happen; a hung socket must not hold the
      // request open until the platform's own timeout.
      signal: AbortSignal.timeout(15_000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.accessToken}`,
      },
      body: JSON.stringify(target.payload),
    });

    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      message_id?: string;
      error?: { message?: string; code?: number; error_subcode?: number };
    };

    if (!res.ok) {
      /**
       * Meta's own words, not ours. "(#10) Application does not have permission
       * for this action" tells an administrator what to fix; "reply failed"
       * tells them nothing.
       */
      const message = data.error?.message ?? `HTTP ${res.status}`;
      logger.warn(
        { provider: input.provider, kind: input.kind, status: res.status, code: data.error?.code },
        'meta refused a reply',
      );
      return { ok: false, error: message };
    }

    return { ok: true, providerReplyId: data.id ?? data.message_id ?? null };
  } catch (err) {
    const message = (err as Error).message;
    logger.warn({ provider: input.provider, kind: input.kind, err: message }, 'meta reply request failed');
    return { ok: false, error: `Could not reach Meta: ${message}` };
  }
}
