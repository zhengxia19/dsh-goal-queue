/** Persisted queue domain. Existing v1 snapshots are upgraded without deleting tasks. */
export const VERSION = 1 as const
export type TaskStatus = 'pending'|'starting'|'running'|'completed'|'blocked'|'failed'|'interrupted'|'skipped'
export type TaskSource = 'queue'|'discovered'
export interface Task {
  id: string; workspaceId: string; title: string; prompt: string; goalMode: boolean
  status: TaskStatus; source?: TaskSource; sessionId?: string; goalId?: string
  seenRunning?: boolean; detail?: string; createdAt: number; updatedAt: number
}
export interface QueueState {
  enabled: boolean
  /** Legacy v1 key, retained for old config compatibility. New dispatch uses activeIds. */
  activeId: string|null
  activeIds: string[]
  maxConcurrent: number
  tasks: Task[]
  error: string
}
export interface QueueSettings { version: 1; queue: QueueState }
export const EMPTY_QUEUE: QueueState = {enabled:false,activeId:null,activeIds:[],maxConcurrent:1,tasks:[],error:''}
export const DEFAULT_SETTINGS: QueueSettings = {version:VERSION,queue:EMPTY_QUEUE}
export const UNRESOLVED: readonly TaskStatus[] = ['blocked','failed','interrupted']
export const STATES: readonly TaskStatus[] = ['pending','starting','running','completed','blocked','failed','interrupted','skipped']
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)
const active=(t:Task)=>t.status==='running'||t.status==='starting'
const legacy=(ids:string[])=>ids.length===1?ids[0]!:null
const withActive=(q:QueueState,ids:string[]):QueueState=>({...q,activeIds:ids,activeId:legacy(ids)})
export function decode(value:unknown):QueueSettings|undefined {
  if(!object(value)||value.version!==VERSION||!object(value.queue))return
  const q=value.queue
  if(typeof q.enabled!=='boolean'||typeof q.error!=='string'||!Array.isArray(q.tasks))return
  if(q.activeId!==undefined&&q.activeId!==null&&typeof q.activeId!=='string')return
  const max=q.maxConcurrent===undefined?1:q.maxConcurrent
  if(!Number.isInteger(max)||typeof max!=='number'||max<1||max>8)return
  const tasks:Task[]=[],ids=new Set<string>(),sessionIds=new Set<string>()
  for(const raw of q.tasks){
    if(!object(raw)||typeof raw.id!=='string'||!raw.id||ids.has(raw.id)
      ||typeof raw.workspaceId!=='string'||typeof raw.title!=='string'||typeof raw.prompt!=='string'
      ||typeof raw.goalMode!=='boolean'||!STATES.includes(raw.status as TaskStatus)
      ||typeof raw.createdAt!=='number'||!Number.isFinite(raw.createdAt)
      ||typeof raw.updatedAt!=='number'||!Number.isFinite(raw.updatedAt)
      ||(raw.source!==undefined&&raw.source!=='queue'&&raw.source!=='discovered')
      ||(raw.sessionId!==undefined&&typeof raw.sessionId!=='string')
      ||(raw.goalId!==undefined&&typeof raw.goalId!=='string')
      ||(raw.seenRunning!==undefined&&typeof raw.seenRunning!=='boolean')
      ||(raw.detail!==undefined&&typeof raw.detail!=='string'))return
    if(typeof raw.sessionId==='string'){
      if(sessionIds.has(raw.sessionId))return
      sessionIds.add(raw.sessionId)
    }
    ids.add(raw.id);tasks.push(raw as unknown as Task)
  }
  const running=tasks.filter(active).map(t=>t.id)
  const slots=q.activeIds===undefined||(Array.isArray(q.activeIds)&&q.activeIds.length===0&&q.activeId)
    ?(q.activeId?[q.activeId]:running):q.activeIds
  if(!Array.isArray(slots)||slots.some(x=>typeof x!=='string')
    ||new Set(slots).size!==slots.length||slots.length!==running.length
    ||running.some(x=>!slots.includes(x)))return
  return {version:VERSION,queue:{
    enabled:q.enabled,activeId:legacy(slots),activeIds:[...slots],maxConcurrent:max,
    tasks,error:q.error
  }}
}
export function add(q:QueueState,input:Pick<Task,'title'|'workspaceId'|'prompt'|'goalMode'>,id:string,now=Date.now()):QueueState{
  if(!input.workspaceId||!input.prompt.trim()||q.tasks.some(t=>t.id===id))throw Error('工作区和任务说明不能为空，任务 ID 必须唯一')
  return {...q,tasks:[...q.tasks,{...input,title:input.title.trim(),prompt:input.prompt.trim(),source:'queue',status:'pending',id,createdAt:now,updatedAt:now}]}
}
export function edit(q:QueueState,id:string,input:Pick<Task,'title'|'workspaceId'|'prompt'|'goalMode'>,now=Date.now()):QueueState{
  if(!input.workspaceId||!input.prompt.trim())throw Error('工作区和任务说明不能为空')
  return {...q,tasks:q.tasks.map(t=>{
    if(t.id!==id)return t
    if(t.status!=='pending'||t.source==='discovered')throw Error('只允许编辑尚未执行的队列任务')
    return {...t,...input,title:input.title.trim(),prompt:input.prompt.trim(),updatedAt:now}
  })}
}
export function remove(q:QueueState,id:string):QueueState{
  if(q.activeIds.includes(id))throw Error('运行中的任务不能删除')
  if(q.tasks.some(t=>t.id===id&&UNRESOLVED.includes(t.status)))throw Error('请先处置异常任务，不能删除证据')
  return {...q,tasks:q.tasks.filter(t=>t.id!==id)}
}
export function move(q:QueueState,id:string,offset:-1|1):QueueState{
  const tasks=[...q.tasks],i=tasks.findIndex(t=>t.id===id)
  if(i<0||tasks[i]?.status!=='pending')return q
  let j=i+offset
  while(j>=0&&j<tasks.length&&tasks[j]?.status!=='pending')j+=offset
  if(j<0||j>=tasks.length)return q
  ;[tasks[i],tasks[j]]=[tasks[j]!,tasks[i]!]
  return {...q,tasks}
}
export function setConcurrency(q:QueueState,maxConcurrent:number):QueueState{
  if(!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>8)throw Error('并发任务数必须是 1–8 的整数')
  return {...q,maxConcurrent}
}
export function next(q:QueueState):Task|undefined{
  if(!q.enabled||q.activeIds.length>=q.maxConcurrent||q.tasks.some(t=>UNRESOLVED.includes(t.status)))return
  return q.tasks.find(t=>t.status==='pending'&&t.source!=='discovered')
}
export function claim(q:QueueState,id:string,now=Date.now()):QueueState{
  if(next(q)?.id!==id)throw Error('任务不在可调度队首或并发容量已满')
  return withActive({...q,tasks:q.tasks.map(t=>t.id===id?{...t,status:'starting',updatedAt:now}:t)},[...q.activeIds,id])
}
export function updateActive(q:QueueState,id:string,patch:Partial<Task>,now=Date.now()):QueueState{
  if(!q.activeIds.includes(id))throw Error('当前任务执行权已经失效')
  const forbidden=['id','workspaceId','prompt','goalMode','createdAt','source','sessionId']
  if(forbidden.some(k=>Object.prototype.hasOwnProperty.call(patch,k)))throw Error('不允许修改执行中任务身份')
  const {status,...rest}=patch
  if(status!==undefined&&!['running','completed','blocked','failed','interrupted'].includes(status))throw Error('非法任务状态')
  const terminal=status!==undefined&&['completed','blocked','failed','interrupted'].includes(status)
  const ids=terminal?q.activeIds.filter(x=>x!==id):q.activeIds
  return withActive({...q,
    enabled:status&&UNRESOLVED.includes(status)?false:q.enabled,
    error:status&&UNRESOLVED.includes(status)?(patch.detail||status):q.error,
    tasks:q.tasks.map(t=>t.id===id?{...t,...rest,...(status?{status}:{}),updatedAt:now}:t)
  },ids)
}
export function setSessionId(q:QueueState,id:string,sessionId:string):QueueState{
  if(!q.activeIds.includes(id))throw Error('当前任务执行权已失效')
  if(q.tasks.some(t=>t.id!==id&&t.sessionId===sessionId))throw Error('Session 已归属另一任务')
  return {...q,tasks:q.tasks.map(t=>t.id===id?{...t,sessionId,updatedAt:Date.now()}:t)}
}
export function recover(q:QueueState,reason='应用重新启动，旧会话等待核实'):QueueState{
  if(!q.enabled&&!q.activeIds.length)return q
  const affected=new Set(q.activeIds)
  return withActive({...q,enabled:false,error:affected.size?reason:q.error,
    tasks:q.tasks.map(t=>affected.has(t.id)?{...t,status:'interrupted',detail:reason,updatedAt:Date.now()}:t)
  },[])
}
/** Adopt only a Host-confirmed *currently running* Session; never submit another prompt. */
export function adopt(q:QueueState,data:{sessionId:string;workspaceId:string;title:string;goalMode:boolean;goalId?:string;prompt?:string},id:string,now=Date.now()):QueueState{
  const current=q.tasks.find(t=>t.sessionId===data.sessionId)
  if(current){
    if(current.status==='running'||current.status==='starting')return q
    if(current.status!=='interrupted')return q
    const ids=[...q.activeIds,current.id]
    return withActive({...q,tasks:q.tasks.map(t=>t.id===current.id?{
      ...t,status:'running',detail:'已重新关联仍在运行的原 Session；队列保持暂停',
      goalId:data.goalId??t.goalId,seenRunning:true,updatedAt:now
    }:t)},ids)
  }
  if(q.tasks.some(t=>t.id===id))throw Error('任务 ID 重复')
  return withActive({...q,tasks:[...q.tasks,{
    id,sessionId:data.sessionId,workspaceId:data.workspaceId,title:data.title,
    prompt:data.prompt??'',goalMode:data.goalMode,goalId:data.goalId,source:'discovered',
    status:'running',seenRunning:true,detail:'发现已有运行 Session；仅观察，不重复执行',
    createdAt:now,updatedAt:now
  }]},[...q.activeIds,id])
}
export function updateTitle(q:QueueState,id:string,title:string):QueueState{
  if(!title.trim())return q
  return {...q,tasks:q.tasks.map(t=>t.id===id?{...t,title:title.trim(),updatedAt:Date.now()}:t)}
}
export function retry(q:QueueState,id:string):QueueState{
  if(q.activeIds.includes(id))throw Error('不能重新派发仍在运行的任务')
  return {...q,tasks:q.tasks.map(t=>t.id===id&&UNRESOLVED.includes(t.status)?{
    ...t,status:'pending',source:'queue',sessionId:undefined,goalId:undefined,seenRunning:false,
    detail:'重新排队会创建新 Session，请先确认旧 Session 已停止',updatedAt:Date.now()
  }:t)}
}
export function skip(q:QueueState,id:string):QueueState{
  if(q.activeIds.includes(id))throw Error('运行任务不能跳过')
  return {...q,tasks:q.tasks.map(t=>t.id===id&&UNRESOLVED.includes(t.status)?{
    ...t,status:'skipped',detail:'用户确认跳过；不代表执行完成',updatedAt:Date.now()
  }:t)}
}
