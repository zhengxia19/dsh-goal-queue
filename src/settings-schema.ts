/** Host-validated durable settings section. Only data, never a duplicate goal database. */
import z from '@deepseek-ai/schemastery'
import { STATES } from './queue.ts'
export const queueSchema = z.object({
  version: z.const(1).default(1).volatile(),
  queue: z.object({
    enabled: z.boolean().default(false),
    activeId: z.union([z.string(), z.const(null)]).default(null),
    error: z.string().default(''),
    tasks: z.array(z.object({
      id: z.string(), workspaceId: z.string(), title: z.string(), prompt: z.string(),
      goalMode: z.boolean(), status: z.union([...STATES]),
      sessionId: z.union([z.string(), z.const(undefined)]), goalId: z.union([z.string(), z.const(undefined)]),
      seenRunning: z.union([z.boolean(), z.const(undefined)]), detail: z.union([z.string(), z.const(undefined)]),
      createdAt: z.number(), updatedAt: z.number(),
    })).default([]),
  }).default({ enabled: false, activeId: null, error: '', tasks: [] }).volatile(),
})
