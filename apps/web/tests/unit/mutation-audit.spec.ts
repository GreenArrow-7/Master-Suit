import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every write leaves an audit row (audit NFR-05): each POST, PATCH, PUT and
 * DELETE handler under src/app/api declares `auditEvent`, writes one itself
 * (`audit(`, `platformAudit(`), or is listed below — either with the file that
 * audits it or with why there is nothing to record. A new mutation route fails
 * here until it says which.
 *
 * "Audited by" is checked against what the handler calls from that file: at
 * least one of those functions writes an audit row (itself or through a
 * function of the same file), and none of them writes a record without one.
 *
 * ponytail: a static reading of the source (a function runs to the next `}` at
 * the start of a line; a write is a Prisma create/update/upsert/delete call), not
 * a proof that every branch audits; a branch that forgets is a review finding.
 */
const API = 'src/app/api';
const AUDIT = /\b(audit|platformAudit)\(|auditLog\.create\(/;
const EXPORT = /^export (?:const|async function|function) (GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\b/gm;
const MUTATIONS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const WRITES = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;

type Exemption = { audited: string } | { nothing: string };
const audited = (path: string): Exemption => ({ audited: path });
const nothing = (why: string): Exemption => ({ nothing: why });

const EXEMPT: Record<string, Exemption> = {
  // Audited by the service the route calls.
  'v1/auth/accept-invite POST': audited('src/services/identity/invitations.ts'),
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
  'v1/public/signup/confirm POST': audited('src/services/platform/signup.ts'),
  'v1/public/testimonial POST': audited('src/services/clients/testimonials.ts'),
  'v1/workspaces/[workspaceSlug]/hr/actions/[action] POST': audited('src/services/hr/lifecycle.ts'),
  'v1/workspaces/[workspaceSlug]/hr/documents/upload POST': audited('src/services/hr/documents.ts'),
  'v1/workspaces/[workspaceSlug]/hr/self/[action] POST': audited('src/services/hr/requests.ts'),
  'v1/workspaces/[workspaceSlug]/identity/self/[action] POST': audited('src/services/identity/accounts.ts'),
  'v1/workspaces/[workspaceSlug]/identity/[action] POST': audited('src/services/identity/accounts.ts'),
  'v1/workspaces/[workspaceSlug]/identity/[action] DELETE': audited('src/services/identity/accounts.ts'),
  'v1/workspaces/[workspaceSlug]/roles/[action] POST': audited('src/services/identity/roles.ts'),
  // Audited by a helper in the route file itself.
  'v1/auth/service-login POST': audited('src/app/api/v1/auth/service-login/route.ts'),
  'v1/auth/service-login PATCH': audited('src/app/api/v1/auth/service-login/route.ts'),
  'v1/leads/[id]/interests POST': audited('src/app/api/v1/leads/[id]/interests/route.ts'),
  'v1/leads/[id]/interests DELETE': audited('src/app/api/v1/leads/[id]/interests/route.ts'),

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
  'v1/webhooks/leads/[key] POST': nothing(
    "Keeps the portal's delivery and queues it; the lead the webhook worker makes from it is audited by intake.ts.",
  ),
  'v1/webhooks/meta/[key] POST': nothing(
    "Keeps Meta's delivery and queues it; what the webhook worker applies from it is audited by applyEvent.ts.",
  ),
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

const read = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

/** A function's source: from its declaration to the next `}` at the start of a line. */
const fnBody = (src: string, name: string) => {
  const at = new RegExp(`\\n(?:export )?(?:async )?function ${name}\\b|\\n(?:export )?const ${name} = `).exec(src);
  return at ? src.slice(at.index, src.indexOf('\n}', at.index + 1)) : '';
};

/** What `file` imports by name: local name → [the file it comes from, its exported name]. */
const importsOf = (file: string) =>
  new Map(
    [...read(file).matchAll(/import\s*\{([^}]*)\}\s*from\s*'(@\/|\.\/)([^']+)'/g)].flatMap(([, names, root, path]) =>
      names!
        .split(',')
        .map((name) =>
          name
            .replace(/^\s*type\s+/, '')
            .trim()
            .split(/\s+as\s+/),
        )
        .filter(([name]) => name)
        .map(([name, local = name]): [string, [string, string]] => [
          local!,
          [root === '@/' ? `src/${path}.ts` : `${dirname(file)}/${path}.ts`, name!],
        ]),
    ),
  );

/** Whether `name` in `file` writes an audit row: itself, or through a function it calls (two calls deep). */
const auditsIn = (file: string, name: string, depth = 0): boolean => {
  const body = fnBody(read(file), name);
  if (AUDIT.test(body)) return true;
  const imports = importsOf(file);
  return (
    depth < 2 &&
    [...body.matchAll(/\b(\w+)\(/g)].some(([, n]) => {
      const [from, exported] = imports.get(n!) ?? [file, n!];
      return n !== name && auditsIn(from, exported, depth + 1);
    })
  );
};

type Handler = { key: string; audits: boolean; file: string; own: string };

/** The functions of `file` the handler calls: imported from it or, for the route file itself, declared there. */
const calledFrom = (handler: Handler, file: string): string[] => {
  const calls = (name: string) => new RegExp(`\\b${name}\\(`).test(handler.own);
  if (file === handler.file) {
    return [...read(file).matchAll(/^(?:async function|function|const) (\w+)/gm)].map(([, n]) => n!).filter(calls);
  }
  return [...importsOf(handler.file)]
    .filter(([local, [from]]) => from === file && calls(local))
    .map(([, [, name]]) => name);
};

/** Each mutation handler: its key ("v1/leads/[id] DELETE") and whether it audits where it is declared. */
const handlers = walk(API).flatMap((path): Handler[] => {
  const file = path.split('\\').join('/');
  const src = readFileSync(file, 'utf8');
  const marks = [...src.matchAll(EXPORT)];
  const route = relative(API, file)
    .split('\\')
    .join('/')
    .replace(/\/route\.ts$/, '');
  return marks.flatMap((mark, i) => {
    if (!MUTATIONS.has(mark[1]!)) return [];
    const own = src.slice(mark.index, marks[i + 1]?.index);
    return [{ key: `${route} ${mark[1]}`, audits: /\bauditEvent:/.test(own) || AUDIT.test(own), file, own }];
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

  it('names, for each audited elsewhere, a file whose functions the handler calls audit what they write', () => {
    const byKey = new Map(handlers.map((h) => [h.key, h]));
    const wrong = Object.entries(EXEMPT)
      .filter(([key, why]) => {
        if (!('audited' in why)) return false;
        const handler = byKey.get(key);
        if (!handler) return true;
        const called = calledFrom(handler, why.audited);
        const audits = called.filter((name) => auditsIn(why.audited, name));
        const silentWrite = called.some(
          (name) => WRITES.test(fnBody(read(why.audited), name)) && !audits.includes(name),
        );
        return silentWrite || audits.length === 0;
      })
      .map(([key]) => key);
    expect(wrong).toEqual([]);
  });
});
