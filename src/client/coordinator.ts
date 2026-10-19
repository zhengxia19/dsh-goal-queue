/** Single-renderer orchestration of persisted queue items via supported DSH Client APIs. */
import type { ISessions, SessionReference, SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { EMPTY_QUEUE, add, claim, decode, edit, move, next, recover, remove, retry, updateActive,
  type QueueSettings, type QueueState, type Task } from '../queue.ts'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { goalQueue: unknown }
}

interface Active {
  taskId: string
  epoch: number
  reference: SessionReference
  session: SessionFace
  subscriptions: (() => void)[]
}
interface Projection { goal: { id: string; objective: string; phase: string }; roundsStarted: number }

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
  private epoch = 0
  private readonly disposers: Array<() => void> = []

  private readonly sessions: ISessions
  private readonly workspaces: IWorkspaces
  private readonly settings: SettingsScope<QueueSettings>
  private readonly connected: () => boolean
  constructor(sessions: ISessions, workspaces: IWorkspaces, settings: SettingsScope<QueueSettings>, connected: () => boolean) {
    this.sessions = sessions
    this.workspaces = workspaces
    this.settings = settings
    this.connected = connected
  }

  start(): void {
    this.disposers.push(this.settings.subscribe(() => { void this.pump() }))
    void this.pump()
  }

  /** Called for a lost or replaced Host generation: no silent session replay. */
  async connectionReset(): Promise<void> {
    if (this.closed || !this.booted) return
    this.epoch++
    this.release()
    await this.write(q => recover(q, 'DSH 连接已重置；请检查旧 Session，确认后手动重排'))
  }

  dispose(): void {
    this.closed = true
    this.epoch++
    this.release()
    for (const dispose of this.disposers.splice(0)) dispose()
  }

  private queue(): QueueState {
    const snapshot = this.settings.getSnapshot().value
    return decode(snapshot)?.queue ?? EMPTY_QUEUE
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
  enable(enabled: boolean): Promise<void> {
    return this.write(q => ({ ...q, enabled, error: enabled ? '' : q.error }))
  }
  open(id: string): void {
    const t = this.queue().tasks.find(t => t.id === id)
    if (t?.sessionId) this.sessions.open(t.sessionId as SessionId)
  }

  private async pump(): Promise<void> {
    if (this.closed) return
    if (this.checking) { this.repump = true; return }
    this.checking = true
    try {
      if (!this.booted) {
        // Loading is asynchronous. Do not interpret missing settings as an empty saved queue.
        if (this.settings.getSnapshot().value === undefined) return
        this.booted = true
        if (this.queue().activeId !== null) {
          await this.write(q => recover(q))
          return
        }
      }
      if (this.live || !this.connected()) return
      const task = next(this.queue())
      if (task === undefined) return
      await this.write(q => claim(q, task.id))
      await this.dispatch(task)
    } catch (error) {
      console.error('[dsh-goal-queue] dispatch failed', error)
    } finally {
      this.checking = false
      if (this.repump) { this.repump = false; queueMicrotask(() => { void this.pump() }) }
    }
  }

  private async dispatch(task: Task): Promise<void> {
    const generation = this.epoch
    let reference: SessionReference | undefined
    let ownershipTransferred = false
    try {
      const workspace = this.workspaces.list.getSnapshot().items.find(w => w.workspaceId === task.workspaceId)
      if (!workspace) throw new Error('任务工作区已删除；停止队列')
      // A new Session avoids contaminating a prior project's conversation or goal.
      const sessionId = await this.sessions.create({ workspaceId: workspace.workspaceId })
      if (generation !== this.epoch || this.closed) return
      await this.write(q => updateActive(q, task.id, { sessionId }))
      reference = this.sessions.retain(sessionId, { source: 'goalQueue' })
      await reference.ready
      if (generation !== this.epoch || this.closed) return
      const session = reference.binding.session
      const active: Active = { taskId: task.id, epoch: generation, reference, session, subscriptions: [] }
      this.live = active
      ownershipTransferred = true
      active.subscriptions.push(session.subscribe(() => { void this.observe() }))
      active.subscriptions.push(session.projections.faceOf('goal').subscribe(() => { void this.observe() }))
      // /goal must pass through the command plane: a normal model prompt is NOT a goal.
      if (task.goalMode) {
        const text = task.prompt.replace(/\s+/g, ' ').trim()
        const result = await session.command(`/goal ${text}`)
        if (!result.ok) throw new Error(result.error.message)
        if (!result.value.matched) throw new Error('未安装 DSH 原生 /goal 命令；目标模式无法启动')
      } else {
        const result = await session.prompt([{ type: 'text', text: task.prompt }], 'queue')
        if (!result.ok) throw new Error(result.error.message)
      }
      if (generation !== this.epoch || this.closed) return
      await this.write(q => updateActive(q, task.id, { status: 'running' }))
      await this.observe()
    } catch (error) {
      if (generation === this.epoch && !this.closed) {
        await this.fail(task.id, 'failed', error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (!ownershipTransferred && reference) reference.release()
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
    await this.write(q => q.activeId === id ? updateActive(q, id, { status, detail }) : q)
    if (this.live?.taskId === id) this.release()
  }

  private async observe(): Promise<void> {
    if (this.closed) return
    if (this.evaluating) { this.observeAgain = true; return }
    this.evaluating = true
    try {
      const active = this.live
      if (!active || active.epoch !== this.epoch) return
      const snapshot = active.session.getSnapshot()
      const raw = active.session.projections.faceOf('goal').getSnapshot()
      const projection = (raw && typeof raw === 'object' && 'goal' in raw) ? raw as Projection : undefined
      const current = this.queue().tasks.find(t => t.id === active.taskId)
      if (!current || current.status !== 'running' && current.status !== 'starting') return
      if (snapshot.lastAgentError) {
        await this.fail(active.taskId, 'failed', snapshot.lastAgentError)
        return
      }
      if (current.status === 'starting') {
        // Record an observed running edge even if the prompt finishes before admission returns.
        // Never interpret pre-admission idle as completion.
        if (snapshot.running && !current.seenRunning) {
          await this.write(q => updateActive(q, active.taskId, { seenRunning: true }))
        }
        return
      }
      const patch: Partial<Task> = {}
      if (snapshot.running && !current.seenRunning) patch.seenRunning = true
      if (current.goalMode && projection && !current.goalId) {
        if (projection.goal.objective !== current.prompt.replace(/\s+/g, ' ').trim()) {
          await this.fail(active.taskId, 'failed', 'Goal 投影与提交目标不匹配；拒绝使用错误的完成信号')
          return
        }
        patch.goalId = projection.goal.id
      }
      if (Object.keys(patch).length) await this.write(q => updateActive(q, active.taskId, patch))
      const latest = this.queue().tasks.find(t => t.id === active.taskId)
      if (!latest) return
      if (latest.goalMode) {
        if (!projection || !latest.goalId || latest.goalId !== projection.goal.id) return
        if (projection.goal.phase === 'blocked' || projection.goal.phase === 'paused') {
          await this.fail(active.taskId, 'blocked', `Goal ${projection.goal.phase}；队列已暂停`)
          return
        }
        if (projection.goal.phase !== 'complete' || snapshot.running) return
      } else {
        // One ordinary turn; only a *witnessed* running -> idle transition may complete it.
        if (!latest.seenRunning || snapshot.running || snapshot.awaitingFirstTurn) return
      }
      await this.write(q => updateActive(q, active.taskId, { status: 'completed', detail: 'DSH 执行状态已结束（不代表人工代码验收通过）' }))
      this.release()
      // The settings subscription may have fired while `live` was still retained.
      void this.pump()
    } catch (error) {
      console.error('[dsh-goal-queue] observe failed', error)
      const id = this.live?.taskId
      if (id) await this.fail(id, 'failed', error instanceof Error ? error.message : String(error))
    } finally {
      this.evaluating = false
      if (this.observeAgain) { this.observeAgain = false; queueMicrotask(() => { void this.observe() }) }
    }
  }
}
