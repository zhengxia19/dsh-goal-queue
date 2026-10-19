/** Intentionally lightweight; the queue keeps scheduling when its overlay is closed. */
import type { PropsStore, PropsHooks, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { QueueSettingsSource } from './settings.ts'
import { DEFAULT_SETTINGS } from '../queue.ts'
import type { viewStore } from './store.ts'
export type ButtonProps = PropsStore<typeof viewStore> & PropsRuntime<'sidebar.footer.action'>
  & PropsHooks<{queueSettings:QueueSettingsSource}>
export function QueueButton(props: ButtonProps) {
  const snapshot = props.useQueueSettings(s => s)
  const queue = (snapshot.value ?? DEFAULT_SETTINGS).queue
  const running = queue.tasks.filter(t=>t.status==='running'||t.status==='starting').length
  const open = props.useStore(s=>s.open)
  return <button type="button" className="gq-side" aria-label="打开任务队列" aria-expanded={open}
    onClick={()=>props.actions.open()}>任务队列 {snapshot.status === 'loading' ? '(加载中)' : snapshot.status === 'error' ? '(配置错误)' : running ? `(${running} 运行中)` : `(${queue.tasks.filter(t=>t.status==='pending').length} 待执行)`}</button>
}
