/** Host-validated durable settings section. Only data, never a duplicate goal database. */
import z from '@deepseek-ai/schemastery'
import { STATES } from './queue.ts'
export const queueSchema = z.object({
  version: z.const(1).default(1).volatile(),
  queue: z.object({
    enabled: z.boolean().default(false),
    activeId: z.union([z.string(), z.const(null)]).default(null),
    activeIds: z.array(z.string()).default([]),
    sessionActivity: z.array(z.string()).default([]),
    maxConcurrent: z.number().step(1).min(1).max(8).default(1),
    error: z.string().default(''),
    tasks: z.array(z.object({
      id: z.string(), workspaceId: z.string(), title: z.string(), prompt: z.string(),
      goalMode: z.boolean(), generateTitle: z.union([z.boolean(), z.const(undefined)]),
      titleMaxChars: z.union([z.number().step(1).min(8).max(80),z.const(undefined)]), source: z.union([z.const('queue'),z.const('discovered'),z.const(undefined)]), status: z.union([...STATES]),
      modelSelection: z.union([z.object({provider:z.string(),model:z.string(),reasoningEffort:z.union([z.string(),z.const(undefined)])}),z.const(undefined)]),
      sessionId: z.union([z.string(), z.const(undefined)]), goalId: z.union([z.string(), z.const(undefined)]),
      seenRunning: z.union([z.boolean(), z.const(undefined)]), detail: z.union([z.string(), z.const(undefined)]),
      titleError: z.union([z.string(), z.const(undefined)]),
      attempts: z.union([z.array(z.object({
        id:z.string(),status:z.union([...STATES]),
        sessionId:z.union([z.string(),z.const(undefined)]),
        goalId:z.union([z.string(),z.const(undefined)]),
        seenRunning:z.union([z.boolean(),z.const(undefined)]),
        detail:z.union([z.string(),z.const(undefined)]),
        titleError:z.union([z.string(),z.const(undefined)]),
        createdAt:z.number(),updatedAt:z.number(),
      })),z.const(undefined)]),
      createdAt: z.number(), updatedAt: z.number(),
    })).default([]),
  }).default({ enabled: false, activeId: null, activeIds: [], sessionActivity: [], maxConcurrent: 1, error: '', tasks: [] }).volatile(),
})
