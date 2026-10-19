/** Native DSH Desktop/Web client plugin: sidebar action and full-shell task queue. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { HostQueueSettings } from './settings.ts'
import { Coordinator } from './coordinator.ts'
import { viewStore } from './store.ts'
import { QueueBoard } from './QueueBoard.tsx'
import { QueueButton } from './QueueButton.tsx'
import { styles } from './styles.ts'

export const inject = ['slots','sessions','workspaces','uiWorkspace','connection','remote','remote.settings']
export function apply(ctx: Context): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const settings = new HostQueueSettings(ctx)
  settings.start()
  const coordinator = new Coordinator(ctx.sessions, ctx.workspaces, settings,
    () => connection.generation.getSnapshot() !== undefined,
    (id) => ctx.uiWorkspace.openSession(id))
  coordinator.start()
  ctx.effect(() => { const css = document.createElement('style'); css.dataset.plugin = 'goal-queue'
    css.textContent = styles; document.head.appendChild(css); return () => { css.remove() } }, 'goal-queue:style')
  ctx.effect(() => () => { coordinator.dispose(); settings.dispose() }, 'goal-queue:dispose')
  ctx.effect(() => ctx.on('connection/reset', () => { void coordinator.connectionReset() }), 'goal-queue:connection')
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'goal-queue', order: -11,
    store: viewStore, inject: () => ({ hooks: { queueSettings: settings } }),
  }, QueueButton))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'goal-queue', order: 11, store: viewStore,
    inject: () => ({
      hooks: { queueSettings: settings, workspaces: ctx.workspaces.list },
      operations: {
        add: coordinator.add.bind(coordinator), edit: coordinator.edit.bind(coordinator),
        remove: coordinator.remove.bind(coordinator), move: coordinator.move.bind(coordinator),
        retry: coordinator.retry.bind(coordinator), skip: coordinator.skip.bind(coordinator),
        enable: coordinator.enable.bind(coordinator), refresh: settings.refresh.bind(settings),
        discover: coordinator.discover.bind(coordinator),
        resumeGoal: coordinator.resumeGoal.bind(coordinator),
        setConcurrency: coordinator.setConcurrency.bind(coordinator),
        open: coordinator.open.bind(coordinator),
      },
    }),
  }, QueueBoard))
}
