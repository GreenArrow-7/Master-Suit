/**
 * Changes made without a connection wait here and are sent when it returns
 * (Lead Eagle plan, gap 9). The phone app is a web view of this site, so the
 * outbox is the site's own, kept in the device's storage.
 *
 * Each change carries its own `Idempotency-Key` (its id), the same on every
 * attempt, which `route()` answers with the first result rather than running
 * again: a change whose answer was lost on the way back is replayed, not
 * doubled. So a write that adds a row (a follow-up, a logged call) is as safe to
 * send late as one that sets a value. What needs an answer to go on (opening
 * the record it creates) still needs a connection, and says so.
 *
 * Each change is also tagged with whose it is: the workspace and person of the
 * screen it was made on (`data-outbox-owner` on the workspace frame). The
 * server takes both from whatever session sends it, and a new follow-up names
 * no record a wrong tenant could refuse, so a change is only ever sent from a
 * screen with the same owner; another session's waits, unseen, until its owner
 * is back. Signing out forgets them all.
 */
const KEY = 'youhan.outbox.v1';

export interface Pending {
  id: string;
  /** `tenantId:userId` of the session that made it. */
  owner: string;
  url: string;
  method: string;
  body: string;
  /** What it was, for the banner: "Stage change", "Call logged". */
  label: string;
  at: string;
}

const all = (): Pending[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Pending[];
  } catch {
    return [];
  }
};

const owner = () => document.querySelector<HTMLElement>('[data-outbox-owner]')?.dataset.outboxOwner ?? '';

/** What waits for this workspace and person. */
export const pending = (): Pending[] => {
  const me = owner();
  return me ? all().filter((item) => item.owner === me) : [];
};

function save(items: Pending[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage full or blocked: the banner will show what is still held.
  }
  window.dispatchEvent(new Event('outbox'));
}

/** On signing out: nothing made in this session is sent in the next one. */
export function forget() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Blocked storage held nothing.
  }
}

const send = (item: Pick<Pending, 'id' | 'url' | 'method' | 'body'>) =>
  fetch(item.url, {
    method: item.method,
    headers: { 'content-type': 'application/json', 'idempotency-key': item.id },
    body: item.body,
  });

/** Sends now, or keeps it for later when there is no connection. `'queued'` means kept. */
export async function sendOrQueue(url: string, method: string, body: unknown, label: string) {
  const item = { id: crypto.randomUUID(), url, method, body: JSON.stringify(body) };
  const keep = () => {
    save([...all(), { ...item, owner: owner(), label, at: new Date().toISOString() }]);
    return 'queued' as const;
  };
  if (navigator.onLine === false) return keep();
  try {
    return await send(item);
  } catch {
    return keep();
  }
}

type Flushed = { sent: number; refused: (Pending & { reason: string })[] };

/**
 * Sends what waited, oldest first. Stops — keeping the rest — at the first that
 * still cannot go: no connection, a signed-out session, a server error. A
 * refusal (4xx) will not change by retrying, so it is dropped and returned for
 * the banner to show.
 */
async function drain(): Promise<Flushed> {
  let sent = 0;
  const refused: Flushed['refused'] = [];
  for (const next of pending()) {
    let res: Response;
    try {
      res = await send(next);
    } catch {
      break;
    }
    if (res.status === 401 || res.status === 429 || res.status >= 500) break;
    if (res.ok) sent += 1;
    else {
      const data = await res.json().catch(() => ({}));
      refused.push({ ...next, reason: data.detail ?? `refused (${res.status})` });
    }
    save(all().filter((item) => item.id !== next.id));
  }
  return { sent, refused };
}

/**
 * One send at a time: reconnecting, coming back to the app and arriving on a
 * screen can all start one together, and two at once would both send the first
 * change before either removed it — the server's request key replays a retry,
 * not a twin arriving alongside. Queued in this page; the Web Lock (where the
 * web view has one) does the same across tabs. A later send finds only what
 * the earlier one left.
 */
let running: Promise<unknown> = Promise.resolve();
export function flush(): Promise<Flushed> {
  const run = async () => (navigator.locks ? await navigator.locks.request(KEY, drain) : drain());
  const result = running.then(run);
  running = result.catch(() => undefined);
  return result;
}
