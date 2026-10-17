import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every write leaves an audit row (audit NFR-05): each POST, PATCH, PUT and
 * DELETE handler under src/app/api declares `auditEvent`, writes one itself
 * (`audit(`, `platformAudit(`), or is listed below — either with the file that
 * audits it (checked to call an audit writer) or with why there is nothing to
 * record. A new mutation route fails here until it says which.
 *
 * ponytail: a static check of the source, not a proof that every branch of a
 * listed service audits; a branch that forgets is a review finding.
 */
const API = 'src/app/api';
const AUDIT = /\b(audit|platformAudit)\(|auditLog\.create\(/;
const EXPORT = /^export (?:const|async function|function) (GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\b/gm;
const MUTATIONS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

type Exemption = { audited: string } | { nothing: string };
const audited = (path: string): Exemption => ({ audited: path });
const nothing = (why: string): Exemption => ({ nothing: why });

const EXEMPT: Record<string, Exemption> = {
  // Audited by the service the route calls.
  'v1/auth/accept-invite POST': audited('src/services/identity/invitations.ts'),
  'v1/collections/receipts/evidence POST': audited('src/services/money/collections.ts'),
  'v1/integrations/[provider]/deliveries POST': audited('src/services/leads/deliveries.ts'),
  'v1/leads/messages POST': audited('src/services/leads/leadMessages.ts'),
  'v1/leads/[id]/messages POST': audited('src/services/leads/leadMessages.ts'),
  'v1/leads/triage/[id]/assign POST': audited('src/services/distribution/triageQueue.ts'),
  'v1/leads/[id]/merge POST': audited('src/services/leads/merge.ts'),
  'v1/leads/[id]/move-to-data POST': audited('src/services/leads/coldData.ts'),
  'v1/leads/[id]/restore POST': audited('src/services/leads/updateLead.ts'),
  'v1/leads/[id] DELETE': audited('src/services/leads/updateLead.ts'),
  'v1/leads/[id]/shares POST': audited('src/services/leads/leadShares.ts'),
  'v1/leads/[id]/shares DELETE': audited('src/services/leads/leadShares.ts'),
  'v1/platform/credentials POST': audited('src/services/identity/platformCredentials.ts'),
  'v1/platform/users/[userId]/actions POST': audited('src/services/platform/identity.ts'),
  'v1/platform/workspaces POST': audited('src/services/platform/createWorkspace.ts'),
  'v1/public/capture POST': audited('src/services/leads/intake.ts'),
  'v1/public/forms POST': audited('src/services/leads/intake.ts'),
  'v1/public/share-view POST': audited('src/services/leads/leadShares.ts'),
  'v1/public/signup/confirm POST': audited('src/services/platform/createWorkspace.ts'),
  'v1/public/testimonial POST': audited('src/services/clients/testimonials.ts'),
  'v1/webhooks/leads/[key] POST': audited('src/services/leads/intake.ts'),
  'v1/webhooks/meta/[key] POST': audited('src/services/meta/applyEvent.ts'),
  'v1/workspaces/[workspaceSlug]/hr/actions/[action] POST': audited('src/services/hr/lifecycle.ts'),
  'v1/workspaces/[workspaceSlug]/hr/documents/upload POST': audited('src/services/hr/documents.ts'),
  'v1/workspaces/[workspaceSlug]/hr/self/[action] POST': audited('src/services/hr/requests.ts'),
  'v1/workspaces/[workspaceSlug]/identity/self/[action] POST': audited('src/services/identity/accounts.ts'),
  'v1/workspaces/[workspaceSlug]/identity/[action] POST': audited('src/services/identity/accounts.ts'),
  'v1/workspaces/[workspaceSlug]/identity/[action] DELETE': audited('src/services/identity/invitations.ts'),
  'v1/workspaces/[workspaceSlug]/roles/[action] POST': audited('src/services/identity/roles.ts'),
  // Audited by a helper in the route file itself.
  'v1/auth/service-login POST': audited('src/app/api/v1/auth/service-login/route.ts'),
  'v1/auth/service-login PATCH': audited('src/app/api/v1/auth/service-login/route.ts'),
  'v1/leads/[id]/interests POST': audited('src/app/api/v1/leads/[id]/interests/route.ts'),
  'v1/leads/[id]/interests DELETE': audited('src/app/api/v1/leads/[id]/interests/route.ts'),
  'v1/platform/workspaces/[workspaceId]/enter DELETE': audited(
    'src/app/api/v1/platform/workspaces/[workspaceId]/enter/route.ts',
  ),

  // Nothing a person changes in a business record.
  'v1/assistant POST': nothing('A question to the assistant; an action it proposes runs through its own route.'),
  'v1/calls/[id]/coach POST': nothing('An on-demand coaching hint; nothing is stored.'),
  'v1/calls/[id]/follow-up-email POST': nothing('Drafts the email; the send (PUT) is audited.'),
  'v1/calls/[id]/follow-up-whatsapp POST': nothing('Drafts the message; the send is the conversation reply route.'),
  'v1/social-leads/[id]/draft POST': nothing('Drafts a reply; the reply route is audited.'),
  'v1/practice/transcribe POST': nothing('Speech to text for a practice turn; nothing is stored.'),
  'v1/practice/[id] POST': nothing("A turn in the caller's own practice session; finishing it is audited."),
  'v1/devices POST': nothing("The caller's own push token, registered on every app start."),
  'v1/devices/unregister POST': nothing("Forgets the caller's own push token."),
  'v1/notifications PATCH': nothing("Marks the caller's own notifications read."),
  'v1/notification-preferences PUT': nothing("The caller's own phone and email choices for their notifications."),
  'v1/projects/[id]/favourite POST': nothing("The caller's own bookmark on a project."),
  'v1/auth/forgot-password POST': nothing('Sends a reset link; the reset itself is audited.'),
  'v1/public/signup POST': nothing('A sign-up request makes nothing until confirmed (confirm is audited).'),
  'v1/public/proposal POST': nothing("A client's reaction, stamped on the proposal item (reactedAt)."),
  'v1/public/rsvp POST': nothing("An invitee's answer, stamped on the invitation (rsvpAt, channel)."),
  'v1/webhooks/telephony POST': nothing(
    "A provider's call events, kept as the call's own event rows; an unknown caller's lead is audited by intake.",
  ),
  'v1/webhooks/telephony/[key] POST': nothing(
    "A provider's call events, kept as the call's own event rows; an unknown caller's lead is audited by intake.",
  ),
  'v1/webhooks/telephony/[key]/answer POST': nothing('Answers the provider with call instructions; nothing is stored.'),
};

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : name === 'route.ts' ? [path] : [];
  });

/** Each mutation handler: its key ("v1/leads/[id] DELETE") and whether it audits where it is declared. */
const handlers = walk(API).flatMap((file) => {
  const src = readFileSync(file, 'utf8');
  const marks = [...src.matchAll(EXPORT)];
  const route = relative(API, file)
    .split('\\')
    .join('/')
    .replace(/\/route\.ts$/, '');
  return marks.flatMap((mark, i) => {
    if (!MUTATIONS.has(mark[1]!)) return [];
    const own = src.slice(mark.index, marks[i + 1]?.index);
    return [{ key: `${route} ${mark[1]}`, audits: /\bauditEvent:/.test(own) || AUDIT.test(own) }];
  });
});

describe('every mutation route is audited', () => {
  it('finds the routes', () => {
    expect(handlers.length).toBeGreaterThan(200);
  });

  it('declares auditEvent, audits in the handler, or is listed with its reason', () => {
    const silent = handlers.filter((h) => !h.audits && !EXEMPT[h.key]).map((h) => h.key);
    expect(silent).toEqual([]);
  });

  it('lists only routes that exist and do not already audit themselves', () => {
    const live = new Map(handlers.map((h) => [h.key, h.audits]));
    const stale = Object.keys(EXEMPT).filter((key) => live.get(key) !== false);
    expect(stale).toEqual([]);
  });

  it('names, for each audited elsewhere, a file that writes an audit row', () => {
    const wrong = Object.entries(EXEMPT)
      .filter(
        ([, why]) => 'audited' in why && !(existsSync(why.audited) && AUDIT.test(readFileSync(why.audited, 'utf8'))),
      )
      .map(([key]) => key);
    expect(wrong).toEqual([]);
  });
});
