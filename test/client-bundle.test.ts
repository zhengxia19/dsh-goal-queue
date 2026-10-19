import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('built client loads as a DSH classic script and exports its plugin', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let registered: { id: string; factory: (require: (id: string) => unknown) => unknown } | undefined
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(entry: typeof registered) { registered = entry } } },
  })
  assert.equal(registered?.id, 'dsh-goal-queue')
  const plugin = registered!.factory(id => {
    if (id === '@deepseek-ai/dsh-client-store') return { defineStore: () => ({}) }
    if (['react', 'react-dom', 'react/jsx-runtime'].includes(id)) return {}
    throw new Error(`Unexpected runtime import: ${id}`)
  }) as { apply: unknown; inject: unknown }
  assert.equal(typeof plugin.apply, 'function')
  assert.ok(Array.isArray(plugin.inject))
})
