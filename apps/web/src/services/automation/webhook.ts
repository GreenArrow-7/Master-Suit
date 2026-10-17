import { createHmac, randomBytes } from 'node:crypto';
import https from 'node:https';
import { envelope } from '@/lib/security/envelope';
import { assertFetchableUrl, publicLookup } from '@/lib/security/outboundUrl';

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
 * The URL is the administrator's choice, so there is no allow-list to carry
 * the weight (`outboundUrl.ts`): `assertFetchableUrl` refuses http and a
 * literal private address up front, and the connection resolves the name once,
 * through `publicLookup`, and dials only an address it checked — a name that
 * answers public to a check and private to the connection (DNS rebinding)
 * cannot reach inside. A redirect is not followed; anything but a 2xx answer
 * throws, so the automation queue retries.
 */
export async function postWebhook(spec: { url: string; secret: string }, payload: unknown) {
  const url = await assertFetchableUrl(spec.url, [new URL(spec.url).hostname]);
  const body = JSON.stringify(payload);
  const status = await new Promise<number>((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: 'POST',
        lookup: publicLookup,
        agent: false,
        timeout: 10_000,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-youhan-signature': webhookSignature(secrets.decrypt(spec.secret), body),
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on('timeout', () => request.destroy(new Error('The webhook did not answer within 10 seconds.')));
    request.on('error', reject);
    request.end(body);
  });
  if (status < 200 || status > 299) throw new Error(`The webhook answered ${status}.`);
}
