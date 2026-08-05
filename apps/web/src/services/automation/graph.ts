import { z } from 'zod';
import { filterTreeSchema } from '@/lib/api/filterTree';

const nodeBase = z.object({ id: z.string() });

export const triggerNode = nodeBase.extend({
  type: z.literal('trigger'),
  spec: z.object({ event: z.string(), object: z.string() }),
  next: z.string().nullable().optional(),
});

export const conditionNode = nodeBase.extend({
  type: z.literal('condition'),
  spec: z.object({ filter: filterTreeSchema }),
  branches: z.object({ true: z.string().nullable(), false: z.string().nullable() }),
});

export const actionNode = nodeBase.extend({
  type: z.literal('action'),
  spec: z.object({ action: z.string() }).catchall(z.unknown()),
  next: z.string().nullable().optional(),
});

export const waitNode = nodeBase.extend({
  type: z.literal('wait'),
  spec: z.object({ durationMinutes: z.number().positive() }),
  next: z.string().nullable().optional(),
});

export const stopNode = nodeBase.extend({ type: z.literal('stop'), spec: z.object({}).optional() });

export const graphNode = z.discriminatedUnion('type', [triggerNode, conditionNode, actionNode, waitNode, stopNode]);
export type GraphNode = z.infer<typeof graphNode>;

export const automationGraph = z.object({
  entry: z.string(),
  nodes: z.array(graphNode).min(1),
});
export type AutomationGraph = z.infer<typeof automationGraph>;

export function findNode(graph: AutomationGraph, id: string): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}
