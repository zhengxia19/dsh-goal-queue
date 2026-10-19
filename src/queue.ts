/** Pure persisted queue domain. No model-generated text is accepted as completion evidence. */
export const VERSION = 1 as const
export type TaskStatus = 'pending' | 'starting' | 'running' | 'completed' | 'blocked' | 'failed' | 'interrupted'
export interface Task {
  id: string
  workspaceId: string
  title: string
  prompt: string
  goalMode: boolean
  status: TaskStatus
  sessionId?: string
  goalId?: string
  seenRunning?: boolean
  detail?: string
  createdAt: number
  updatedAt: number
}
export interface QueueState {
  enabled: boolean
  activeId: string | null
  tasks: Task[]
  error: string
}
export interface QueueSettings { version: 1; queue: QueueState }
export const EMPTY_QUEUE: QueueState = { enabled: false, activeId: null, tasks: [], error: '' }
export const DEFAULT_SETTINGS: QueueSettings = { version: VERSION, queue: EMPTY_QUEUE }
export const STATES: readonly TaskStatus[] = ['pending', 'starting', 'running', 'completed', 'blocked', 'failed', 'interrupted']
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
export function decode(value: unknown): QueueSettings | undefined {
  if (!object(value) || value.version !== VERSION || !object(value.queue)) return undefined
  const q = value.queue
  if (typeof q.enabled !== 'boolean' || !(q.activeId === null || typeof q.activeId === 'string') || typeof q.error !== 'string' || !Array.isArray(q.tasks)) return undefined
  const ids = new Set<string>(), tasks: Task[] = []
  for (const t of q.tasks) {
    if (!object(t) || typeof t.id !== 'string' || t.id.length === 0 || ids.has(t.id)
      || typeof t.workspaceId !== 'string' || typeof t.title !== 'string'
      || typeof t.prompt !== 'string' || typeof t.goalMode !== 'boolean'
      || !STATES.includes(t.status as TaskStatus)
      || typeof t.createdAt !== 'number' || !Number.isFinite(t.createdAt)
      || typeof t.updatedAt !== 'number' || !Number.isFinite(t.updatedAt)
      || (t.sessionId !== undefined && typeof t.sessionId !== 'string')
      || (t.goalId !== undefined && typeof t.goalId !== 'string')
      || (t.seenRunning !== undefined && typeof t.seenRunning !== 'boolean')
      || (t.detail !== undefined && typeof t.detail !== 'string')) return undefined
    ids.add(t.id)
    tasks.push(t as unknown as Task)
  }
  const active = tasks.filter(t => t.status === 'running' || t.status === 'starting')
  if (active.length > 1 || (q.activeId !== null && (active.length !== 1 || active[0]?.id !== q.activeId))
    || (q.activeId === null && active.length !== 0)) return undefined
  return { version: VERSION, queue: { enabled: q.enabled, activeId: q.activeId, tasks, error: q.error } }
}
export function add(q: QueueState, input: Pick<Task, 'title' | 'workspaceId' | 'prompt' | 'goalMode'>, id: string, now = Date.now()): QueueState {
  if (!input.workspaceId || !input.title.trim() || !input.prompt.trim() || q.tasks.some(t => t.id === id)) throw Error('工作区、标题和内容不能为空，且任务 ID 必须唯一')
  return { ...q, tasks: [...q.tasks, { ...input, title: input.title.trim(), prompt: input.prompt.trim(), status: 'pending', id, createdAt: now, updatedAt: now }] }
}
export function edit(q: QueueState, id: string, input: Pick<Task, 'title'|'workspaceId'|'prompt'|'goalMode'>, now = Date.now()): QueueState {
  if (!input.workspaceId || !input.title.trim() || !input.prompt.trim()) throw Error('工作区、标题和内容不能为空')
  return { ...q, tasks: q.tasks.map(t => {
    if (t.id !== id) return t
    if (t.status !== 'pending') throw Error('仅待执行任务可以编辑；其他状态请先确认执行结果')
    return { ...t, ...input, title: input.title.trim(), prompt: input.prompt.trim(), updatedAt: now }
  }) }
}
export function remove(q: QueueState, id: string): QueueState {
  if (q.activeId === id) throw Error('运行中的任务不可删除')
  return { ...q, tasks: q.tasks.filter(t => t.id !== id) }
}
export function move(q: QueueState, id: string, offset: -1 | 1): QueueState {
  const tasks = [...q.tasks], i = tasks.findIndex(t => t.id === id)
  if (i < 0 || tasks[i]?.status !== 'pending') return q
  let j = i + offset
  while (j >= 0 && j < tasks.length && tasks[j]?.status !== 'pending') j += offset
  if (j < 0 || j >= tasks.length) return q
  ;[tasks[i], tasks[j]] = [tasks[j]!, tasks[i]!]
  return { ...q, tasks }
}
export function next(q: QueueState): Task | undefined {
  return !q.enabled || q.activeId !== null ? undefined : q.tasks.find(t => t.status === 'pending')
}
export function claim(q: QueueState, id: string, now = Date.now()): QueueState {
  if (next(q)?.id !== id) throw Error('不是队首待执行任务或队列已被占用')
  return { ...q, activeId: id, tasks: q.tasks.map(t => t.id === id ? { ...t, status: 'starting', updatedAt: now } : t) }
}
export function updateActive(q: QueueState, id: string, patch: Partial<Task>, now = Date.now()): QueueState {
  if (q.activeId !== id) throw Error('当前任务执行权已经失效')
  const forbidden = ['id','workspaceId','title','prompt','goalMode','createdAt']
  if (forbidden.some(k => Object.prototype.hasOwnProperty.call(patch, k))) throw Error('不允许修改执行中的任务身份')
  const { status, ...rest } = patch
  const terminal = status === 'completed' || status === 'blocked' || status === 'failed' || status === 'interrupted'
  if (status !== undefined && !['running','completed','blocked','failed','interrupted'].includes(status)) throw Error('非法运行状态')
  return { ...q, activeId: terminal ? null : id, enabled: (status === 'blocked'||status === 'failed'||status === 'interrupted') ? false : q.enabled,
    error: (status === 'blocked'||status === 'failed'||status === 'interrupted') ? (patch.detail || status) : q.error,
    tasks: q.tasks.map(t => t.id === id ? { ...t, ...rest, ...(status === undefined ? {} : { status }), updatedAt: now } : t) }
}
export function recover(q: QueueState, reason = '桌面应用已重新启动，旧执行状态未确认，请人工检查对应 Session'): QueueState {
  if (!q.activeId) return q
  return { ...q, enabled: false, activeId: null, error: reason, tasks: q.tasks.map(t => t.id === q.activeId ? { ...t, status: 'interrupted', detail: reason, updatedAt: Date.now() } : t) }
}
export function retry(q: QueueState, id: string): QueueState {
  if (q.activeId === id) throw Error('不能重排正在执行的任务')
  return { ...q, tasks: q.tasks.map(t => t.id === id && ['failed','blocked','interrupted'].includes(t.status)
    ? { ...t, status: 'pending', sessionId: undefined, goalId: undefined, seenRunning: false, detail: '重试将创建新 Session；请确认旧会话未继续运行', updatedAt: Date.now() } : t) }
}
