import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { requestSignup } from '@/services/platform/signup';

/**
 * Self-serve sign-up, step one: mail a confirmation link. A 404 while the
 * platform owner keeps sign-up closed. The answer is the same whether or not
 * the address already has an account here.
 */
const body = z
  .object({
    companyName: z.string().trim().min(2).max(120),
    slug: z
      .string()
      .trim()
      .min(3)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case letters, numbers and hyphens.'),
    fullName: z.string().trim().min(2).max(160),
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(200),
  })
  .strict();

export const POST = route(
  { module: 'settings', action: 'CREATE', anonymous: true, body, rateLimit: { max: 5, windowSeconds: 3600 } },
  async ({ body }) => {
    await requestSignup(body);
    return { ok: true, message: 'Check your email: the link there creates your workspace.' };
  },
);
