/** U13 serial dispatch: maxConcurrent ≡ 1 — one execution slot, never two concurrent claims. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Coordinator } from '../src/client/coordinator.ts'
import { TEST_MODEL, testModels } from './model-fixture.ts'
import {
  EMPTY_QUEUE,add,claim,claimGoalResume,decode,next,trackSessionActivity,
  type QueueSettings,type QueueState
} from '../src/queue.ts'
import { QueueError } from '../src/errors.ts'

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
  goal:{goal:{id:string;objective:string;phase:string}}|null=null
  watchers=new Set<()=>void>()
  getSnapshot=()=>this.state
  subscribe=(fn:()=>void)=>{this.watchers.add(fn);return()=>{this.watchers.delete(fn)}}
  projections={faceOf:(key:string)=>({
    getSnapshot:()=>key==='modelSelection'?{next:TEST_MODEL}:this.goal,
    subscribe:(fn:()=>void)=>{this.watchers.add(fn);return()=>{this.watchers.delete(fn)}}
  })}
  async prompt(){this.state.running=true;this.emit();return {ok:true,value:{accepted:true}}}
  emit(){for(const fn of this.watchers)fn()}
}
function setup(q:QueueState){
  const host=new Host(q)
  const faces=new Map<string,Face>()
  let created=0,holds=0,maxHolds=0
  const sessions={
    list:{getSnapshot:()=>({ids:[],byId:{},phase:'ready'}),subscribe:()=>()=>{}},
    async refresh(){},
    async create(){created++;const id='created-'+created;faces.set(id,new Face());return id},
    retain(id:string){
      const face=faces.get(id)
      if(!face)throw Error('missing session')
      holds++;maxHolds=Math.max(maxHolds,holds)
      return {binding:{session:face},ready:Promise.resolve({session:face}),release(){holds--}}
    }
  }
  const workspaces={list:{getSnapshot:()=>({items:[{workspaceId:'ws',sessionIds:[],path:'/ws',title:'测试'}]})}}
  const directory={async list(){return {rows:[],syncedAt:Date.now()}}}
  const coordinator=new Coordinator(sessions as never,workspaces as never,host as never,()=>true,undefined,testModels,directory as never)
  return {host,coordinator,faces,created:()=>created,maxHolds:()=>maxHolds}
}

test('legacy maxConcurrent=3 normalizes to 1 on decode without losing tasks',()=>{
  let q=add(add(EMPTY_QUEUE,input('A'),'a'),input('B'),'b')
  q={...q,enabled:true,maxConcurrent:3}
  const value=decode({version:1,queue:q})
  assert.ok(value)
  assert.equal(value.queue.maxConcurrent,1)
  assert.equal(value.queue.enabled,true)
  assert.deepEqual(value.queue.tasks.map(t=>t.id),['a','b'])
})
test('no concurrency configuration entry: setConcurrency removed from Coordinator',()=>{
  assert.equal('setConcurrency' in Coordinator.prototype,false)
})
test('the single slot: an active claim or an observed external Session both block next()',()=>{
  let q=add(add(EMPTY_QUEUE,input('A'),'a'),input('B'),'b')
  q=claim({...q,enabled:true},'a')
  assert.equal(next(q),undefined)
  const ext=trackSessionActivity({...add(EMPTY_QUEUE,input('A'),'a'),enabled:true},'ext-1')
  assert.equal(next(ext),undefined)
})
test('claimGoalResume on the occupied sole slot throws CAPACITY_FULL',()=>{
  let q=add(EMPTY_QUEUE,{workspaceId:'ws',prompt:'Goal work',title:'',goalMode:true},'old')
  q={...q,tasks:[{...q.tasks[0]!,sessionId:'old-sess',goalId:'goal-old',status:'interrupted' as const}]}
  const free=claimGoalResume(q,'old','goal-old')
  assert.deepEqual(free.activeIds,['old'])
  let q2=add(free,{workspaceId:'ws',prompt:'Other goal',title:'',goalMode:true},'old2')
  q2={...q2,tasks:q2.tasks.map(t=>t.id==='old2'
    ?{...t,sessionId:'old2-sess',goalId:'goal-2',status:'interrupted' as const}:t)}
  assert.throws(()=>claimGoalResume(q2,'old2','goal-2'),
    e=>e instanceof QueueError&&e.code==='CAPACITY_FULL')
  const ext=trackSessionActivity(q,'ext-1')
  assert.throws(()=>claimGoalResume(ext,'old','goal-old'),
    e=>e instanceof QueueError&&e.code==='CAPACITY_FULL')
})

test('queue start with three pending tasks claims only the first; the second waits for release',async()=>{
  let q=add(add(add(EMPTY_QUEUE,input('A'),'a'),input('B'),'b'),input('C'),'c')
  const x=setup(q)
  x.coordinator.start();await tick()
  await x.coordinator.enable(true);await tick()
  assert.equal(x.created(),1)
  assert.deepEqual(x.host.value.queue.activeIds,['a'])
  assert.equal(x.host.value.queue.tasks.find(t=>t.id==='b')?.status,'pending')
  const first=x.faces.get('created-1')
  assert.ok(first)
  first.state.running=false;first.emit();await tick()
  assert.equal(x.host.value.queue.tasks.find(t=>t.id==='a')?.status,'completed')
  assert.equal(x.created(),2)
  assert.deepEqual(x.host.value.queue.activeIds,['b'])
  assert.ok(x.maxHolds()<=1,'at most one Session hold at any time')
  x.coordinator.dispose()
})
test('rapid repeated start clicks never break serial: still one claim, one hold',async()=>{
  let q=add(add(EMPTY_QUEUE,input('A'),'a'),input('B'),'b')
  const x=setup(q)
  x.coordinator.start();await tick()
  await Promise.allSettled([x.coordinator.enable(true),x.coordinator.enable(true),x.coordinator.enable(true)])
  await tick()
  assert.equal(x.created(),1)
  assert.deepEqual(x.host.value.queue.activeIds,['a'])
  assert.ok(x.maxHolds()<=1)
  x.coordinator.dispose()
})
test('connection reset mid-run: recovery pauses the queue and re-enable still claims exactly one',async()=>{
  let q=add(add(EMPTY_QUEUE,input('A'),'a'),input('B'),'b')
  const x=setup(q)
  x.coordinator.start();await tick()
  await x.coordinator.enable(true);await tick()
  assert.equal(x.created(),1)
  await x.coordinator.connectionReset();await tick()
  await x.coordinator.discover();await tick()
  assert.equal(x.host.value.queue.enabled,false)
  assert.equal(x.host.value.queue.tasks.find(t=>t.id==='a')?.status,'interrupted')
  await assert.rejects(x.coordinator.enable(true),/未确认|处置/)
  const first=x.faces.get('created-1')
  assert.ok(first)
  first.state.running=false;first.emit()
  await x.coordinator.retry('a');await tick()
  await x.coordinator.enable(true);await tick()
  assert.equal(x.host.value.queue.activeIds.length,1)
  assert.equal(x.created(),2)
  assert.ok(x.maxHolds()<=1)
  x.coordinator.dispose()
})
