/**
 * One HTTP path for every calling vendor, so timeouts, retries and — above all —
 * the rule that credentials never reach a log are decided once.
 */
import { timingSafeEqual } from 'node:crypto';
import { logger } from '@/lib/logger';
import { withRetry, isTransient } from '../retry';

const TIMEOUT_MS = 15_000;

export class TelephonyApiError extends Error {
  constructor(
    readonly vendor: string,
    readonly status: number,
    message: string,
    /**
     * The vendor's own explanation, lifted from the response body.
     *
     * Carried separately from `message` because it is the only part a person can
     * act on and the only part that needs redacting before display. A bare
     * "gemini returned 403" sent an administrator to check their quota when the
     * body said "API key not valid" — the status code names the category, the
     * body names the mistake.
     */
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'TelephonyApiError';
  }
}

/**
 * The human-readable complaint inside a vendor error body.
 *
 * Google, Meta and Twilio all nest it differently and every one of them also
 * returns HTML on a bad gateway, so this takes the first thing that looks like a
 * sentence and gives up quietly rather than printing markup at somebody.
 */
export function vendorMessage(body: string): string | undefined {
  try {
    const j = JSON.parse(body);
    const found = j?.error?.message ?? j?.error_message ?? j?.message ?? j?.error?.details?.[0]?.reason;
    if (typeof found === 'string' && found.trim()) return found.trim().slice(0, 200);
  } catch {
    /* not JSON — fall through */
  }
  return undefined;
}

interface VendorRequest {
  vendor: string;
  url: string;
  method?: 'GET' | 'POST' | 'DELETE';
  headers?: Record<string, string>;
  /** Sent as application/x-www-form-urlencoded. */
  form?: Record<string, string | string[]>;
  json?: unknown;
  /** Retries are safe for reads and for the vendors whose create is idempotent. */
  retry?: boolean;
}

export async function vendorFetch<T = any>(req: VendorRequest): Promise<T> {
  const call = async (): Promise<T> => {
    const headers: Record<string, string> = { Accept: 'application/json', ...req.headers };
    let body: string | undefined;

    if (req.form) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(req.form)) {
        for (const one of Array.isArray(value) ? value : [value]) params.append(key, one);
      }
      body = params.toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (req.json !== undefined) {
      body = JSON.stringify(req.json);
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(req.url, {
      method: req.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await res.text();
    if (!res.ok) {
      // The vendor's own message, never the request: `headers` holds the token
      // and `form` holds the client's phone number.
      logger.error({ vendor: req.vendor, status: res.status, body: text.slice(0, 500) }, 'telephony API error');
      throw new TelephonyApiError(req.vendor, res.status, `${req.vendor} returned ${res.status}`, vendorMessage(text));
    }

    return (text ? JSON.parse(text) : {}) as T;
  };

  return req.retry ? withRetry(`telephony:${req.vendor}`, call, { retryOn: transientHttp }) : call();
}

const transientHttp = (err: unknown) =>
  (err instanceof TelephonyApiError && [429, 502, 503, 504].includes(err.status)) || isTransient(err);

/** Basic auth for the vendors that use it (Twilio, Plivo, Exotel). */
export const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

/**
 * Authentication for vendors that do not sign their callbacks.
 *
 * Exotel and Knowlarity post an unsigned body to whatever URL you configured, so
 * there is nothing to verify cryptographically. What is left is a bearer secret
 * in the URL: the unguessable `webhookKey` in the path, plus a `token` query
 * parameter derived from it under WEBHOOK_SIGNING_PEPPER. Compared in constant
 * time so the endpoint does not leak the token a character at a time.
 *
 * This is weaker than a signature and is documented as such — it proves the
 * caller knows a secret, not that the body is untampered. Combine it with the
 * vendor's source-IP allowlist at the edge where the deployment allows.
 */
export function urlTokenValid(url: string, expectedToken: string): boolean {
  let supplied: string | null;
  try {
    supplied = new URL(url).searchParams.get('token');
  } catch {
    return false;
  }
  if (!supplied || supplied.length !== expectedToken.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expectedToken));
}

/** XML text escaping for the inline call-control documents Twilio and Plivo accept. */
export const xml = (value: string) =>
  value.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
