// U04 外部活动与占用（design §7.5 R06 链）：旧任务删除后外部活动仍可 openSessionById；仅权威 stop 释放；去重/超限/下限不变。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Coordinator } from '../src/client/coordinator.ts'
import { testModels } from './model-fixture.ts'
import { QueueError } from '../src/errors.ts'
import { EMPTY_QUEUE,add,next,releaseSessionActivity,summarizeQueue,trackSessionActivity,type QueueSettings,type QueueState } from '../src/queue.ts'

const tick=async()=>{for(let i=0;i<16;i++)await new Promise(resolve=>setTimeout(resolve,0))}
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
    getSnapshot:()=>key==='modelSelection'?{next:{provider:'p',model:'m'}}:this.goal,
    subscribe:(fn:()=>void)=>{this.watchers.add(fn);return()=>{this.watchers.delete(fn)}}
  })}
  emit(){for(const fn of this.watchers)fn()}
}
function setup(q:QueueState){
  const host=new Host(q)
  const faces=new Map<string,Face>()
  const opened:string[]=[]
  const ordinary=new Face();ordinary.state.running=true
  faces.set('existing',ordinary)
  const summaries={
    ids:['existing'],
    byId:{existing:{id:'existing',title:'外部会话',displayTitle:'外部会话',
      running:true,updatedAt:1,origin:undefined}},
    phase:'ready'
  }
  const sessions={
    list:{getSnapshot:()=>summaries,subscribe:(_fn:()=>void)=>()=>{}},
    async refresh(){},
    async create(){const id='created-1';faces.set(id,new Face());return id},
    retain(id:string){
      const face=faces.get(id)
      if(!face)throw Error('missing session')
      return {binding:{session:face},ready:Promise.resolve({session:face}),release(){}}
    }
  }
  const workspaces={list:{getSnapshot:()=>({items:[{workspaceId:'ws',sessionIds:['existing'],path:'/ws',title:'测试'}]})}}
  const directory={async list(){return {rows:[{sessionId:'existing',running:true,updatedAt:1}],syncedAt:Date.now()}}}
  const coordinator=new Coordinator(sessions as never,workspaces as never,host as never,()=>true,
    (id)=>{opened.push(id)},testModels,directory as never)
  return {host,coordinator,faces,ordinary,opened}
}
/** 任务 a：已在 existing 上完成，会话随后被外部复用继续运行。 */
function completedTask():QueueState{
  let q=add(EMPTY_QUEUE,{workspaceId:'ws',prompt:'旧任务的工作',title:'旧任务',goalMode:true},'a')
  return {...q,tasks:[{...q.tasks[0]!,status:'completed' as const,sessionId:'existing',goalId:'goal-a',
    attempts:[{id:'a:attempt:1',status:'completed' as const,sessionId:'existing',goalId:'goal-a',
      seenRunning:true,createdAt:1,updatedAt:1}]}]}
}
const input={workspaceId:'ws',prompt:'p',title:'t',goalMode:false}

test('R06 链：旧任务删除后外部活动仍被占用计数、仍可打开；仅权威 stop 释放',async()=>{
  const x=setup(completedTask())
  x.coordinator.start();await tick()
  await x.coordinator.discover();await tick()
  assert.deepEqual(x.host.value.queue.sessionActivity,['existing'],'外部复用的会话进入活动占用')
  await x.coordinator.remove('a');await tick()
  const current=x.host.value.queue
  assert.equal(current.tasks.length,0,'旧任务记录已删除')
  const s=summarizeQueue(current)
  assert.equal(s.occupied,1,'占用仍被计数：不得因删除任务而隐身')
  assert.equal(s.externalActivity,1,'占用来源可见：外部活动')
  assert.equal(s.starting,0);assert.equal(s.observedRunning,0,'无队列任务虚占名额')
  // 旧任务删除后仍可打开该外部会话。
  await x.coordinator.openSessionById('existing')
  assert.deepEqual(x.opened,['existing'],'openSessionById 直达被观察的会话')
  // 不存在的会话 → SESSION_NOT_FOUND，不静默。
  await assert.rejects(()=>x.coordinator.openSessionById('vanished'),
    (e:unknown)=>e instanceof QueueError&&e.code==='SESSION_NOT_FOUND')
  assert.deepEqual(x.opened,['existing'],'不存在的会话不得触发打开')
  // 权威 stop 才释放占用。
  x.ordinary.state.running=false;x.ordinary.emit();await tick()
  assert.deepEqual(x.host.value.queue.sessionActivity,[],'权威 stop 释放外部活动占用')
  assert.equal(summarizeQueue(x.host.value.queue).occupied,0)
  x.coordinator.dispose()
})
test('去重与下限：trackSessionActivity 不重复计数、不重复自有运行会话；release 幂等不为负',()=>{
  let q=trackSessionActivity(EMPTY_QUEUE,'s-1')
  q=trackSessionActivity(q,'s-1')
  assert.deepEqual(q.sessionActivity,['s-1'],'同一会话只计一次')
  let r=add(EMPTY_QUEUE,input,'a')
  r={...r,enabled:true,activeId:'a',activeIds:['a'],
    tasks:[{...r.tasks[0]!,status:'running' as const,sessionId:'s-2'}]}
  r=trackSessionActivity(r,'s-2')
  assert.deepEqual(r.sessionActivity,[],'自有运行任务的会话不重复计为外部活动')
  const withExtra=trackSessionActivity(r,'s-9')
  assert.deepEqual(withExtra.sessionActivity,['s-9'])
  assert.equal(releaseSessionActivity(withExtra,'unknown'),withExtra,'释放未知 id 原样返回')
  const released=releaseSessionActivity(withExtra,'s-9')
  assert.deepEqual(released.sessionActivity,[])
  assert.equal(releaseSessionActivity(released,'s-9'),released,'重复释放原样返回，计数不为负')
})
test('超限与拆分：occupied 达上限时 next() 不派发；occupied 对自有会话去重；starting/running 分列',()=>{
  let q=add(add(EMPTY_QUEUE,input,'a'),input,'b')
  q={...q,enabled:true,maxConcurrent:1,sessionActivity:['ext-1']}
  assert.equal(next(q),undefined,'外部活动占用唯一名额时不得派发')
  const s=summarizeQueue(q)
  assert.deepEqual(s,{unresolved:0,pending:2,starting:0,observedRunning:0,externalActivity:1,occupied:1})
  let r=add(EMPTY_QUEUE,input,'a')
  r={...r,enabled:true,activeId:'a',activeIds:['a'],sessionActivity:['s-1'],
    tasks:[{...r.tasks[0]!,status:'running' as const,sessionId:'s-1'}]}
  const s2=summarizeQueue(r)
  assert.equal(s2.occupied,1,'自有会话双计去重为一个名额')
  assert.equal(s2.observedRunning,1)
  assert.equal(s2.externalActivity,0)
  let t=add(EMPTY_QUEUE,input,'a')
  t={...t,enabled:true,activeId:'a',activeIds:['a'],
    tasks:[{...t.tasks[0]!,status:'starting' as const,sessionId:'s-1'}]}
  const s3=summarizeQueue(t)
  assert.equal(s3.starting,1,'已 claim 未观察到运行计入 starting')
  assert.equal(s3.observedRunning,0)
  assert.equal(s3.occupied,1)
})
