/**
 * What Meta will actually let us do with this comment, right now.
 *
 * The UI asks this before it offers a button. Showing "Send private reply" on a
 * comment that is eight days old produces a salesperson typing a considered
 * answer and then an error — worse than never offering it, because they believed
 * the customer heard from them.
 *
 * Everything here is the documented contract, checked against the live docs on
 * 2026-08-17 rather than recalled. Nothing calls Meta: this is a prediction of
 * what Meta would say, so it must stay conservative and explain itself.
 *
 * ── Facebook ──────────────────────────────────────────────────────────────
 * public   POST /v26.0/{comment-id}/comments  { message }
 *          `pages_manage_engagement`, Page token with the MODERATE task.
 *          No time window documented.
 * private  POST /{page-id}/messages  { recipient: { comment_id }, message }
 *          `pages_messaging`, Page token with the MESSAGING task.
 *          7 days from the comment. Exactly one, ever.
 *
 * ── Instagram ─────────────────────────────────────────────────────────────
 * public   POST /{ig-comment-id}/replies  { message }
 *          Facebook-login apps: `instagram_basic` + `instagram_manage_comments`
 *          (+ `pages_show_list`, `pages_read_engagement`).
 *          Instagram-login apps: `instagram_business_manage_comments`.
 *          Top-level comments only — a reply to a reply is nested under the
 *          top-level one. Not allowed on hidden comments or live video comments.
 * private  POST /{page-id}/messages  { recipient: { comment_id }, message: { text } }
 *          `instagram_manage_comments` + `pages_messaging`.
 *          7 days from the comment; on a Live, only during the broadcast.
 *          One message only.
 *
 * Both platforms: continuing the conversation needs the customer to answer
 * first, which opens the standard 24-hour messaging window — that is the
 * Conversation spine's problem, not this file's.
 *
 * App Review gates all of these for accounts the app does not own, and Advanced
 * Access additionally needs Business Verification. A tenant whose connection has
 * not been through review will be refused at call time however green this looks,
 * which is why `scopes` is consulted when the connection reports them.
 */

/** Private replies close seven days after the customer commented. */
export const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const PUBLIC_SCOPES: Record<string, string[][]> = {
  // Any one of these sets is sufficient.
  facebook: [['pages_manage_engagement']],
  instagram: [['instagram_manage_comments'], ['instagram_business_manage_comments']],
};

const PRIVATE_SCOPES: Record<string, string[][]> = {
  facebook: [['pages_messaging']],
  instagram: [['instagram_manage_comments', 'pages_messaging'], ['instagram_business_manage_messages']],
};

export interface ReplySubject {
  provider: string;
  commentCreatedAt: Date;
  /** Meta's own media type, e.g. REELS, FEED, STORY, LIVE. */
  mediaType?: string | null;
  /** Set when this comment is itself a reply. */
  parentCommentId?: string | null;
  /** Set once we have replied publicly. */
  providerReplyId?: string | null;
  /**
   * Whether a *private* reply has already gone out. Meta allows exactly one and
   * offers no way to ask whether it was used, so this has to be tracked here.
   * Deliberately not "has anyone answered at all": a public reply under the post
   * does not spend the private allowance, and treating it as though it did told
   * salespeople the direct-message route was gone when it was still open.
   */
  privateReplySent?: boolean;
  /**
   * Scopes the connection reports holding. Undefined means "we do not know",
   * which is treated as no objection — an unknown is not evidence of absence,
   * and the call itself is the real check.
   */
  grantedScopes?: string[];
}

export interface ReplyCapability {
  canPublicReply: boolean;
  canPrivateReply: boolean;
  /** When the private-reply window shuts. Null when there is no window. */
  replyExpiresAt: Date | null;
  /** Plain English, for the UI to show instead of a disabled button. */
  reasonUnavailable: { public?: string; private?: string };
}

const holdsAny = (granted: string[] | undefined, sets: string[][]) =>
  !granted || sets.some((set) => set.every((scope) => granted.includes(scope)));

export function replyCapability(subject: ReplySubject, now: Date = new Date()): ReplyCapability {
  const provider = subject.provider === 'instagram' ? 'instagram' : 'facebook';
  const isLive = (subject.mediaType ?? '').toUpperCase().includes('LIVE');
  const reasonUnavailable: ReplyCapability['reasonUnavailable'] = {};

  let canPublicReply = true;
  if (!holdsAny(subject.grantedScopes, PUBLIC_SCOPES[provider]!)) {
    canPublicReply = false;
    reasonUnavailable.public = 'This connection has not been granted permission to reply to comments.';
  } else if (provider === 'instagram' && isLive) {
    canPublicReply = false;
    reasonUnavailable.public = 'Instagram does not allow replies to comments on a live video.';
  } else if (subject.providerReplyId) {
    canPublicReply = false;
    reasonUnavailable.public = 'Already replied publicly.';
  }

  /**
   * A live comment can only be answered privately while the broadcast is on
   * air, and nothing tells us when it ends — so this is refused rather than
   * offered on a guess. The seven-day rule does not apply to it either way.
   */
  const expiresAt = isLive ? null : new Date(subject.commentCreatedAt.getTime() + PRIVATE_REPLY_WINDOW_MS);

  let canPrivateReply = true;
  if (!holdsAny(subject.grantedScopes, PRIVATE_SCOPES[provider]!)) {
    canPrivateReply = false;
    reasonUnavailable.private = 'This connection has not been granted permission to send private replies.';
  } else if (isLive) {
    canPrivateReply = false;
    reasonUnavailable.private = 'Private replies to live comments are only possible while the broadcast is running.';
  } else if (now.getTime() >= expiresAt!.getTime()) {
    canPrivateReply = false;
    reasonUnavailable.private = 'The seven-day window for a private reply has closed.';
  } else if (subject.privateReplySent) {
    canPrivateReply = false;
    reasonUnavailable.private = 'Meta allows only one private reply per comment, and one has already been sent.';
  }

  return { canPublicReply, canPrivateReply, replyExpiresAt: expiresAt, reasonUnavailable };
}
