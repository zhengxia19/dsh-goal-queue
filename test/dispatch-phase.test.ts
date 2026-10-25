// U07 派发阶段与可证明重排（design §7.7/§8.4）：phase 与业务数据同次 CAS 持久化；
// requeueEdited 仅 phase∈{claimed,precheck} 且无 sessionId；command_submitted 失败不自动重发；
// 旧数据 phase=undefined 不伪造；dispatch 失败三分类按持久阶段证据。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  EMPTY_QUEUE, add, claim, decode, markCommandSubmitted, markModelConfirmed,
  requeueEdited, retry, setSessionId, setTaskModel, updateActive,
  type QueueSettings, type QueueState,
} from '../src/queue.ts'
import { Coordinator } from '../src/client/coordinator.ts'
import { TEST_MODEL, TEST_CATALOG } from './model-fixture.ts'
import type { TaskModels } from '../src/client/models.ts'

const input = { workspaceId: 'ws', prompt: 'work', title: '', goalMode: true }
const edited = { ...input, prompt: 'edited' }

test('claim 记 phase:"claimed"（Attempt 与任务镜像）；旧数据 phase=undefined 不伪造', () => {
  const q = claim({ ...add(EMPTY_QUEUE, input, 'a'), enabled: true }, 'a')
  assert.equal(q.tasks[0]!.phase, 'claimed')
  assert.equal(q.tasks[0]!.attempts!.at(-1)!.phase, 'claimed')
  const legacy = { version: 1, queue: { ...EMPTY_QUEUE, tasks: [{
    id: 'x', workspaceId: 'ws', title: '', prompt: 'p', goalMode: false,
    status: 'failed', sessionId: 's-legacy', createdAt: 1, updatedAt: 1,
  }] } }
  const dq = decode(legacy)!.queue
  assert.equal(dq.tasks[0]!.phase, undefined, '旧任务不伪造 phase')
  assert.equal(dq.tasks[0]!.attempts![0]!.phase, undefined, '旧 Attempt 不伪造 phase')
})

test('phase 与业务数据同次 CAS：setTaskModel/setSessionId/mark* 同一状态拷贝写入且经持久化往返', () => {
  let q = claim({ ...add(EMPTY_QUEUE, input, 'a'), enabled: true }, 'a')
  q = setTaskModel(q, 'a', TEST_MODEL, 'precheck')
  assert.equal(q.tasks[0]!.modelSelection?.model, TEST_MODEL.model)
  assert.equal(q.tasks[0]!.phase, 'precheck')
  assert.equal(q.tasks[0]!.attempts!.at(-1)!.phase, 'precheck')
  q = setSessionId(q, 'a', 'sess-1', 'session_created')
  assert.equal(q.tasks[0]!.sessionId, 'sess-1')
  assert.equal(q.tasks[0]!.attempts!.at(-1)!.sessionId, 'sess-1')
  assert.equal(q.tasks[0]!.attempts!.at(-1)!.phase, 'session_created')
  q = markModelConfirmed(q, 'a')
  assert.equal(q.tasks[0]!.attempts!.at(-1)!.phase, 'model_confirmed')
  q = markCommandSubmitted(q, 'a')
  assert.equal(q.tasks[0]!.attempts!.at(-1)!.phase, 'command_submitted')
  q = markModelConfirmed(q, 'a')
  assert.equal(q.tasks[0]!.attempts!.at(-1)!.phase, 'command_submitted', '同一 Attempt 内 phase 不回退')
  const rt = decode(JSON.parse(JSON.stringify({ version: 1, queue: q })))!.queue
  assert.equal(rt.tasks[0]!.attempts!.at(-1)!.phase, 'command_submitted')
  assert.equal(rt.tasks[0]!.phase, 'command_submitted')
})

test('requeueEdited 仅 phase∈{claimed,precheck} 且无 sessionId；session_created/model_confirmed/command_submitted 均拒绝', () => {
  let q = claim({ ...add(EMPTY_QUEUE, input, 'a'), enabled: true }, 'a')
  q = updateActive(q, 'a', { status: 'failed', detail: 'precheck failed' })
  q = requeueEdited(q, 'a', edited)
  assert.equal(q.tasks[0]!.status, 'pending')
  assert.equal(q.tasks[0]!.prompt, 'edited')
  assert.equal(q.tasks[0]!.attempts!.length, 1, '重排队保留证据')
  q = claim({ ...q, enabled: true }, 'a')
  q = setTaskModel(q, 'a', TEST_MODEL, 'precheck')
  q = updateActive(q, 'a', { status: 'failed' })
  q = requeueEdited(q, 'a', edited)
  assert.equal(q.tasks[0]!.status, 'pending', 'precheck 阶段同样可证明未提交')
  q = claim({ ...q, enabled: true }, 'a')
  q = setTaskModel(q, 'a', TEST_MODEL, 'precheck')
  q = setSessionId(q, 'a', 'sess-2', 'session_created')
  q = updateActive(q, 'a', { status: 'interrupted' })
  assert.throws(() => requeueEdited(q, 'a', edited), /无法证明命令未提交/)
  q = retry(q, 'a')
  q = claim({ ...q, enabled: true }, 'a')
  q = markCommandSubmitted(q, 'a')
  q = updateActive(q, 'a', { status: 'failed' })
  assert.throws(() => requeueEdited(q, 'a', edited), /无法证明命令未提交/, 'command_submitted 不可走简化路径')
  // legacy：无 phase 证据一律保守拒绝
  const legacy = decode({ version: 1, queue: { ...EMPTY_QUEUE, tasks: [{
    id: 'x', workspaceId: 'ws', title: '', prompt: 'p', goalMode: false,
    status: 'failed', createdAt: 1, updatedAt: 1,
  }] } })!.queue
  assert.throws(() => requeueEdited(legacy, 'x', edited), /无法证明命令未提交/)
})

test('command_submitted 失败不自动重发：无简化重排，仅用户 retry 开新 Attempt 并归档旧阶段证据', () => {
  let q = claim({ ...add(EMPTY_QUEUE, input, 'a'), enabled: true }, 'a')
  q = setTaskModel(q, 'a', TEST_MODEL, 'precheck')
  q = setSessionId(q, 'a', 'sess-3', 'session_created')
  q = markModelConfirmed(q, 'a')
  q = markCommandSubmitted(q, 'a')
  q = updateActive(q, 'a', { status: 'interrupted', detail: '回包丢失；命令提交状态未知，保守处理，不会自动重发' })
  assert.throws(() => requeueEdited(q, 'a', input), /无法证明命令未提交/)
  q = retry(q, 'a')
  assert.equal(q.tasks[0]!.status, 'pending')
  assert.equal(q.tasks[0]!.sessionId, undefined)
  assert.equal(q.tasks[0]!.attempts!.length, 1, '旧 Attempt 证据保留')
  q = claim({ ...q, enabled: true }, 'a')
  assert.equal(q.tasks[0]!.attempts!.length, 2)
  assert.equal(q.tasks[0]!.attempts!.at(-1)!.phase, 'claimed')
  assert.equal(q.tasks[0]!.attempts![0]!.phase, 'command_submitted', '旧 Attempt 阶段证据归档不动')
})

// —— coordinator 级：dispatch 失败三分类（design §8.4）——
const settle = async () => { for (let i = 0; i < 18; i++) await new Promise(r => setTimeout(r, 0)) }
function fixture(options: { invalidModel?: boolean; failSelect?: boolean; failGoal?: boolean } = {}) {
  const listeners = new Set<() => void>()
  let value: QueueSettings = { version: 1, queue: add(EMPTY_QUEUE,
    { ...input, ...(options.invalidModel ? { modelSelection: { ...TEST_MODEL, model: 'missing' } } : {}) }, 'a') }
  let next = TEST_MODEL
  const settings = {
    getSnapshot: () => ({ status: 'ready', value }),
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    failClosed: () => {},
    set: async (_key: string, q: QueueState) => { value = { version: 1, queue: q }; for (const fn of listeners) fn() },
  }
  const face = {
    getSnapshot: () => ({ running: false, awaitingFirstTurn: false, lastAgentError: null }),
    subscribe: () => () => {},
    projections: { faceOf: (key: string) => ({ getSnapshot: () => key === 'modelSelection' ? { next } : null, subscribe: () => () => {} }) },
    command: async (line: string) => line.startsWith('/goal ') && options.failGoal
      ? { ok: false, error: { message: 'transport lost' } }
      : { ok: true, value: { matched: true } },
  }
  const sessions = { create: async () => 'new-session', retain: () => ({ ready: Promise.resolve(), binding: { session: face }, release() {} }) }
  const models: TaskModels = {
    catalog: async () => TEST_CATALOG,
    select: async (_id, selection) => { if (options.failSelect) throw Error('selection result unknown'); next = selection as typeof TEST_MODEL; return selection },
    title: async () => ({ matched: true }),
  }
  const coordinator = new Coordinator(sessions as never, { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws' }] }) } } as never, settings as never, () => true, undefined, models)
  return { coordinator, value: () => value }
}

test('分类一：创建前失败=已确认未提交 → failed，可走「修改后重新排队」', async () => {
  const x = fixture({ invalidModel: true })
  try {
    x.coordinator.start(); await settle(); await x.coordinator.enable(true); await settle()
    const t = x.value().queue.tasks[0]!
    assert.equal(t.status, 'failed')
    assert.match(t.detail ?? '', /已确认未提交，可修改后重新排队/)
    assert.equal(t.attempts!.at(-1)!.phase, 'claimed')
    const q = requeueEdited(x.value().queue, 'a', edited)
    assert.equal(q.tasks[0]!.status, 'pending')
  } finally { x.coordinator.dispose() }
})

test('分类二：会话已创建、命令未提交 → interrupted，需处置原会话，拒绝简化重排', async () => {
  const x = fixture({ failSelect: true })
  try {
    x.coordinator.start(); await settle(); await x.coordinator.enable(true); await settle()
    const t = x.value().queue.tasks[0]!
    assert.equal(t.status, 'interrupted')
    assert.match(t.detail ?? '', /会话已创建、命令未提交，需处置原会话/)
    assert.equal(t.attempts!.at(-1)!.phase, 'session_created')
    assert.throws(() => requeueEdited(x.value().queue, 'a', edited), /无法证明命令未提交/)
  } finally { x.coordinator.dispose() }
})

test('分类三：命令提交状态未知 → interrupted，不会自动重发（命令仅一次），拒绝简化重排', async () => {
  const x = fixture({ failGoal: true })
  try {
    x.coordinator.start(); await settle(); await x.coordinator.enable(true); await settle()
    const t = x.value().queue.tasks[0]!
    assert.equal(t.status, 'interrupted')
    assert.match(t.detail ?? '', /命令提交状态未知，保守处理，不会自动重发/)
    assert.equal(t.attempts!.at(-1)!.phase, 'command_submitted')
    assert.throws(() => requeueEdited(x.value().queue, 'a', edited), /无法证明命令未提交/)
    assert.equal(x.value().queue.enabled, false, '未知失败后队列保持暂停，不自动重发')
  } finally { x.coordinator.dispose() }
})

test('markCommandSubmitted 在提交任务命令之前持久化（静态断言）', () => {
  const src = readFileSync(new URL('../src/client/coordinator.ts', import.meta.url), 'utf8')
  const mark = src.indexOf("markCommandSubmitted(q,task.id)")
  assert.ok(mark > 0, 'dispatch 必须调用 markCommandSubmitted')
  assert.ok(mark < src.indexOf("held.session.command('/goal"), 'phase 写入先于 /goal 提交')
  assert.ok(mark < src.indexOf('held.session.prompt('), 'phase 写入先于普通 prompt 提交')
  assert.ok(src.includes("new QueueError('SUBMISSION_UNKNOWN'"), '提交未知分类挂 SUBMISSION_UNKNOWN 码')
})
