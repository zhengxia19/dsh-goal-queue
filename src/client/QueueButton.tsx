/** Intentionally lightweight; the queue keeps scheduling when its overlay is closed. */
import type { PropsStore, PropsHooks, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { QueueSettingsSource } from './settings.ts'
import { DEFAULT_SETTINGS, summarizeQueue } from '../queue.ts'
import type { viewStore } from './store.ts'
export type ButtonProps = PropsStore<typeof viewStore> & PropsRuntime<'sidebar.footer.action'>
  & PropsHooks<{queueSettings:QueueSettingsSource}>
export function QueueButton(props: ButtonProps) {
  const snapshot = props.useQueueSettings(s => s)
  const queue = (snapshot.value ?? DEFAULT_SETTINGS).queue
  const summary=summarizeQueue(queue)
  const open = props.useStore(s=>s.open)
  return <button type="button" className="gq-side" aria-label="打开任务队列" aria-expanded={open}
    onClick={()=>props.actions.open()}>任务队列 {snapshot.status === 'loading' ? '(加载中)' : snapshot.status === 'error' ? '(配置错误)' : `(${summary.unresolved?'异常'+summary.unresolved+' · ':''}占用${summary.occupied}（启动${summary.starting} · 运行${summary.observedRunning} · 外部${summary.externalActivity}）· 待执行${summary.pending})`}</button>
}
