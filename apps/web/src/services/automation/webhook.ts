import { createHmac, randomBytes } from 'node:crypto';
import { envelope } from '@/lib/security/envelope';
import { assertFetchableUrl } from '@/lib/security/outboundUrl';

/**
 * The automation "webhook" action (audit M7-12): a POST to the administrator's
 * own endpoint, signed `X-Youhan-Signature: sha256=<HMAC-SHA256 of the body>`
 * with a secret shown once, when the automation is created, and kept sealed in
 * its spec.
 */
const secrets = envelope('automation-webhook-secret-v1');

export function newWebhookSecret() {
  const plain = randomBytes(32).toString('hex');
  return { plain, sealed: secrets.encrypt(plain) };
}

export const webhookSignature = (secret: string, body: string) =>
  `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;

/**
 * The URL is the administrator's choice, so its host is its own allow-list;
 * the address check still refuses anything inside the network, and a redirect
 * is refused rather than followed (see `outboundUrl.ts`). A non-2xx answer
 * throws, so the automation queue retries.
 */
export async function postWebhook(spec: { url: string; secret: string }, payload: unknown) {
  const url = await assertFetchableUrl(spec.url, [new URL(spec.url).hostname]);
  const body = JSON.stringify(payload);
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: {
      'content-type': 'application/json',
      'x-youhan-signature': webhookSignature(secrets.decrypt(spec.secret), body),
    },
    body,
  });
  if (!response.ok) throw new Error(`The webhook answered ${response.status}.`);
}
