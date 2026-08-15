import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { runAssistant } from '@/lib/ai/assistant/service';

const body = z
  .object({
    messages: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) }))
      .min(1)
      .max(20),
    context: z
      .object({
        entityType: z.enum(['lead', 'account', 'contact', 'opportunity', 'call']),
        entityId: z.string().cuid(),
      })
      .optional(),
  })
  .strict();

/**
 * Manath AI. The model never sees the database — see lib/ai/assistant. SSE out:
 * status / delta / sources / action / done / error events, one JSON per line.
 * Rate-limited per user so a chat loop cannot burn the model budget. The AI
 * activity log (user, tools used, page, errors) is the structured log line the
 * service emits per request — content is deliberately not stored.
 */
export const POST = route(
  {
    module: 'leads',
    productModule: 'SALES',
    action: 'VIEW',
    body,
    rateLimit: { max: 30, windowSeconds: 300 },
  },
  async ({ ctx, body }) => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of runAssistant(ctx, body.messages, body.context)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
        } finally {
          try {
            controller.close();
          } catch {
            /* client went away */
          }
        }
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform' },
    });
  },
);
