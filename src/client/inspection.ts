/** U06 (design §6.4): read-only verification before any disposition. Zero writes, no claim. */
import { QueueError } from '../errors.ts'
import { UNRESOLVED, attemptsOf, summarizeQueue, type QueueState } from '../queue.ts'
import type { SessionDirectory } from './directory.ts'

/** Read-only view of the Goal projection owned by a Session (goal id + lifecycle phase). */
export interface GoalRef { id: string; phase: string }
export interface GoalGateway {
  /** undefined = no readable Goal projection (missing Session, no goal, or degraded read). */
  goalOf(sessionId: string): Promise<GoalRef | undefined>
}

export interface TaskInspection {
  taskId: string
  sessionFound: boolean
  sessionRunning: boolean
  /** null = not goal mode or no recorded goalId (nothing to compare). */
  goalIdMatches: boolean | null
  canResume: boolean
  canRetry: boolean
  canSkip: boolean
  canRequeueEdited: boolean
  reasons: Partial<Record<'resume' | 'retry' | 'skip' | 'requeueEdited', string>>
  warnings: string[]
}

/**
 * Verify facts before offering actions: Session existence/run state from the trusted
 * directory, Goal identity from the Session's own projection, and per-action availability
 * with reasons. Availability here never replaces the re-check each operation performs
 * at submission time (design §8.3, 清单 §5).
 */
export async function inspectTask(id: string, deps: {
  queue: () => QueueState
  directory: SessionDirectory
  goals: GoalGateway
}): Promise<TaskInspection> {
  const q = deps.queue()
  const task = q.tasks.find(t => t.id === id)
  if (!task) throw new QueueError('TASK_NOT_FOUND', '任务已不存在')
  const snapshot = await deps.directory.list()
  const row = task.sessionId ? snapshot.rows.find(r => r.sessionId === task.sessionId) : undefined
  const sessionFound = row !== undefined
  const sessionRunning = row?.running === true
  const attempts = attemptsOf(task)
  const last = attempts[attempts.length - 1]
  const unresolved = UNRESOLVED.includes(task.status)

  let goal: GoalRef | undefined
  if (task.sessionId && task.goalMode) goal = await deps.goals.goalOf(task.sessionId)
  const goalIdMatches = task.goalMode && task.goalId
    ? (goal !== undefined && goal.id === task.goalId)
    : null

  const reasons: TaskInspection['reasons'] = {}
  // U13: the sole execution slot also gates resume — claimGoalResume would throw CAPACITY_FULL.
  // OBS-8: occupancy uses summarizeQueue's deduplicated count — the same measure the Board shows.
  const slotTaken = summarizeQueue(q).occupied >= q.maxConcurrent
  const resumable = ['interrupted', 'blocked'].includes(task.status) && task.goalMode
    && Boolean(task.sessionId) && sessionFound && !sessionRunning
    && goal !== undefined && ['active', 'paused', 'blocked'].includes(goal.phase)
    && (!task.goalId || goal.id === goal.id)
  const canResume = resumable && !slotTaken
  if (!canResume) reasons.resume =
    !['interrupted', 'blocked'].includes(task.status) ? '只有已中断或阻塞的任务可以恢复'
      : !task.goalMode ? '普通模式任务没有可恢复的原 Goal'
        : !task.sessionId || !sessionFound ? '原 Session 已不存在，无法恢复'
          : sessionRunning ? '原 Session 正在运行，请刷新运行任务，勿重复恢复'
            : !goal || !['active', 'paused', 'blocked'].includes(goal.phase) ? '原 Session 中没有可恢复的 Goal'
              : task.goalId && goal.id !== task.goalId ? '原 Goal ID 已改变，拒绝恢复'
                : '当前执行名额已被占用'

  const canRetry = unresolved && Boolean(task.prompt.trim()) && !sessionRunning
  if (!canRetry) reasons.retry =
    !unresolved ? '任务当前不需要处置'
      : sessionRunning ? '原会话仍在运行，请先处置'
        : '导入的 Session 没有可复用的任务说明，不能重新派发'

  const canSkip = unresolved && !sessionRunning
  if (!canSkip) reasons.skip =
    !unresolved ? '只能人工跳过未处置的异常任务' : '原会话仍在运行，请先处置'

  // design §6.1: provable only for UNRESOLVED with the last attempt in claimed/precheck and no Session.
  const canRequeueEdited = unresolved && last !== undefined
    && !last.sessionId && (last.phase === 'claimed' || last.phase === 'precheck')
  if (!canRequeueEdited) reasons.requeueEdited =
    !unresolved ? '任务当前不需要处置'
      : last === undefined || last.phase === undefined ? '派发阶段未记录，无法证明命令未提交'
        : last.sessionId ? '会话已创建、命令提交状态需先核实原会话'
          : '命令提交状态未知，保守处理，不能编辑重排队'

  const warnings: string[] = []
  if (task.needsReview) warnings.push('该任务已被标记待核实：身份或执行边界需要人工确认')
  if (unresolved && !task.sessionId && !last?.sessionId) warnings.push('任务没有原 Session ID，无法核实是否已执行')
  if (sessionRunning && !q.activeIds.includes(task.id)) warnings.push('原 Session 仍在运行，且不在队列观察范围内')
  if (goalIdMatches === false) warnings.push('原 Session 的 Goal ID 与任务记录不一致')

  return {
    taskId: id, sessionFound, sessionRunning, goalIdMatches,
    canResume, canRetry, canSkip, canRequeueEdited, reasons, warnings,
  }
}
