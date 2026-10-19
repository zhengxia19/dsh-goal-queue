import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HostQueueSettings } from '../src/client/settings.ts'
import { EMPTY_QUEUE, type QueueSettings } from '../src/queue.ts'

type Listener = (...args: unknown[]) => void
function harness() {
  let current: QueueSettings = { version: 1, queue: EMPTY_QUEUE }
  let revision = 7
  let failWrites = false
  const listeners = new Map<string, Listener[]>()
  const remote = {
    $on(name: string, callback: Listener) { const list = listeners.get(name) ?? []; list.push(callback); listeners.set(name, list); return () => {} },
    settings: {
      async describe() { return { ok: true, value: { namespaces: [{ ns: 'goal-queue', value: current, revision }] } } },
      async mutate(_ns: string, operations: { value: unknown }[], expected: number) {
        if (failWrites || revision !== expected) return { ok: false, error: { code: 'settings/conflict', message: 'stale revision' } }
        current = { ...current, queue: operations[0]!.value as typeof EMPTY_QUEUE }
        revision++
        return { ok: true, value: { value: current, revision } }
      },
    },
  }
  const ctx = { remote, on(name: string, callback: Listener) { const list = listeners.get(name) ?? []; list.push(callback); listeners.set(name, list); return () => {} } }
  return { ctx, remote, getCurrent: () => current, deny: () => { failWrites = true }, emit(name: string, ...args: unknown[]) { listeners.get(name)?.forEach(fn => fn(...args)) } }
}

test('v0.2.1 Host settings loads and CAS-persists the queue', async () => {
  const host = harness()
  const settings = new HostQueueSettings(host.ctx as never)
  settings.start()
  await settings.refresh()
  assert.equal(settings.getSnapshot().status, 'ready')
  await settings.set('queue', { ...EMPTY_QUEUE, enabled: true })
  assert.equal(host.getCurrent().queue.enabled, true)
  assert.equal(settings.getSnapshot().value?.queue.enabled, true)
  settings.dispose()
})

test('Host CAS rejection fails closed and never reports local success', async () => {
  const host = harness()
  const settings = new HostQueueSettings(host.ctx as never)
  await settings.refresh()
  host.deny()
  await assert.rejects(settings.set('queue', { ...EMPTY_QUEUE, enabled: true }), /stale revision/)
  assert.equal(settings.getSnapshot().status, 'error')
  assert.equal(host.getCurrent().queue.enabled, false)
  settings.dispose()
})

test('reconnect hides old queue until new Host read is confirmed', async () => {
  const host = harness()
  const settings = new HostQueueSettings(host.ctx as never)
  settings.start()
  await settings.refresh()
  host.emit('connection/reset')
  assert.equal(settings.getSnapshot().status, 'loading')
  await settings.refresh()
  assert.equal(settings.getSnapshot().status, 'ready')
  settings.dispose()
})
