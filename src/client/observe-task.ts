/** Authoritative single-task evidence rules, independent of queue-pump lifecycle. */
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type { Task } from '../queue.ts'

interface Projection { goal: { id: string; objective: string; phase: string }; roundsStarted: number }

export interface ObservationOperations {
  current(): Task | undefined
  update(patch: Partial<Task>): Promise<void>
  fail(status: 'failed' | 'blocked' | 'interrupted', detail: string): Promise<void>
}

/** Returns true only after successfully persisting `completed`. Never guesses completion. */
export async function observeTask(session: SessionFace, ops: ObservationOperations): Promise<boolean> {
  const snapshot = session.getSnapshot()
  const raw = session.projections.faceOf('goal').getSnapshot()
  const projection = (raw && typeof raw === 'object' && 'goal' in raw && raw.goal)
    ? raw as Projection : undefined
  const current = ops.current()
  if (!current || (current.status !== 'running' && current.status !== 'starting')) return false
  if (snapshot.lastAgentError) {
    await ops.fail('failed', snapshot.lastAgentError)
    return false
  }
  if (current.status === 'starting') {
    if (snapshot.running && !current.seenRunning) await ops.update({ seenRunning: true })
    return false
  }
  const patch: Partial<Task> = {}
  if (snapshot.running && !current.seenRunning) patch.seenRunning = true
  if (current.goalMode && projection && !current.goalId) {
    if (projection.goal.objective !== current.prompt.replace(/\s+/g, ' ').trim()) {
      await ops.fail('failed', 'Goal 投影与提交目标不匹配；拒绝使用错误的完成信号')
      return false
    }
    patch.goalId = projection.goal.id
  }
  if (Object.keys(patch).length) await ops.update(patch)
  const latest = ops.current()
  if (!latest || latest.status !== 'running') return false
  if (latest.goalMode) {
    if (!projection || !latest.goalId || latest.goalId !== projection.goal.id) return false
    if (projection.goal.phase === 'blocked' || projection.goal.phase === 'paused') {
      await ops.fail('blocked', `Goal ${projection.goal.phase}；队列已暂停`)
      return false
    }
    if (projection.goal.phase !== 'complete' || snapshot.running) return false
  } else if (!latest.seenRunning || snapshot.running || snapshot.awaitingFirstTurn) {
    // Ordinary mode needs a witnessed running -> idle edge, not just RPC acceptance.
    return false
  }
  await ops.update({ status: 'completed', detail: 'DSH 执行状态已结束（不代表人工代码验收通过）' })
  return true
}
