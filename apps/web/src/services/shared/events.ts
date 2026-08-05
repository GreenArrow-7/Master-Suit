import { logger } from '@/lib/logger';
import type { Ctx } from '@/lib/security/rbac';

export type DomainEvent =
  | 'lead.created' | 'lead.updated' | 'lead.stage_changed' | 'lead.assigned' | 'lead.converted'
  | 'account.created' | 'account.updated'
  | 'contact.created' | 'contact.updated'
  | 'opportunity.created' | 'opportunity.updated' | 'opportunity.stage_changed' | 'opportunity.won' | 'opportunity.lost'
  | 'task.completed' | 'form.submitted' | 'ticket.created' | 'ticket.resolved';

type Listener = (ctx: Ctx, event: DomainEvent, payload: Record<string, unknown>) => void | Promise<void>;

const listeners = new Map<DomainEvent, Listener[]>();

export function on(event: DomainEvent, fn: Listener) {
  listeners.set(event, [...(listeners.get(event) ?? []), fn]);
}

/**
 * Fire-and-forget, and deliberately called AFTER the transaction commits — an
 * automation must never observe a state that was rolled back. A listener that
 * throws is logged and does not fail the request that emitted the event.
 */
export function emit(ctx: Ctx, event: DomainEvent, payload: Record<string, unknown> = {}) {
  logger.debug({ event, tenantId: ctx.tenantId, requestId: ctx.requestId, ...payload }, 'domain event');
  for (const fn of listeners.get(event) ?? []) {
    Promise.resolve(fn(ctx, event, payload)).catch((err) =>
      logger.error({ err, event }, 'event listener failed'),
    );
  }
}
