// U02 可信目录基线（design §7.1 R02 链）：假 SessionDirectory ok→fail→ok；
// 失败期间无新派发；恢复读取不恢复 armed；enable 需 directoryFresh；不触碰私有 manager state。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Coordinator } from '../src/client/coordinator.ts'
import { TEST_MODEL, testModels } from './model-fixture.ts'
import { QueueError } from '../src/errors.ts'
import { EMPTY_QUEUE,add,type QueueSettings,type QueueState } from '../src/queue.ts'

const tick=async()=>{for(let i=0;i<16;i++)await new Promise(resolve=>setTimeout(resolve,0))}
const input=(name:string)=>({workspaceId:'ws',prompt:'Implement '+name,title:name,goalMode:false})
class Host {
  value:QueueSettings
  listeners=new Set<()=>void>()
  constructor(q:QueueState){this.value={version:1,queue:q}}
  getSnapshot(){return {status:'ready',value:this.value}}
  subscribe(fn:()=>void){this.listeners.add(fn);return()=>{this.listeners.delete(fn)}}
  failClosed(_reason:string){}
  async set(_key:string,q:QueueState){this.value={version:1,queue:q};for(const fn of this.listeners)fn()}
}
class Face {
  state={running:true,awaitingFirstTurn:false,lastAgentError:null}
  watchers=new Set<()=>void>()
  getSnapshot=()=>this.state
  subscribe=(fn:()=>void)=>{this.watchers.add(fn);return()=>{this.watchers.delete(fn)}}
  projections={faceOf:(key:string)=>({
    getSnapshot:()=>key==='modelSelection'?{next:TEST_MODEL}:undefined,
    subscribe:(fn:()=>void)=>{this.watchers.add(fn);return()=>{this.watchers.delete(fn)}}
  })}
  emit(){for(const fn of this.watchers)fn()}
  async prompt(){this.state.running=true;this.emit();return {ok:true,value:{accepted:true}}}
}
class FakeDirectory {
  mode:'ok'|'fail'='ok'
  rows:{sessionId:string;running:boolean;updatedAt:number}[]=[]
  calls=0
  async list(){
    this.calls++
    if(this.mode==='fail')throw new QueueError('DIRECTORY_READ_FAILED','模拟目录读取失败')
    return {rows:this.rows,syncedAt:Date.now()}
  }
}
function setup(q:QueueState){
  const host=new Host(q)
  const faces=new Map<string,Face>()
  let created=0
  const sessions={
    async refresh(){},
    async create(){created++;const id='s-'+created;const f=new Face();f.state.running=false;faces.set(id,f);return id},
    retain(id:string){
      const face=faces.get(id)
      if(!face)throw Error('missing session')
      return {binding:{session:face},ready:Promise.resolve({session:face}),release(){}}
    }
  }
  const workspaces={list:{getSnapshot:()=>({items:[{workspaceId:'ws',sessionIds:[],path:'/ws',title:'测试'}]})}}
  const directory=new FakeDirectory()
  const coordinator=new Coordinator(sessions as never,workspaces as never,host as never,()=>true,undefined,testModels,directory)
  return {host,coordinator,faces,directory,created:()=>created}
}

test('enable requires a fresh trusted directory read before the first dispatch',async()=>{
  const x=setup(add(add(EMPTY_QUEUE,input('A'),'a'),input('B'),'b'))
  // U03: boot auto-schedules the first scan; fail it so the un-scanned blocked state persists.
  x.directory.mode='fail'
  x.coordinator.start();await tick()
  await assert.rejects(x.coordinator.enable(true),/扫描/)
  assert.equal(x.created(),0)
  x.coordinator.dispose()
})
test('R02 链 ok→fail→ok：失败解除授权，期间与恢复后都不自动重跑，手工再启用才继续',async()=>{
  const x=setup(add(add(EMPTY_QUEUE,input('A'),'a'),input('B'),'b'))
  x.coordinator.start();await tick()
  // ok：可信基线建立后手工启用，A 占用唯一名额。
  await x.coordinator.discover();await tick()
  await x.coordinator.enable(true);await tick()
  assert.equal(x.created(),1)
  const aFace=x.faces.get('s-1')!
  // fail：目录读取失败 → 明确错误码 + 解除授权。
  x.directory.mode='fail'
  await assert.rejects(x.coordinator.discover(),
    (e:unknown)=>e instanceof QueueError&&e.code==='DIRECTORY_READ_FAILED')
  assert.equal(x.coordinator.isAuthorized(),false)
  // 失败期间：A 结束触发 pump，也不得派发 B。
  aFace.state.running=true;aFace.emit()
  await tick()
  aFace.state.running=false;aFace.emit();await tick()
  assert.equal(x.host.value.queue.tasks.find(t=>t.id==='a')?.status,'completed')
  assert.equal(x.created(),1,'失败期间不得出现新派发')
  // ok：恢复读取只刷新基线，armed 保持 false（B1 不自动重跑）。
  x.directory.mode='ok'
  await x.coordinator.discover();await tick()
  assert.ok(x.directory.calls>=3)
  assert.equal(x.coordinator.isAuthorized(),false,'恢复读取不得自动重新授权')
  assert.equal(x.created(),1)
  // 手工再启用后才继续派发 B。
  await x.coordinator.enable(true);await tick()
  assert.equal(x.created(),2)
  x.coordinator.dispose()
})
test('客户端源码不读取 manager 私有 getSnapshot().state',()=>{
  for(const f of ['coordinator.ts','directory.ts','index.ts','QueueBoard.tsx','QueueButton.tsx','store.ts','queue-view.ts','models.ts']){
    const src=readFileSync(new URL('../src/client/'+f,import.meta.url),'utf8')
    assert.ok(!src.includes('getSnapshot().state'),f+' 不得访问 getSnapshot().state')
  }
})
