import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Coordinator } from '../src/client/coordinator.ts'
import { add, EMPTY_QUEUE, type QueueSettings, type QueueState } from '../src/queue.ts'

const settle = async () => { for (let i = 0; i < 16; i++) await new Promise(resolve => setTimeout(resolve, 0)) }
const input = (name: string) => ({ title: name, workspaceId: 'ws', prompt: `Implement ${name}`, goalMode: true })
class SettingsDouble {
  value: QueueSettings
  status: 'ready' | 'loading' | 'error' = 'ready'
  error = ''
  writes: QueueState[] = []
  failAt = 0
  failForeverAfter = 0
  commitBeforeFailure = false
  attempts = 0
  listeners = new Set<() => void>()
  constructor(queue: QueueState) { this.value = { version: 1, queue } }
  getSnapshot() { return { status: this.status, value: this.status === 'ready' ? this.value : undefined, error: this.error } }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  async set(_field: string, queue: QueueState) {
    if (this.status !== 'ready') throw Error('Host settings not ready')
    this.attempts++
    const fail = this.attempts === this.failAt || (this.failForeverAfter > 0 && this.attempts >= this.failForeverAfter)
    if (!fail || this.commitBeforeFailure) {
      this.value = { version: 1, queue }; this.writes.push(queue); this.notify()
    }
    if (fail) throw Error('simulated Host write result unknown')
  }
  notify() { for (const callback of this.listeners) callback() }
  failClosed(reason: string) { this.status = 'error'; this.error = reason; this.notify() }
}
function fixture(settings: SettingsDouble, options: { failCreate?: boolean; failSubmit?: boolean } = {}) {
  let creates = 0
  let submits = 0
  const sessions = {
    async create() { creates++; if (options.failCreate) throw Error('session creation failed'); return `s-${creates}` },
    retain(id: string) { const face = {
      getSnapshot: () => ({ running: false, awaitingFirstTurn: false, lastAgentError: null }),
      subscribe: () => () => {},
      projections: { faceOf: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) },
      command: async () => { submits++; if (options.failSubmit) throw Error('unknown remote admission'); return { ok: true, value: { matched: true } } },
      prompt: async () => { submits++; if (options.failSubmit) throw Error('unknown remote admission'); return { ok: true, value: { accepted: true } } },
    }; return { binding: { session: face }, ready: Promise.resolve({ session: face }), release() {} } },
  }
  const ws = { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws' }] }) } }
  let connected = true
  const coordinator = new Coordinator(sessions as never, ws as never, settings as never, () => connected)
  return { coordinator, creates: () => creates, submits: () => submits, disconnect: () => { connected = false }, reconnect: () => { connected = true } }
}

test('T01 boot with enabled pending queue and no activeId must NOT dispatch', async () => {
  const q = { ...add(EMPTY_QUEUE, input('A'), 'a'), enabled: true }
  const settings = new SettingsDouble(q), x = fixture(settings)
  x.coordinator.start(); await settle()
  assert.equal(x.creates(), 0)
  assert.equal(settings.value.queue.enabled, false)
  assert.equal(settings.value.queue.tasks[0]?.status, 'pending')
  x.coordinator.dispose()
})

test('T01 after connection reset, saved enabled pending queue must NOT dispatch', async () => {
  const q = { ...add(EMPTY_QUEUE, input('A'), 'a'), enabled: true }
  const settings = new SettingsDouble(q), x = fixture(settings)
  x.coordinator.start(); await settle(); assert.equal(x.creates(), 0)
  settings.value = { version: 1, queue: q }; settings.notify()
  await x.coordinator.connectionReset(); await settle()
  assert.equal(x.creates(), 0)
  assert.equal(settings.value.queue.enabled, false)
  x.coordinator.dispose()
})

test('T02 unresolved interrupted task must block a later pending task', async () => {
  let q = add(add(EMPTY_QUEUE, input('A'), 'a'), input('B'), 'b')
  q = { ...q, tasks: q.tasks.map(t => t.id === 'a' ? { ...t, status: 'interrupted' as const, sessionId: 'old' } : t) }
  const settings = new SettingsDouble(q), x = fixture(settings)
  x.coordinator.start(); await settle()
  await assert.rejects(x.coordinator.enable(true), /中断|异常|处置|待处理/)
  assert.equal(x.creates(), 0)
  x.coordinator.dispose()
})

test('T04 creation failure does not dispatch the second task', async () => {
  const settings = new SettingsDouble(add(add(EMPTY_QUEUE, input('A'), 'a'), input('B'), 'b'))
  const x = fixture(settings, { failCreate: true })
  x.coordinator.start(); await settle(); await x.coordinator.enable(true); await settle()
  assert.equal(x.creates(), 1)
  assert.equal(settings.value.queue.enabled, false)
  assert.equal(settings.value.queue.tasks[0]?.status, 'failed')
  assert.equal(settings.value.queue.tasks[1]?.status, 'pending')
  x.coordinator.dispose()
})

test('T01 manual enable works only after boot reconciliation', async () => {
  const settings = new SettingsDouble(add(EMPTY_QUEUE, input('A'), 'a')), x = fixture(settings)
  x.coordinator.start(); await settle()
  assert.equal(x.creates(), 0)
  await x.coordinator.enable(true); await settle()
  assert.equal(x.creates(), 1)
  assert.equal(x.submits(), 1)
  x.coordinator.dispose()
})

test('T01 pausing live queue never starts second task', async () => {
  const settings = new SettingsDouble(add(add(EMPTY_QUEUE, input('A'), 'a'), input('B'), 'b'))
  const x = fixture(settings)
  x.coordinator.start(); await settle(); await x.coordinator.enable(true); await settle()
  assert.equal(x.creates(), 1)
  await x.coordinator.enable(false); await settle()
  assert.equal(settings.value.queue.enabled, false)
  assert.equal(x.creates(), 1)
  x.coordinator.dispose()
})

test('T04 a Session was created but recording sessionId fails: subsequent task is blocked', async () => {
  const settings = new SettingsDouble(add(add(EMPTY_QUEUE, input('A'), 'a'), input('B'), 'b'))
  settings.failAt = 3 // enable, claim, sessionId write
  const x = fixture(settings)
  x.coordinator.start(); await settle(); await x.coordinator.enable(true); await settle()
  assert.equal(x.creates(), 1)
  assert.equal(x.submits(), 0)
  assert.equal(settings.value.queue.tasks[0]?.status, 'interrupted')
  assert.equal(settings.value.queue.tasks[1]?.status, 'pending')
  assert.equal(settings.value.queue.enabled, false)
  x.coordinator.dispose()
})

test('T04 ambiguous command admission must halt with interrupted task', async () => {
  const settings = new SettingsDouble(add(add(EMPTY_QUEUE, input('A'), 'a'), input('B'), 'b'))
  const x = fixture(settings, { failSubmit: true })
  x.coordinator.start(); await settle(); await x.coordinator.enable(true); await settle()
  assert.equal(x.creates(), 1)
  assert.equal(x.submits(), 1)
  assert.equal(settings.value.queue.tasks[0]?.status, 'interrupted')
  assert.equal(settings.value.queue.enabled, false)
  x.coordinator.dispose()
})

test('T04 Host committed a write but response was lost: never double execute', async () => {
  const settings = new SettingsDouble(add(add(EMPTY_QUEUE, input('A'), 'a'), input('B'), 'b'))
  settings.failAt = 3
  settings.commitBeforeFailure = true
  const x = fixture(settings)
  x.coordinator.start(); await settle(); await x.coordinator.enable(true); await settle()
  assert.equal(x.creates(), 1)
  assert.equal(settings.value.queue.tasks[0]?.status, 'interrupted')
  assert.equal(settings.value.queue.enabled, false)
  x.coordinator.dispose()
})

test('T04 persistent failure to save a failure quarantines the queue', async () => {
  const settings = new SettingsDouble(add(add(EMPTY_QUEUE, input('A'), 'a'), input('B'), 'b'))
  settings.failForeverAfter = 3
  const x = fixture(settings)
  x.coordinator.start(); await settle(); await x.coordinator.enable(true); await settle()
  assert.equal(x.creates(), 1)
  assert.equal(x.submits(), 0)
  assert.equal(settings.getSnapshot().status, 'error')
  assert.equal(x.creates(), 1)
  x.coordinator.dispose()
})
