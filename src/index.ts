/** Host plugin: register the settings schema, Client owns the local desktop runtime. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { queueSchema } from './settings-schema.ts'
export const name = 'goal-queue'
export const inject: string[] = []
export function apply(ctx: Context): void {
  ctx.inject(['settings'], settingsCtx => {
    settingsCtx.settings.register('goal-queue', queueSchema)
  })
}
