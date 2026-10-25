// Regression for the real-machine defect (2026-10-25): clicking the sidebar button never
// opened the board. The shell.overlay slot crashed with React #310 "Rendered more hooks
// than during the previous render" — five panel useState hooks sat below QueueBoard's
// `!open` / not-ready early returns, so the first open (25 hooks -> 30 hooks) threw in the
// real Host and SlotErrorBoundary replaced the whole slot with an error marker.
// The suite had no React mount before this: source-scan tests never rendered the
// open=false -> open=true transition, so 140 green tests missed it. These tests mount the
// built bundles end-to-end (real Cordis Context, real renderer bundle, real slot registry,
// jsdom DOM) and click the button.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { DEFAULT_SETTINGS } from '../src/queue.ts'
import { TEST_CATALOG, TEST_MODEL } from './model-fixture.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const require_ = createRequire(path.join(ROOT, 'noop.js'))

function readyResponse() {
  return { ok: true, value: { namespaces: [{ ns: 'goal-queue', revision: 1, value: DEFAULT_SETTINGS }] } }
}

// Mirrors the Host boot path: window.__ModuleLoader__ registry, renderer bundle + our
// built client.js evaluated as classic scripts, real services provided through Cordis.
async function mount(describe: () => Promise<unknown>) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' })
  const { window } = dom
  const globals = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'getComputedStyle'] as const
  const savedGlobals = new Map<string, PropertyDescriptor | undefined>()
  for (const key of globals) {
    savedGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value: key === 'window' ? window : (window as never as Record<string, unknown>)[key], configurable: true, writable: true })
  }
  const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })

  const registry = new Map<string, (require: (id: string) => unknown) => unknown>()
  window.__ModuleLoader__ = {
    load: (m: { id: string; factory: (require: (id: string) => unknown) => unknown }) => { registry.set(m.id, m.factory) },
    require: (id: string) => {
      const factory = registry.get(id)
      if (!factory) throw new Error('module not registered: ' + id)
      return factory((window.__ModuleLoader__ as { require: (id: string) => unknown }).require)
    },
  }
  const cordis = await import(pathToFileURL(path.join(ROOT, 'node_modules/@deepseek-ai/cordis/lib/index.js')).href)
  const uiSlots = await import(pathToFileURL(path.join(ROOT, 'node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js')).href)
  const clientStore = await import(pathToFileURL(path.join(ROOT, 'node_modules/@deepseek-ai/dsh-client-store/lib/index.js')).href)
  registry.set('@deepseek-ai/cordis', () => cordis)
  registry.set('@deepseek-ai/dsh-client-ui-slots', () => uiSlots)
  registry.set('@deepseek-ai/dsh-client-store', () => clientStore)
  registry.set('react', () => require_('react'))
  registry.set('react-dom', () => require_('react-dom'))
  registry.set('react-dom/client', () => require_('react-dom/client'))
  registry.set('react/jsx-runtime', () => require_('react/jsx-runtime'))

  const remote = {
    $on: () => () => {},
    settings: {
      describe: () => describe(),
      mutate: async (req?: { value?: unknown }) => ({ ok: true, value: { value: req?.value ?? DEFAULT_SETTINGS, revision: 2 } }),
    },
    session: {
      list: async () => ({ ok: true, value: { items: [] } }),
      modelCatalog: async () => ({ ok: true, value: TEST_CATALOG }),
      selectModel: async () => ({ ok: true, value: { selected: TEST_MODEL } }),
    },
    commands: { execute: async () => ({ ok: true, value: {} }) },
  }
  const makeStore = (snapshot: unknown) => ({
    getSnapshot: () => snapshot,
    subscribe: (fn: () => void) => { fn(); return () => {} },
  })
  const workspaces = { list: makeStore({ items: [{ workspaceId: 'ws', title: 'ws', path: '/tmp/ws', sessionIds: [] }] }) }
  const sessions = { list: makeStore({ ids: [], byId: new Map() }) }
  // The plugin's connected() reads connection.generation; the renderer reads the store itself.
  const connection = Object.assign(makeStore({ status: 'connected' }), { generation: makeStore(0) })

  // SlotErrorBoundary logs "slot entry crashed" through console.error; capture it.
  const errors: string[] = []
  const savedConsoleError = console.error
  console.error = (...args: unknown[]) => { errors.push(args.map(a => (a instanceof Error && a.stack) || String(a)).join(' | ')); savedConsoleError(...args) }

  window.eval(readFileSync(path.join(ROOT, 'node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js'), 'utf8'))
  window.eval(readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8'))

  const ctx = new cordis.Context()
  ctx.provide('remote', remote)
  ctx.provide('remote.settings', remote.settings)
  ctx.provide('remote.session', remote.session)
  ctx.provide('remote.commands', remote.commands)
  ctx.provide('workspaces', workspaces)
  ctx.provide('sessions', sessions)
  ctx.provide('connection', connection)
  ctx.provide('uiWorkspace', {})

  const rendererMod = (window.__ModuleLoader__ as { require: (id: string) => { apply: (c: unknown) => void } }).require('@deepseek-ai/dsh-client-ui-renderer')
  rendererMod.apply(ctx)
  const slots = ctx.get('slots') as {
    installScope: (name: string, adapter: unknown) => void
    register: (spec: unknown, component: unknown) => void
    renderSlot: (name: string, props: unknown) => unknown
  }
  if (!slots) throw new Error('slots service not installed')
  // The Host installs a session scope adapter before plugins render (renderer hostFace.scope).
  slots.installScope('session', { current: makeStore({ key: undefined, props: {}, hooks: {}, keyedHooks: {} }) })

  const ourMod = (window.__ModuleLoader__ as { require: (id: string) => { apply: (c: unknown) => void } }).require('dsh-goal-queue')
  ourMod.apply(ctx)

  const React = require_('react')
  const { flushSync } = require_('react-dom')
  const { createRoot } = require_('react-dom/client')
  const e = React.createElement
  const RootComponent = ({ renderSlot }: { renderSlot: (name: string) => unknown }) =>
    e('div', { id: 'host' },
      e('div', { id: 'sidebar-footer' }, renderSlot('sidebar.footer.action')),
      e('div', { id: 'overlay-layer' }, renderSlot('shell.overlay')))
  slots.register({
    name: 'root',
    children: {
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  }, RootComponent)

  const container = window.document.createElement('div')
  window.document.body.appendChild(container)
  const root = createRoot(container)
  flushSync(() => { root.render(slots.renderSlot('root', {})) })

  return {
    document: window.document,
    errors,
    // React flushes click-driven updates on the scheduler queue, not synchronously;
    // fixed sleeps went flaky under load, so every post-click assertion polls instead.
    async waitFor(condition: () => boolean, timeoutMs = 3000): Promise<boolean> {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (condition()) return true
        await new Promise<void>(resolve => setTimeout(resolve, 10))
      }
      return condition()
    },
    dispose() {
      root.unmount()
      console.error = savedConsoleError
      for (const [key, descriptor] of savedGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete (globalThis as Record<string, unknown>)[key]
      }
      if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator)
      window.close()
    },
  }
}

function findButton(document: Document, pattern: RegExp) {
  return [...document.querySelectorAll('button')].find(b => pattern.test(b.textContent || ''))
}

const boardText = (document: Document) => document.querySelector('.gq-root')?.textContent ?? ''

test('first click opens the board: no hook-order crash in the shell.overlay slot', async () => {
  const h = await mount(async () => readyResponse())
  try {
    const button = findButton(h.document, /^任务队列/)
    assert.ok(button, 'sidebar button must render')
    assert.ok(!h.document.querySelector('.gq-root'), 'board is closed before the click')
    button!.click()
    assert.ok(await h.waitFor(() => Boolean(h.document.querySelector('.gq-root'))),
      'first click must open the board (React #310 regression)')
    assert.match(boardText(h.document), /队列为空/)
    assert.equal(h.document.querySelectorAll('[data-slot-error]').length, 0, 'no slot may crash')
    assert.deepEqual(h.errors.filter(x => x.includes('slot entry crashed')), [])
    // open -> close -> open: hook count must stay identical across every transition.
    const close = findButton(h.document, /^关闭$/)
    assert.ok(close, 'board must offer a close button')
    close!.click()
    assert.ok(await h.waitFor(() => !h.document.querySelector('.gq-root')), 'close must unmount the board')
    button!.click()
    assert.ok(await h.waitFor(() => Boolean(h.document.querySelector('.gq-root'))),
      'reopen must work after a shorter render')
    assert.equal(h.document.querySelectorAll('[data-slot-error]').length, 0, 'no slot may crash on reopen')
    assert.deepEqual(h.errors.filter(x => x.includes('slot entry crashed')), [])
  } finally { h.dispose() }
})

test('board survives loading -> ready while open: the second transition that used to crash', async () => {
  let releaseDescribe!: (value: unknown) => void
  const pending = new Promise<unknown>(resolve => { releaseDescribe = resolve })
  let describeCalls = 0
  const h = await mount(async () => { describeCalls += 1; return describeCalls === 1 ? pending : readyResponse() })
  try {
    const button = findButton(h.document, /^任务队列/)
    assert.ok(button, 'sidebar button must render while settings load')
    assert.match(button!.textContent!, /\(加载中\)/)
    button!.click()
    assert.ok(await h.waitFor(() => Boolean(h.document.querySelector('.gq-root'))),
      'click while loading must open the loading board')
    assert.match(boardText(h.document), /正在读取 Host 任务队列配置/)
    releaseDescribe(readyResponse())
    assert.ok(await h.waitFor(() => /队列为空/.test(boardText(h.document))),
      'the settings snapshot landing must not crash the open board')
    assert.equal(h.document.querySelectorAll('[data-slot-error]').length, 0, 'no slot may crash')
    assert.deepEqual(h.errors.filter(x => x.includes('slot entry crashed')), [])
  } finally { h.dispose() }
})

test('error -> ready via retry with the panel toggling: hooks stay consistent across every branch', async () => {
  let describeCalls = 0
  const h = await mount(async () => {
    describeCalls += 1
    return describeCalls === 1
      ? { ok: false, error: { message: 'Host 暂时不可用' } }
      : readyResponse()
  })
  try {
    const button = findButton(h.document, /^任务队列/)
    assert.ok(button, 'sidebar button must render over an error snapshot')
    assert.ok(await h.waitFor(() => /\(配置错误\)/.test(button!.textContent || '')),
      'the button must report the error snapshot once describe rejects')
    button!.click()
    assert.ok(await h.waitFor(() => Boolean(h.document.querySelector('.gq-root'))),
      'click over an error snapshot must open the error board')
    assert.match(boardText(h.document), /队列配置读取或保存失败/)
    // Toggle closed and open again across the error branch, then recover to ready.
    findButton(h.document, /^关闭$/)!.click()
    assert.ok(await h.waitFor(() => !h.document.querySelector('.gq-root')), 'close must unmount the error board')
    button!.click()
    assert.ok(await h.waitFor(() => /队列配置读取或保存失败/.test(boardText(h.document))),
      'reopen over the error branch must show the error board again')
    const retry = findButton(h.document, /^重试读取配置$/)
    assert.ok(retry, 'the error board must offer a retry')
    retry!.click()
    assert.ok(await h.waitFor(() => /队列为空/.test(boardText(h.document))),
      'a successful retry must keep the open board mounted')
    assert.equal(h.document.querySelectorAll('[data-slot-error]').length, 0, 'no slot may crash')
    assert.deepEqual(h.errors.filter(x => x.includes('slot entry crashed')), [])
  } finally { h.dispose() }
})
