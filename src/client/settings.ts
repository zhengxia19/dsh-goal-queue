/** v0.2.1-rc.2 queue persistence through the official revisioned Host settings Remote. */
import type { Context } from '@deepseek-ai/cordis'
import { decode, type QueueSettings, type QueueState } from '../queue.ts'

export interface QueueSettingsSnapshot {
  readonly value?: QueueSettings
  readonly status: 'loading' | 'ready' | 'error'
  readonly error?: string
}
export interface QueueSettingsSource {
  getSnapshot(): QueueSettingsSnapshot
  subscribe(listener: () => void): () => void
  set(field: 'queue', value: QueueState): Promise<void>
}

/** The Host profile owns the queue. A failed read or CAS write always fails closed. */
export class HostQueueSettings implements QueueSettingsSource {
  private snapshot: QueueSettingsSnapshot = { status: 'loading' }
  private revision: number | undefined
  private listeners = new Set<() => void>()
  private tail: Promise<void> = Promise.resolve()
  private disposed = false
  private generation = 0
  private readonly unsubscribers: Array<() => void> = []

  private readonly ctx: Context
  constructor(ctx: Context) { this.ctx = ctx }

  start(): void {
    this.unsubscribers.push(this.ctx.remote.$on('settings/document-updated', (ns: string) => {
      if (ns === 'goal-queue') void this.refresh()
    }))
    this.unsubscribers.push(this.ctx.on('connection/reset', () => {
      // No previous Host state is trustworthy after a generation change.
      this.generation++
      this.revision = undefined
      this.publish({ status: 'loading' })
      void this.refresh()
    }))
    void this.refresh()
  }

  getSnapshot(): QueueSettingsSnapshot { return this.snapshot }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish(next: QueueSettingsSnapshot): void {
    if (this.disposed) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }

  private serialize(work: () => Promise<void>): Promise<void> {
    const task = this.tail.catch(() => {}).then(async () => { if (!this.disposed) await work() })
    this.tail = task.catch(() => {})
    return task
  }

  refresh(): Promise<void> {
    // Serialize read/write so a stale read cannot overwrite a newer committed queue.
    return this.serialize(async () => {
      const generation = this.generation
      try {
        const response = await this.ctx.remote.settings.describe()
        if (!response.ok) throw new Error(response.error.message)
        const view = response.value.namespaces.find((ns: { ns: string }) => ns.ns === 'goal-queue')
        if (!view) throw new Error('未找到 goal-queue 配置；请确认原生插件 Host 端已安装并启用')
        const value = decode(view.value)
        if (!value) throw new Error('持久队列格式无效；拒绝以空队列覆盖已有记录')
        if (generation !== this.generation) return
        this.revision = view.revision
        this.publish({ value, status: 'ready' })
      } catch (error) {
        if (generation !== this.generation) return
        this.revision = undefined
        this.publish({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    })
  }

  set(field: 'queue', value: QueueState): Promise<void> {
    return this.serialize(async () => {
      if (this.snapshot.status !== 'ready' || this.revision === undefined) {
        throw new Error(this.snapshot.error ?? '持久化未就绪；拒绝执行队列操作')
      }
      const generation = this.generation
      const response = await this.ctx.remote.settings.mutate(
        'goal-queue', [{ op: 'set', path: [field], value }], this.revision,
      )
      if (!response.ok) {
        this.revision = undefined
        this.publish({ status: 'error', error: `写入失败（${response.error.code}）：${response.error.message}。队列已停止；请重新加载。` })
        throw new Error(response.error.message)
      }
      if (generation !== this.generation) throw new Error('连接已切换；提交结果不再可信')
      const decoded = decode(response.value.value)
      if (!decoded) {
        this.revision = undefined
        this.publish({ status: 'error', error: 'Host 返回的队列格式无效，队列已停止' })
        throw new Error('Host 返回的队列格式无效')
      }
      this.revision = response.value.revision
      this.publish({ status: 'ready', value: decoded })
    })
  }

  dispose(): void {
    this.disposed = true
    this.generation++
    for (const fn of this.unsubscribers.splice(0)) fn()
    this.listeners.clear()
  }
}
