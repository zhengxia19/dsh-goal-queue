import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Coordinator } from '../src/client/coordinator.ts'
import { EMPTY_QUEUE,add,adopt,decode,claim,recover,next,setConcurrency,retry,type QueueSettings,type QueueState } from '../src/queue.ts'

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
  projections={faceOf:()=>({
    getSnapshot:()=>this.goal,
    subscribe:(fn:()=>void)=>{this.watchers.add(fn);return()=>{this.watchers.delete(fn)}}
  })}
  emit(){for(const fn of this.watchers)fn()}
  async prompt(){this.state.running=true;this.emit();return {ok:true,value:{accepted:true}}}
  async command(line:string){
    if(line==='/goal resume'&&this.goal){this.goal.goal.phase='active';return {ok:true,value:{matched:true}}}
    this.goal={goal:{id:'goal-created',objective:line.slice(6),phase:'active'}}
    this.emit()
    return {ok:true,value:{matched:true}}
  }
}
function setup(q:QueueState){
  const host=new Host(q)
  const faces=new Map<string,Face>()
  let created=0,submitted=0
  const ordinary=new Face();ordinary.state.running=true
  faces.set('existing',ordinary)
  const summaries={
    ids:['existing'],
    byId:{existing:{id:'existing',title:'正在执行的原任务',displayTitle:'正在执行的原任务',
      running:true,updatedAt:1,origin:undefined}},
    phase:'ready'
  }
  const sessions={
    list:{
      getSnapshot:()=>summaries,
      subscribe:(_fn:()=>void)=>()=>{}
    },
    async refresh(){},
    async create(){created++;const id='created-'+created;faces.set(id,new Face());return id},
    retain(id:string){
      const face=faces.get(id)
      if(!face)throw Error('missing session')
      return {binding:{session:face},ready:Promise.resolve({session:face}),release(){}}
    }
  }
  const workspaces={list:{getSnapshot:()=>({items:[{workspaceId:'ws',sessionIds:['existing'],path:'/ws',title:'测试'}]})}}
  const coordinator=new Coordinator(sessions as never,workspaces as never,host as never,()=>true)
  return {host,coordinator,faces,ordinary,summaries,created:()=>created,submitted:()=>submitted}
}

test('migration: legacy activeId and tasks survive without a destructive reset',()=>{
  let q=add(EMPTY_QUEUE,input('A'),'a')
  q=claim({...q,enabled:true},'a')
  const legacy={version:1,queue:{enabled:true,activeId:'a',tasks:q.tasks,error:''}}
  const value=decode(legacy)
  assert.ok(value)
  assert.deepEqual(value.queue.activeIds,['a'])
  assert.equal(value.queue.maxConcurrent,1)
  const recovered=recover(value.queue)
  assert.equal(recovered.tasks[0]?.status,'interrupted')
  assert.equal(recovered.tasks[0]?.id,'a')
  assert.equal(recovered.enabled,false)
})
test('maxConcurrent reserves two slots, the third waits, lowering limit never cancels',()=>{
  let q=add(add(add(EMPTY_QUEUE,input('A'),'a'),input('B'),'b'),input('C'),'c')
  q=setConcurrency({...q,enabled:true},2)
  q=claim(q,'a');q=claim(q,'b')
  assert.deepEqual(q.activeIds,['a','b'])
  assert.equal(next(q),undefined)
  q=setConcurrency(q,1)
  assert.deepEqual(q.activeIds,['a','b'])
  assert.equal(next(q),undefined)
})
test('imported running Session deduplicates and occupies a slot while queue stays paused',()=>{
  let q=add(EMPTY_QUEUE,input('pending'),'a')
  q=adopt(q,{sessionId:'old',workspaceId:'ws',title:'原生标题',goalMode:false},'imported')
  const again=adopt(q,{sessionId:'old',workspaceId:'ws',title:'原生标题',goalMode:false},'duplicate')
  assert.equal(again.tasks.length,2)
  assert.deepEqual(again.activeIds,['imported'])
  assert.equal(again.enabled,false)
  assert.equal(again.tasks[1]?.source,'discovered')
})
test('opening panel discovers running DPH Session once without submitting anything',async()=>{
  const x=setup(add(EMPTY_QUEUE,input('later'),'a'))
  x.coordinator.start();await tick()
  await x.coordinator.discover();await tick()
  await x.coordinator.discover();await tick()
  assert.equal(x.created(),0)
  assert.equal(x.host.value.queue.tasks.length,2)
  assert.equal(x.host.value.queue.activeIds.length,1)
  assert.equal(x.host.value.queue.enabled,false)
  x.ordinary.state.running=false;x.ordinary.emit();await tick()
  assert.equal(x.host.value.queue.tasks[1]?.status,'completed')
  x.coordinator.dispose()
})
test('manual Goal reactivation uses original Session and never creates another Session',async()=>{
  let q=add(EMPTY_QUEUE,{workspaceId:'ws',prompt:'Goal work',title:'',goalMode:true},'old')
  q={...q,tasks:[{...q.tasks[0]!,sessionId:'existing',goalId:'goal-old',status:'interrupted' as const}]}
  const x=setup(q)
  x.ordinary.state.running=false
  x.ordinary.goal={goal:{id:'goal-old',objective:'Goal work',phase:'paused'}}
  x.coordinator.start();await tick()
  await x.coordinator.resumeGoal('old');await tick()
  assert.equal(x.created(),0)
  assert.equal(x.host.value.queue.tasks[0]?.status,'running')
  assert.equal(x.host.value.queue.enabled,false)
  x.ordinary.goal.goal.phase='complete';x.ordinary.emit();await tick()
  assert.equal(x.host.value.queue.tasks[0]?.status,'completed')
  x.coordinator.dispose()
})
test('empty title remains valid and no synthetic model title command is submitted',()=>{
  const q=add(EMPTY_QUEUE,{workspaceId:'ws',prompt:'请实现功能',title:'',goalMode:true},'goal')
  assert.equal(q.tasks[0]?.title,'')
})

test('start is blocked until a trustworthy DPH Session scan has completed',async()=>{
  const x=setup(add(EMPTY_QUEUE,input('later'),'a'))
  x.coordinator.start();await tick()
  await assert.rejects(x.coordinator.enable(true),/扫描/)
  assert.equal(x.created(),0)
  const first=x.coordinator.discover(),second=x.coordinator.discover()
  assert.equal(first,second,'simultaneous discovery calls share one in-flight promise')
  await first;await tick()
  await x.coordinator.enable(true);await tick()
  // Existing running Session consumes the sole default slot.
  assert.equal(x.created(),0)
  x.ordinary.state.running=false;x.ordinary.emit();await tick()
  assert.equal(x.created(),1)
  x.coordinator.dispose()
})
test('an imported unknown prompt must not be replayed as an empty task',()=>{
  let q=adopt(EMPTY_QUEUE,{sessionId:'old',workspaceId:'ws',title:'existing',goalMode:false},'imported')
  q=recover({...q,enabled:true})
  assert.throws(()=>retry(q,'imported'),/没有可复用的任务说明/)
})
