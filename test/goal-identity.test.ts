// U01 Goal 身份保护（design §7.3 R05 链）：A 中断 → 同会话跑 B → B 结束 → A 未结算、证据完整、needsReview。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Coordinator } from '../src/client/coordinator.ts'
import { TEST_MODEL, testModels } from './model-fixture.ts'
import { EMPTY_QUEUE,add,adopt,flagForReview,decode,type QueueSettings,type QueueState } from '../src/queue.ts'

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
    getSnapshot:()=>key==='modelSelection'?{next:TEST_MODEL}:this.goal,
    subscribe:(fn:()=>void)=>{this.watchers.add(fn);return()=>{this.watchers.delete(fn)}}
  })}
  emit(){for(const fn of this.watchers)fn()}
}
function setup(q:QueueState){
  const host=new Host(q)
  const faces=new Map<string,Face>()
  let created=0
  const ordinary=new Face();ordinary.state.running=true
  faces.set('existing',ordinary)
  const summaries={
    ids:['existing'],
    byId:{existing:{id:'existing',title:'外部 Goal 会话',displayTitle:'外部 Goal 会话',
      running:true,updatedAt:1,origin:undefined}},
    phase:'ready'
  }
  const sessions={
    list:{getSnapshot:()=>summaries,subscribe:(_fn:()=>void)=>()=>{}},
    async refresh(){},
    async create(){created++;const id='created-'+created;faces.set(id,new Face());return id},
    retain(id:string){
      const face=faces.get(id)
      if(!face)throw Error('missing session')
      return {binding:{session:face},ready:Promise.resolve({session:face}),release(){}}
    }
  }
  const workspaces={list:{getSnapshot:()=>({items:[{workspaceId:'ws',sessionIds:['existing'],path:'/ws',title:'测试'}]})}}
  const directory={async list(){return {rows:[{sessionId:'existing',running:true,updatedAt:1}],syncedAt:Date.now()}}}
  const coordinator=new Coordinator(sessions as never,workspaces as never,host as never,()=>true,undefined,testModels,directory as never)
  return {host,coordinator,faces,ordinary,created:()=>created}
}
/** 任务 a：goalMode Goal，曾在 existing 上执行并中断，证据完整。 */
function interruptedGoal(goalId:string):QueueState{
  let q=add(EMPTY_QUEUE,{workspaceId:'ws',prompt:'Goal A 的工作',title:'',goalMode:true},'a')
  return {...q,tasks:[{...q.tasks[0]!,sessionId:'existing',goalId,status:'interrupted' as const,
    detail:'程序启动或连接切换；检查旧 Session 后手工激活队列',
    attempts:[{id:'a:attempt:1',status:'interrupted' as const,sessionId:'existing',goalId,
      seenRunning:true,detail:'程序启动或连接切换；检查旧 Session 后手工激活队列',createdAt:1,updatedAt:1}]}]}
}
function interruptedPlain():QueueState{
  let q=add(EMPTY_QUEUE,{workspaceId:'ws',prompt:'普通任务',title:'普通',goalMode:false},'a')
  return {...q,tasks:[{...q.tasks[0]!,sessionId:'existing',status:'interrupted' as const}]}
}

test('R05 链：同会话运行其他 Goal 时 A 不 adopt 不结算，needsReview 且证据完整',async()=>{
  const x=setup(interruptedGoal('goal-a'))
  x.ordinary.goal={goal:{id:'goal-b',objective:'Goal B 的工作',phase:'active'}}
  x.coordinator.start();await tick()
  await x.coordinator.discover();await tick()
  const a=x.host.value.queue.tasks.find(t=>t.id==='a')!
  assert.equal(a.status,'interrupted','A 不得被 adopt 结算为 running')
  assert.equal(a.needsReview,true,'A 必须标记待核实')
  assert.equal(a.goalId,'goal-a','A 的 Goal 身份不得被 B 覆盖')
  assert.equal(a.attempts?.length,1,'A 的执行证据必须保留')
  assert.equal(a.attempts?.[0]?.goalId,'goal-a')
  assert.deepEqual(x.host.value.queue.sessionActivity,['existing'],'B 的会话作为外部活动占用名额')
  assert.equal(x.created(),0,'发现过程不得创建或提交任何内容')
  // B 结束（会话停止）后 A 仍未结算，等待人工处置。
  x.ordinary.state.running=false;x.ordinary.emit();await tick()
  const a2=x.host.value.queue.tasks.find(t=>t.id==='a')!
  assert.equal(a2.status,'interrupted')
  assert.equal(a2.needsReview,true)
  assert.deepEqual(x.host.value.queue.sessionActivity,[],'权威 stop 释放外部活动占用')
  x.coordinator.dispose()
})
test('同 Goal 仍在运行：照旧 adopt，不标记待核实',async()=>{
  const x=setup(interruptedGoal('goal-a'))
  x.ordinary.goal={goal:{id:'goal-a',objective:'Goal A 的工作',phase:'active'}}
  x.coordinator.start();await tick()
  await x.coordinator.discover();await tick()
  const a=x.host.value.queue.tasks.find(t=>t.id==='a')!
  assert.equal(a.status,'running')
  assert.notEqual(a.needsReview,true)
  x.coordinator.dispose()
})
test('非 goalMode 的 interrupted：不自动 adopt 结算，改为待核实',async()=>{
  const x=setup(interruptedPlain())
  x.coordinator.start();await tick()
  await x.coordinator.discover();await tick()
  const a=x.host.value.queue.tasks.find(t=>t.id==='a')!
  assert.equal(a.status,'interrupted')
  assert.equal(a.needsReview,true)
  assert.match(a.detail??'',/缺少本次执行边界证据/)
  assert.deepEqual(x.host.value.queue.sessionActivity,['existing'])
  x.coordinator.dispose()
})
test('adopt 防御纵深：goalId 冲突原样返回，不覆盖不结算',()=>{
  const q=interruptedGoal('goal-a')
  const r=adopt(q,{sessionId:'existing',workspaceId:'ws',title:'外部 Goal',goalMode:true,goalId:'goal-b'},'a')
  assert.equal(r,q)
})
test('flagForReview：置 needsReview 写 detail，不改 status；decode 接受该字段',()=>{
  let q=add(EMPTY_QUEUE,{workspaceId:'ws',prompt:'p',title:'t',goalMode:false},'a')
  q=flagForReview(q,'a','请人工核实')
  const t=q.tasks.find(x=>x.id==='a')!
  assert.equal(t.status,'pending')
  assert.equal(t.needsReview,true)
  assert.equal(t.detail,'请人工核实')
  const decoded=decode({version:1,queue:{...q,activeId:null}})
  assert.equal(decoded?.queue.tasks[0]?.needsReview,true)
  assert.equal(flagForReview(q,'missing','x'),q,'未知任务原样返回')
})
