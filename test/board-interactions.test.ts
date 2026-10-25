/** U06 (T7.3): one verification entry — read-only inspect, running rejection, resume claim,
 * requeue provability, and the board's accurate naming/feedback (design §6.4, §8.3; 清单 §5). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Coordinator } from '../src/client/coordinator.ts'
import { testModels } from './model-fixture.ts'
import { EMPTY_QUEUE, type QueueSettings, type QueueState, type Task } from '../src/queue.ts'
import { QueueError } from '../src/errors.ts'

const tick=async()=>{for(let i=0;i<16;i++)await new Promise(resolve=>setTimeout(resolve,0))}
class Host {
  value:QueueSettings
  writes=0
  listeners=new Set<()=>void>()
  constructor(q:QueueState){this.value={version:1,queue:q}}
  getSnapshot(){return {status:'ready',value:this.value}}
  subscribe(fn:()=>void){this.listeners.add(fn);return()=>{this.listeners.delete(fn)}}
  failClosed(_reason:string){}
  async set(_key:string,q:QueueState){this.writes++;this.value={version:1,queue:q};for(const fn of this.listeners)fn()}
}
class Face {
  state={running:false,awaitingFirstTurn:false,lastAgentError:null}
  goal:{goal:{id:string;objective:string;phase:string}}|null=null
  commands:string[]=[]
  watchers=new Set<()=>void>()
  getSnapshot=()=>this.state
  subscribe=(fn:()=>void)=>{this.watchers.add(fn);return()=>{this.watchers.delete(fn)}}
  projections={faceOf:(key:string)=>({
    getSnapshot:()=>key==='goal'?this.goal:undefined,
    subscribe:(fn:()=>void)=>{this.watchers.add(fn);return()=>{this.watchers.delete(fn)}}
  })}
  async command(text:string){
    this.commands.push(text)
    if(text==='/goal resume'){
      if(this.goal)this.goal={...this.goal,goal:{...this.goal.goal,phase:'active'}}
      this.state.running=true;this.emit()
    }
    return {ok:true,value:{matched:true}}
  }
  emit(){for(const fn of this.watchers)fn()}
}
interface Row {sessionId:string;running:boolean;cwd?:string}
function setup(q:QueueState,rows:Row[]=[]){
  const host=new Host(q)
  const faces=new Map<string,Face>()
  for(const row of rows){const face=new Face();face.state.running=row.running;faces.set(row.sessionId,face)}
  const sessions={
    list:{getSnapshot:()=>({ids:[...faces.keys()],byId:{},phase:'ready'}),subscribe:()=>()=>{}},
    async refresh(){},
    async create(){const id='created-new';faces.set(id,new Face());return id},
    retain(id:string){
      const face=faces.get(id)
      if(!face)throw Error('missing session')
      return {binding:{session:face},ready:Promise.resolve({session:face}),release(){}}
    }
  }
  const workspaces={list:{getSnapshot:()=>({items:[{workspaceId:'ws',sessionIds:[],path:'/ws',title:'测试'}]})}}
  const directory={async list(){return {rows:rows.map(r=>({sessionId:r.sessionId,running:r.running,cwd:r.cwd??'/ws'})),syncedAt:Date.now()}}}
  const coordinator=new Coordinator(sessions as never,workspaces as never,host as never,()=>true,undefined,testModels,directory as never)
  return {host,coordinator,faces}
}
const goalTask=(id:string,sessionId:string,goalId:string):Task=>
  ({id,workspaceId:'ws',title:'',prompt:'Goal work',goalMode:true,status:'interrupted',sessionId,goalId,createdAt:1,updatedAt:1})

test('inspect is read-only and idempotent: repeated clicks never write and return the same facts',async()=>{
  const task:Task={id:'a',workspaceId:'ws',title:'A',prompt:'work',goalMode:false,status:'interrupted',sessionId:'sess-1',createdAt:1,updatedAt:1}
  const x=setup({...EMPTY_QUEUE,tasks:[task]},[{sessionId:'sess-1',running:false}])
  const first=await x.coordinator.inspect('a')
  const second=await x.coordinator.inspect('a')
  assert.deepEqual(first,second)
  assert.equal(x.host.writes,0,'verification performs zero writes')
  assert.equal(first.sessionFound,true)
  assert.equal(first.sessionRunning,false)
  assert.equal(first.goalIdMatches,null)
  assert.equal(first.canRetry,true)
  assert.equal(first.canSkip,true)
  assert.equal(first.canResume,false)
  assert.match(first.reasons.resume??'',/普通模式/)
  await assert.rejects(x.coordinator.inspect('missing'),e=>e instanceof QueueError&&e.code==='TASK_NOT_FOUND')
})
test('a still-running original Session rejects every disposition with the contract code',async()=>{
  const task:Task={id:'a',workspaceId:'ws',title:'A',prompt:'work',goalMode:false,status:'interrupted',sessionId:'sess-1',createdAt:1,updatedAt:1}
  const x=setup({...EMPTY_QUEUE,tasks:[task]},[{sessionId:'sess-1',running:true}])
  const insp=await x.coordinator.inspect('a')
  assert.equal(insp.sessionRunning,true)
  assert.equal(insp.canRetry,false)
  assert.equal(insp.canSkip,false)
  assert.equal(insp.canResume,false)
  assert.equal(insp.reasons.retry,'原会话仍在运行，请先处置')
  assert.ok(insp.warnings.some(w=>w.includes('仍在运行')))
  await assert.rejects(x.coordinator.retry('a'),e=>e instanceof QueueError&&e.code==='SESSION_STILL_RUNNING')
  await assert.rejects(x.coordinator.skip('a'),e=>e instanceof QueueError&&e.code==='SESSION_STILL_RUNNING')
  assert.equal(x.host.value.queue.tasks[0]!.status,'interrupted','rejection leaves the task untouched')
})
test('resume keeps its claim: one resume occupies the sole slot, repeats and second goals are refused',async()=>{
  const a=goalTask('old','sess-1','goal-1')
  const b=goalTask('old2','sess-2','goal-2')
  const x=setup({...EMPTY_QUEUE,tasks:[a,b]},[{sessionId:'sess-1',running:false},{sessionId:'sess-2',running:false}])
  x.faces.get('sess-1')!.goal={goal:{id:'goal-1',objective:'Goal work',phase:'paused'}}
  x.faces.get('sess-2')!.goal={goal:{id:'goal-2',objective:'Goal work',phase:'paused'}}
  const insp=await x.coordinator.inspect('old')
  assert.equal(insp.canResume,true)
  assert.equal(insp.goalIdMatches,true)
  await x.coordinator.resumeGoal('old');await tick()
  assert.deepEqual(x.host.value.queue.activeIds,['old'],'resume claims the sole slot exactly once')
  assert.deepEqual(x.faces.get('sess-1')!.commands,['/goal resume'])
  await assert.rejects(x.coordinator.resumeGoal('old'),/只有已中断或阻塞/)
  await assert.rejects(x.coordinator.resumeGoal('old2'),e=>e instanceof QueueError&&e.code==='CAPACITY_FULL')
  const second=await x.coordinator.inspect('old2')
  assert.equal(second.canResume,false)
  assert.equal(second.reasons.resume,'当前执行名额已被占用')
  x.coordinator.dispose()
})
test('edit-and-requeue only when the last attempt provably never submitted the command',async()=>{
  const proven:Task={id:'a',workspaceId:'ws',title:'A',prompt:'work',goalMode:false,status:'failed',
    createdAt:1,updatedAt:1,attempts:[{id:'at1',status:'failed',createdAt:1,updatedAt:1,phase:'precheck'}]}
  const x=setup({...EMPTY_QUEUE,tasks:[proven]})
  const insp=await x.coordinator.inspect('a')
  assert.equal(insp.canRequeueEdited,true)
  await x.coordinator.requeueEdited('a',{workspaceId:'ws',title:'A2',prompt:'new prompt',goalMode:false})
  const after=x.host.value.queue.tasks[0]!
  assert.equal(after.status,'pending')
  assert.equal(after.title,'A2')
  assert.equal(after.sessionId,undefined)
  assert.deepEqual(after.attempts?.map(t=>t.phase),['precheck'],'attempt evidence is retained')
  // command submitted: not provable, both the inspection and the write refuse.
  const submitted:Task={...proven,attempts:[{id:'at2',status:'failed',createdAt:1,updatedAt:1,phase:'command_submitted'}]}
  const x2=setup({...EMPTY_QUEUE,tasks:[submitted]})
  assert.equal((await x2.coordinator.inspect('a')).canRequeueEdited,false)
  await assert.rejects(x2.coordinator.requeueEdited('a',{workspaceId:'ws',title:'A2',prompt:'again',goalMode:false}),
    e=>e instanceof QueueError&&e.code==='REQUEUE_EDIT_NOT_PROVEN')
  // legacy attempts carry no phase: never fabricated, conservatively refused.
  const legacy:Task={...proven,attempts:[{id:'at3',status:'failed',createdAt:1,updatedAt:1}]}
  const x3=setup({...EMPTY_QUEUE,tasks:[legacy]})
  const legacyInsp=await x3.coordinator.inspect('a')
  assert.equal(legacyInsp.canRequeueEdited,false)
  assert.equal(legacyInsp.reasons.requeueEdited,'派发阶段未记录，无法证明命令未提交')
})
test('the board names actions accurately and never uses window.confirm',()=>{
  const src=readFileSync(new URL('../src/client/QueueBoard.tsx',import.meta.url),'utf8')
  assert.ok(!src.includes('window.confirm'),'dispositions no longer rely on window.confirm')
  for(const phrase of [
    '查看并处理','待核实',
    '查看原会话','恢复原 Goal','重试此任务（新会话）','跳过此任务','编辑后重新排队','删除记录',
    '正在只读核实原 Session 与 Goal…',
    '原 Goal 已恢复，占用一个执行名额',
    '已重新排队，点击“启动队列”执行',
    '已跳过，队列仍暂停。点击“启动队列”继续待执行任务。',
    '已编辑并重新排队，点击“启动队列”执行',
    '记录已删除；其余任务状态不变',
  ])assert.ok(src.includes(phrase),'QueueBoard must contain: '+phrase)
})
