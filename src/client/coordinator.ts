/** Single-renderer orchestration of persisted queue items via supported DSH Client APIs. */
import type { ISessions, SessionFace, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { QueueSettingsSource } from './settings.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { observeTask } from './observe-task.ts'
import { UNRESOLVED, add, claim, decode, edit, move, next, recover, remove, retry, skip, updateActive,
  type QueueState, type Task } from '../queue.ts'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { goalQueue: unknown }
}

interface Active {
  taskId: string
  epoch: number
  session: SessionFace
  reference: SessionReference
  subscriptions: (() => void)[]
}

/** Serializes edits, guarantees one dispatch slot, never equates a chat response with Goal completion. */
export class Coordinator {
  private chain: Promise<void> = Promise.resolve()
  private live: Active | undefined
  private checking = false
  private repump = false
  private evaluating = false
  private observeAgain = false
  private closed = false
  private booted = false
  /** Never persisted: must be granted by a click in this exact Client generation. */
  private armed = false
  /** A newer Start/Pause click supersedes any unsettled earlier write. */
  private controlIntent = 0
  private epoch = 0
  private readonly disposers: Array<() => void> = []

  private readonly sessions: ISessions
  private readonly workspaces: IWorkspaces
  private readonly settings: QueueSettingsSource
  private readonly connected: () => boolean
  private readonly openSession?: (id: SessionId) => void
  constructor(sessions: ISessions, workspaces: IWorkspaces, settings: QueueSettingsSource, connected: () => boolean, openSession?: (id: SessionId) => void) {
    this.sessions = sessions
    this.workspaces = workspaces
    this.settings = settings
    this.connected = connected
    this.openSession = openSession
  }

  start(): void {
    this.disposers.push(this.settings.subscribe(() => {
      void this.pump()
      // A projection may have settled while settings were refreshing.
      if (this.live && this.settings.getSnapshot().status === 'ready') void this.observe()
    }))
    void this.pump()
  }

  /** Called for a lost or replaced Host generation: no silent session replay. */
  async connectionReset(): Promise<void> {
    if (this.closed) return
    this.armed = false
    this.controlIntent++
    this.epoch++
    this.release()
    // The settings Remote has changed generations; do not write with an obsolete CAS revision.
    // At the next successful Host snapshot, pump() will recover the persisted active task.
    this.booted = false
    void this.pump()
  }

  dispose(): void {
    this.closed = true
    this.armed = false
    this.controlIntent++
    this.epoch++
    this.release()
    for (const dispose of this.disposers.splice(0)) dispose()
  }

  private queue(): QueueState {
    const snapshot = this.settings.getSnapshot()
    if (snapshot.status !== 'ready') throw new Error(snapshot.error ?? 'Host 队列配置未加载；拒绝使用默认空队列')
    const decoded = decode(snapshot.value)
    if (!decoded) throw new Error('队列配置无效；拒绝使用默认空队列')
    return decoded.queue
  }

  /** Local quarantine is independent of the Host write result. */
  private quarantine(reason: string): void {
    this.armed = false
    this.controlIntent++
    this.booted = false
    this.settings.failClosed(reason)
    this.release()
  }

  /** Atomic settings-section commit; no intermediate activeId/tasks mismatch. */
  private write(fn: (q: QueueState) => QueueState): Promise<void> {
    const operation = this.chain.catch(() => {}).then(async () => {
      if (this.closed) return
      const previous = this.queue()
      const updated = fn(previous)
      if (updated !== previous) await this.settings.set('queue', updated)
    })
    this.chain = operation.catch(() => {})
    return operation
  }

  add(input: Pick<Task,'title'|'workspaceId'|'prompt'|'goalMode'>): Promise<void> {
    return this.write(q => add(q, input, crypto.randomUUID()))
  }
  edit(id: string, input: Pick<Task,'title'|'workspaceId'|'prompt'|'goalMode'>): Promise<void> {
    return this.write(q => edit(q, id, input))
  }
  remove(id: string): Promise<void> { return this.write(q => remove(q, id)) }
  move(id: string, offset: -1|1): Promise<void> { return this.write(q => move(q, id, offset)) }
  retry(id: string): Promise<void> { return this.write(q => retry(q, id)) }
  skip(id: string): Promise<void> { return this.write(q => skip(q, id)) }
  async enable(enabled: boolean): Promise<void> {
    const intent = ++this.controlIntent
    if (!enabled) this.armed = false
    const generation = this.epoch
    await this.write(q => {
      if (intent !== this.controlIntent) return q
      if (!this.booted || !this.connected() || generation !== this.epoch) {
        throw new Error('连接或恢复尚未就绪；不能启用队列')
      }
      if (enabled && q.tasks.some(t => UNRESOLVED.includes(t.status))) {
        throw new Error('存在未处置的异常任务；先检查旧 Session，然后逐项重新排队或手工跳过')
      }
      return { ...q, enabled, error: enabled ? '' : q.error }
    })
    if (enabled && intent === this.controlIntent) {
      if (this.closed || generation !== this.epoch || !this.connected() || !this.booted) {
        throw new Error('连接状态已变化；队列必须重新手工启用')
      }
      this.armed = true
      void this.pump()
    }
  }
  open(id: string): void {
    const t = this.queue().tasks.find(t => t.id === id)
    if (t?.sessionId) this.openSession?.(t.sessionId as SessionId)
  }

  private async pump(): Promise<void> {
    if (this.closed) return
    if (this.checking) { this.repump = true; return }
    this.checking = true
    try {
      if (this.settings.getSnapshot().status !== 'ready') return
      if (!this.booted) {
        // Each process/connection generation starts DISARMED. The saved enabled flag
        // is historical state, never permission to submit more model work.
        this.armed = false
        await this.write(q => recover(q, '程序启动或连接重置；需检查旧 Session 并手工启动队列'))
        this.booted = true
        return
      }
      if (!this.armed || this.live || !this.connected()) return
      const task = next(this.queue())
      if (!task) return
      const generation = this.epoch
      await this.write(q => claim(q, task.id))
      // An interrupted claim must not launch a Session even if the Host committed it.
      if (generation !== this.epoch || this.closed || !this.armed || !this.connected()) return
      await this.dispatch(task)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.error('[dsh-goal-queue] unsafe dispatch state; queue quarantined', error)
      this.quarantine(`调度状态不可确认，已禁止继续执行：${reason}。请检查旧 Session 并手工重载。`)
    } finally {
      this.checking = false
      if (this.repump) { this.repump = false; queueMicrotask(() => { void this.pump() }) }
    }
  }

  private async dispatch(task: Task): Promise<void> {
    const generation = this.epoch
    let created = false
    let submitted = false
    try {
      const workspace = this.workspaces.list.getSnapshot().items.find(w => w.workspaceId === task.workspaceId)
      if (!workspace) throw new Error('任务工作区已删除；停止队列')
      // A new Session avoids contaminating a prior project's conversation or goal.
      const sessionId = await this.sessions.create({ workspaceId: workspace.workspaceId })
      created = true
      if (generation !== this.epoch || this.closed) return
      await this.write(q => updateActive(q, task.id, { sessionId }))
      const reference = this.sessions.retain(sessionId, { source: 'goalQueue' })
      try { await reference.ready } catch (error) { reference.release(); throw error }
      if (generation !== this.epoch || this.closed) { reference.release(); return }
      const session = reference.binding.session
      const active: Active = { taskId: task.id, epoch: generation, session, reference, subscriptions: [] }
      this.live = active
      active.subscriptions.push(session.subscribe(() => { void this.observe() }))
      active.subscriptions.push(session.projections.faceOf('goal').subscribe(() => { void this.observe() }))
      // /goal must pass through the command plane: a normal model prompt is NOT a goal.
      if (task.goalMode) {
        const text = task.prompt.replace(/\s+/g, ' ').trim()
        submitted = true
        const result = await session.command(`/goal ${text}`)
        if (!result.ok) throw new Error(result.error.message)
        if (!result.value.matched) throw new Error('未安装 DSH 原生 /goal 命令；目标模式无法启动')
      } else {
        submitted = true
        const result = await session.prompt([{ type: 'text', text: task.prompt }], 'queue')
        if (!result.ok) throw new Error(result.error.message)
      }
      if (generation !== this.epoch || this.closed) return
      await this.write(q => updateActive(q, task.id, { status: 'running' }))
      await this.observe()
    } catch (error) {
      // A successful/ambiguous Host admission can continue even after a Client error.
      // Never silently retry or dispatch a second task after such a failure.
      this.armed = false
      if (generation === this.epoch && !this.closed) {
        const detail = error instanceof Error ? error.message : String(error)
        try {
          await this.fail(task.id, created ? 'interrupted' : 'failed',
            `${detail}；${created ? (submitted ? '命令可能已提交' : 'Session 已创建') : 'Session 创建未确认'}，请人工核实旧 Session`)
        } catch (persistError) {
          console.error('[dsh-goal-queue] cannot persist failure', persistError)
          this.quarantine(`无法保存任务失败状态（${detail}）；旧 Session 可能仍在执行。请手工检查和重载。`)
        }
      }
    }
  }

  private release(): void {
    const live = this.live
    this.live = undefined
    if (!live) return
    for (const stop of live.subscriptions.splice(0)) stop()
    live.reference.release()
  }

  private async fail(id: string, status: 'failed'|'blocked'|'interrupted', detail: string): Promise<void> {
    this.armed = false
    await this.write(q => q.activeId === id ? updateActive(q, id, { status, detail }) : q)
    if (this.live?.taskId === id) this.release()
  }

  private async observe(): Promise<void> {
    if (this.closed || this.settings.getSnapshot().status !== 'ready') return
    if (this.evaluating) { this.observeAgain = true; return }
    this.evaluating = true
    try {
      const active = this.live
      if (!active || active.epoch !== this.epoch) return
      const finished = await observeTask(active.session, {
        current: () => this.queue().tasks.find(t => t.id === active.taskId),
        update: async patch => { await this.write(q => updateActive(q, active.taskId, patch)) },
        fail: async (status, detail) => { await this.fail(active.taskId, status, detail) },
      })
      if (!finished || this.live !== active || active.epoch !== this.epoch) return
      this.release()
      // The settings subscription may have fired while `live` was still retained.
      void this.pump()
    } catch (error) {
      console.error('[dsh-goal-queue] observe failed', error)
      const id = this.live?.taskId
      this.armed = false
      if (id) {
        try {
          await this.fail(id, 'interrupted', error instanceof Error ? error.message : String(error))
        } catch (persistError) {
          console.error('[dsh-goal-queue] failed to persist observed error', persistError)
          this.quarantine('执行状态写入失败，旧 Session 可能仍在运行；请人工检查并重载配置')
        }
      }
    } finally {
      this.evaluating = false
      if (this.observeAgain) { this.observeAgain = false; queueMicrotask(() => { void this.observe() }) }
    }
  }
}
