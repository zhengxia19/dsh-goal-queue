// U03 发现调度（design §6.2/§7.1 R01 链）：booted 自动首次发现（面板未开）、runningSignature
// 变化触发合并发现、扫描中 discoveryQueued 补扫、subagent 排除、connectionReset 重置基线、
// 扫描失败 → syncState=failed + 解除授权、恢复读取不自动重跑（B1）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
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
  goal:{goal:{id:string;objective:string;phase:string}}|null=null
  watchers=new Set<()=>void>()
  getSnapshot=()=>this.state
  subscribe=(fn:()=>void)=>{this.watchers.add(fn);return()=>{this.watchers.delete(fn)}}
  projections={faceOf:(key:string)=>({
    getSnapshot:()=>key==='modelSelection'?{next:TEST_MODEL}:this.goal,
    subscribe:(fn:()=>void)=>{this.watchers.add(fn);return()=>{this.watchers.delete(fn)}}
  })}
  emit(){for(const fn of this.watchers)fn()}
  async prompt(){this.state.running=true;this.emit();return {ok:true,value:{accepted:true}}}
}
type Row={sessionId:string;running:boolean;updatedAt:number;origin?:string}
function setup(q:QueueState){
  const host=new Host(q)
  const faces=new Map<string,Face>()
  let created=0
  const ordinary=new Face();ordinary.state.running=true
  faces.set('existing',ordinary)
  const listState:{ids:string[];byId:Record<string,{id:string;title:string;displayTitle:string;running:boolean;updatedAt:number;origin?:string}>;phase:string}=
    {ids:['existing'],byId:{existing:{id:'existing',title:'正在执行的原任务',displayTitle:'正在执行的原任务',
      running:true,updatedAt:1,origin:undefined}},phase:'ready'}
  let listListener:(()=>void)|null=null
  const sessions={
    list:{
      getSnapshot:()=>listState,
      subscribe:(fn:()=>void)=>{listListener=fn;return()=>{listListener=null}}
    },
    async refresh(){},
    async create(){created++;const id='s-'+created;const f=new Face();f.state.running=true;faces.set(id,f);return id},
    retain(id:string){
      const face=faces.get(id)
      if(!face)throw Error('missing session')
      return {binding:{session:face},ready:Promise.resolve({session:face}),release(){}}
    }
  }
  const workspaces={list:{getSnapshot:()=>({items:[{workspaceId:'ws',sessionIds:['existing'],path:'/ws',title:'测试'}]})}}
  const directory={
    calls:0,
    mode:'ok' as 'ok'|'fail',
    gate:null as Promise<void>|null,
    rows:[{sessionId:'existing',running:true,updatedAt:1}] as Row[],
    async list(){
      this.calls++
      if(this.mode==='fail')throw new QueueError('DIRECTORY_READ_FAILED','模拟目录读取失败')
      if(this.gate)await this.gate
      return {rows:this.rows,syncedAt:Date.now()}
    }
  }
  const coordinator=new Coordinator(sessions as never,workspaces as never,host as never,()=>true,undefined,testModels,directory as never)
  const addRunning=(id:string,origin?:string)=>{
    const face=new Face();face.state.running=true;faces.set(id,face)
    listState.ids.push(id)
    listState.byId[id]={id,title:'运行中的会话',displayTitle:'运行中的会话',running:true,updatedAt:2,origin}
    directory.rows.push({sessionId:id,running:true,updatedAt:2,origin})
  }
  const fireList=()=>{listListener?.()}
  return {host,coordinator,faces,ordinary,directory,addRunning,fireList,created:()=>created}
}

test('booted schedules the first discovery without opening the panel (R01)',async()=>{
  const x=setup(add(EMPTY_QUEUE,input('later'),'a'))
  x.coordinator.start();await tick()
  assert.equal(x.directory.calls,1,'boot 自动触发首次只读发现，面板从未打开')
  assert.equal(x.host.value.queue.tasks.length,2)
  assert.equal(x.host.value.queue.activeIds.length,1,'运行中的原 Session 占用名额')
  assert.equal(x.created(),0,'发现只观察，不提交任何模型命令')
  assert.equal(x.coordinator.getSyncState().state,'fresh')
  x.coordinator.dispose()
})
test('runningSignature change in the Host list triggers one merged discovery',async()=>{
  const x=setup(add(EMPTY_QUEUE,input('later'),'a'))
  x.coordinator.start();await tick()
  assert.equal(x.directory.calls,1)
  x.addRunning('late')
  x.fireList();await tick()
  assert.equal(x.directory.calls,2,'running 集合变化自动触发发现，无需人工刷新')
  assert.ok(x.host.value.queue.tasks.some(t=>t.sessionId==='late'&&t.source==='discovered'))
  x.fireList();await tick()
  assert.equal(x.directory.calls,2,'签名未再变化不得重复扫描')
  x.coordinator.dispose()
})
test('changes observed mid-scan are covered by one queued follow-up pass',async()=>{
  const x=setup(add(EMPTY_QUEUE,input('later'),'a'))
  let release!:()=>void
  x.directory.gate=new Promise<void>(resolve=>{release=resolve})
  x.coordinator.start()
  await tick()
  assert.equal(x.coordinator.getSyncState().state,'scanning')
  x.addRunning('late')
  x.fireList()
  await tick()
  assert.equal(x.coordinator.getSyncState().state,'scanning','扫描中不并行开新扫描，只登记补扫')
  release();await tick()
  assert.equal(x.directory.calls,2,'扫描期间的变化由本轮完成后的补扫覆盖')
  assert.equal(x.coordinator.getSyncState().state,'fresh')
  assert.ok(x.host.value.queue.tasks.some(t=>t.sessionId==='late'))
  x.coordinator.dispose()
})
test('subagent running sessions never trigger discovery and are never adopted',async()=>{
  const x=setup(add(EMPTY_QUEUE,input('later'),'a'))
  x.coordinator.start();await tick()
  assert.equal(x.directory.calls,1)
  x.addRunning('sub-1','subagent')
  x.fireList();await tick()
  assert.equal(x.directory.calls,1,'subagent 不改变 running 签名，不触发发现')
  assert.ok(!x.host.value.queue.tasks.some(t=>t.sessionId==='sub-1'),'subagent 不会被收养')
  x.coordinator.dispose()
})
test('connectionReset marks initializing then auto-rescans a fresh baseline',async()=>{
  const x=setup(add(EMPTY_QUEUE,input('later'),'a'))
  x.coordinator.start();await tick()
  assert.equal(x.coordinator.getSyncState().state,'fresh')
  await x.coordinator.connectionReset()
  assert.equal(x.coordinator.getSyncState().state,'initializing','连接重置清空基线与签名')
  assert.equal(x.directory.calls,1)
  await tick()
  assert.equal(x.directory.calls,2,'重置后 boot 收敛自动重新扫描，无需打开面板')
  assert.equal(x.coordinator.getSyncState().state,'fresh')
  x.coordinator.dispose()
})
test('scan failure marks failed + disarms; recovery read refreshes baseline without re-running',async()=>{
  const x=setup(add(add(EMPTY_QUEUE,input('A'),'a'),input('B'),'b'))
  x.directory.mode='fail'
  x.coordinator.start();await tick()
  const failed=x.coordinator.getSyncState()
  assert.equal(failed.state,'failed')
  assert.ok(failed.state==='failed'&&failed.reason.includes('模拟目录读取失败'))
  await assert.rejects(x.coordinator.enable(true),/扫描/)
  assert.equal(x.created(),0,'失败期间零派发')
  x.directory.mode='ok'
  await x.coordinator.discover();await tick()
  assert.equal(x.coordinator.getSyncState().state,'fresh')
  assert.equal(x.coordinator.isAuthorized(),false,'恢复读取不得自动重新授权（B1 不自动重跑）')
  assert.equal(x.created(),0)
  x.coordinator.dispose()
})
