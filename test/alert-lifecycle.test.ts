// U05 告警生命周期（design §7.4，R04/R07 链）：updateActive 不写 q.error；titleError 绑任务行、
// claim 时归档进产生它的 attempt 且不串新 Attempt；历史诊断经持久化解码不丢失；Host 不可信仍阻断。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Coordinator } from '../src/client/coordinator.ts'
import { testModels } from './model-fixture.ts'
import { EMPTY_QUEUE,add,claim,decode,remove,recover,retry,setSessionId,skip,summarizeQueue,updateActive,type QueueSettings,type QueueState } from '../src/queue.ts'

const tick=async()=>{for(let i=0;i<16;i++)await new Promise(resolve=>setTimeout(resolve,0))}
const input={workspaceId:'ws',prompt:'p',title:'t',goalMode:false}

test('R04 链：任务失败/跳过/删除从不写全局 q.error；unresolved 仍暂停；系统级错误仍走 q.error',()=>{
  let q=claim({...add(EMPTY_QUEUE,input,'a'),enabled:true},'a')
  q=setSessionId(q,'a','original-session')
  q=updateActive(q,'a',{status:'blocked',detail:'Old blocker'})
  assert.equal(q.error,'','任务失败不得写入全局错误条')
  assert.equal(q.enabled,false,'unresolved 阻断仍置 enabled=false')
  q=remove(skip(q,'a'),'a')
  assert.equal(q.error,'','处置并删除后全局错误仍为空（R04 探针链）')
  assert.equal(summarizeQueue(q).unresolved,0)
  // 系统级（重启核实）仍写 q.error，由启动队列清除——语义保留。
  const rec=recover({...add(EMPTY_QUEUE,input,'a'),enabled:true,sessionActivity:['s-1']},'重启需要人工确认')
  assert.equal(rec.error,'重启需要人工确认')
})

test('R07 链：titleError 绑任务行；claim 归档进上一 attempt 且不串新 Attempt；解码后历史不丢失',()=>{
  let q=claim({...add(EMPTY_QUEUE,{...input,generateTitle:true},'a'),enabled:true},'a')
  q=updateActive(q,'a',{status:'running'})
  q=updateActive(q,'a',{titleError:'Title failed mid-run'})
  assert.equal(q.error,'','运行中的标题失败不写全局错误')
  assert.equal(q.tasks[0]!.titleError,'Title failed mid-run','标题失败绑定在任务行上')
  q=setSessionId(q,'a','first-session')
  q=updateActive(q,'a',{status:'failed',titleError:'Title failed in first attempt',detail:'First attempt failed'})
  assert.equal(q.error,'','标题失败不污染全局错误条（R04 验收）')
  q=retry(q,'a')
  q=claim({...q,enabled:true},'a')
  assert.equal(q.tasks[0]!.titleError,undefined,'新 Attempt 开始后旧告警不再是当前告警')
  q=setSessionId(q,'a','second-session')
  const attempts=q.tasks[0]!.attempts!
  assert.equal(attempts.length,2)
  assert.equal(attempts[0]!.titleError,'Title failed in first attempt','旧告警归档进产生它的那次 Attempt')
  assert.equal(attempts[1]!.titleError,undefined,'新 Attempt 不被旧告警污染（不串 Attempt）')
  q=updateActive(q,'a',{status:'completed'})
  assert.equal(q.tasks[0]!.titleError,undefined,'完成后任务行仍无当前标题告警')
  // 历史诊断不丢失：经 Host 持久化解码后仍在。
  const decoded=decode({version:1,queue:q})
  assert.ok(decoded)
  assert.equal(decoded.queue.tasks[0]!.attempts![0]!.titleError,'Title failed in first attempt')
})

class Host {
  value:QueueSettings
  status:'ready'|'error'='ready'
  failure?:string
  listeners=new Set<()=>void>()
  constructor(q:QueueState){this.value={version:1,queue:q}}
  getSnapshot(){return this.status==='ready'?{status:'ready',value:this.value}:{status:'error',error:this.failure}}
  subscribe(fn:()=>void){this.listeners.add(fn);return()=>{this.listeners.delete(fn)}}
  failClosed(reason:string){this.status='error';this.failure=reason;for(const fn of this.listeners)fn()}
  async set(_key:string,q:QueueState){this.value={version:1,queue:q};for(const fn of this.listeners)fn()}
}
class Face {
  state={running:false,awaitingFirstTurn:false,lastAgentError:null}
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
  const sessions={
    list:{getSnapshot:()=>({ids:[],byId:{},phase:'ready'}),subscribe:(_fn:()=>void)=>()=>{}},
    async refresh(){},
    async create(){const id='created-1';faces.set(id,new Face());return id},
    retain(id:string){
      const face=faces.get(id)
      if(!face)throw Error('missing session')
      return {binding:{session:face},ready:Promise.resolve({session:face}),release(){}}
    }
  }
  const workspaces={list:{getSnapshot:()=>({items:[{workspaceId:'ws',sessionIds:[],path:'/ws',title:'测试'}]})}}
  const directory={async list(){return {rows:[],syncedAt:Date.now()}}}
  const coordinator=new Coordinator(sessions as never,workspaces as never,host as never,()=>true,
    undefined,testModels,directory as never)
  return {host,coordinator}
}

test('Host 不可信（settings.status=error）仍阻断：撤销启动授权，操作与启动均被拒绝',async()=>{
  const x=setup(add(EMPTY_QUEUE,input,'a'))
  x.coordinator.start();await tick()
  await x.coordinator.enable(true);await tick()
  assert.equal(x.coordinator.isAuthorized(),true,'就绪 Host 下启动授权正常')
  x.host.failClosed('Host disconnected')
  assert.equal(x.coordinator.isAuthorized(),false,'Host 不可信立即撤销启动授权')
  await assert.rejects(()=>x.coordinator.add(input),/Host disconnected/)
  await assert.rejects(()=>x.coordinator.enable(true),/Host disconnected/)
  await assert.rejects(()=>x.coordinator.remove('a'),/Host disconnected/)
  x.coordinator.dispose()
})
