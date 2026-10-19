import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { Context, Service } from '@deepseek-ai/cordis'
import { HostTaskModels } from '../src/client/models.ts'
import { TEST_CATALOG, TEST_MODEL } from './model-fixture.ts'

function clientPlugin() {
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
  }) as { apply: unknown; inject: string[] }
  return plugin
}

test('built client loads as a DSH classic script and exports its plugin', () => {
  const plugin=clientPlugin()
  assert.equal(typeof plugin.apply, 'function')
  assert.ok(Array.isArray(plugin.inject))
})

// Mirrors the official gateway namespace getters, using real Cordis Service tracing.
class TestRemote extends Service {
  constructor(ctx:Context){super(ctx,'remote')}
  get session(){return (this.ctx as any)['remote.session']}
  get commands(){return (this.ctx as any)['remote.commands']}
}

test('built Client injection permits model catalog, selection and title outcome reads in real Cordis',async()=>{
  const plugin=clientPlugin()
  for(const omitted of [undefined,'remote.session','remote.commands']){
    const root=new Context(),calls:string[]=[]
    new TestRemote(root)
    for(const name of plugin.inject)if(!['remote','remote.session','remote.commands'].includes(name))root.provide(name,{})
    const provider=root.plugin({apply(ctx:Context){ctx.provide('remote.session',{
      modelCatalog:async()=>{calls.push('catalog');return {ok:true,value:TEST_CATALOG}},
      selectModel:async()=>{calls.push('select');return {ok:true,value:{selected:TEST_MODEL}}},
    });ctx.provide('remote.commands',{execute:async()=>{calls.push('title');return {ok:true,value:{commandId:'test-command',result:{kind:'success'}}}}})}})
    await provider.await()
    const fiber=root.plugin({
      inject:plugin.inject.filter(name=>name!==omitted),
      async apply(ctx:Context){
        const models=new HostTaskModels(ctx)
        assert.deepEqual(await models.catalog(),TEST_CATALOG)
        assert.deepEqual(await models.select('test-session' as never,TEST_MODEL),TEST_MODEL)
        assert.deepEqual(await models.title({sessionId:'test-session'} as never,'/goal-queue-title {}'),{matched:true})
      },
    })
    try{
      if(omitted)await assert.rejects(fiber.await(),new RegExp(`cannot get property "${omitted}" without inject`))
      else {await fiber.await();assert.deepEqual(calls,['catalog','select','title'])}
    }finally{await root.fiber.dispose()}
  }
})
