/** v0.2.1-rc.2 Host plugin: Cordis-owned volatile config persisted in the active Desktop profile. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { queueSchema } from './settings-schema.ts'
import { registerTitleCommand } from './title-command.ts'

export const name = 'goal-queue'
export const Config = queueSchema
export function apply(ctx: Context): void {
  // Title generation is optional: unavailable Host LLM/command services must not disable the queue.
  ctx.inject(['commands','llm','agentDefaultModel','sessionTitle'], child => { registerTitleCommand(child) })
  // Queue data is edited by the custom dashboard, not the generic settings form.
  ctx.inject(['settings'], child => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
