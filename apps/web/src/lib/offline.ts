/**
 * Changes made without a connection wait here and are sent when it returns
 * (Lead Eagle plan, gap 9). The phone app is a web view of this site, so the
 * outbox is the site's own, kept in the device's storage.
 *
 * Only requests that are safe to send late go through it: ones that set a
 * value (a stage, a field, notes), and ones carrying a request key the server
 * replays instead of repeating (logging an activity). Anything else still needs
 * a connection, and says so.
 */
const KEY = 'youhan.outbox.v1';

export interface Pending {
  id: string;
  url: string;
  method: string;
  body: string;
  /** What it was, for the banner: "Stage change", "Call logged". */
  label: string;
  at: string;
}

export const pending = (): Pending[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Pending[];
  } catch {
    return [];
  }
};

function save(items: Pending[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage full or blocked: the banner will show what is still held.
  }
  window.dispatchEvent(new Event('outbox'));
}

const send = (item: Pick<Pending, 'url' | 'method' | 'body'>) =>
  fetch(item.url, { method: item.method, headers: { 'content-type': 'application/json' }, body: item.body });

/** Sends now, or keeps it for later when there is no connection. `'queued'` means kept. */
export async function sendOrQueue(url: string, method: string, body: unknown, label: string) {
  const item = { url, method, body: JSON.stringify(body) };
  const keep = () => {
    save([...pending(), { ...item, id: crypto.randomUUID(), label, at: new Date().toISOString() }]);
    return 'queued' as const;
  };
  if (navigator.onLine === false) return keep();
  try {
    return await send(item);
  } catch {
    return keep();
  }
}

/**
 * Sends what waited, oldest first. Stops — keeping the rest — at the first that
 * still cannot go: no connection, a signed-out session, a server error. A
 * refusal (4xx) will not change by retrying, so it is dropped and returned for
 * the banner to show.
 */
export async function flush(): Promise<{ sent: number; refused: (Pending & { reason: string })[] }> {
  let items = pending();
  let sent = 0;
  const refused: (Pending & { reason: string })[] = [];
  while (items.length) {
    const [next, ...rest] = items;
    let res: Response;
    try {
      res = await send(next!);
    } catch {
      break;
    }
    if (res.status === 401 || res.status === 429 || res.status >= 500) break;
    if (res.ok) sent += 1;
    else {
      const data = await res.json().catch(() => ({}));
      refused.push({ ...next!, reason: data.detail ?? `refused (${res.status})` });
    }
    items = rest;
    save(items);
  }
  return { sent, refused };
}
