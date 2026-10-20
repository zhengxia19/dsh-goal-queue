/** Persisted queue domain. Existing v1 snapshots are upgraded without deleting tasks. */
export const VERSION = 1 as const
export type TaskStatus = 'pending'|'starting'|'running'|'completed'|'blocked'|'failed'|'interrupted'|'skipped'
export type TaskSource = 'queue'|'discovered'
export interface TaskAttempt {
  id:string; status:TaskStatus; sessionId?:string; goalId?:string;
  seenRunning?:boolean; detail?:string; createdAt:number; updatedAt:number
}
export interface Task {
  id: string; workspaceId: string; title: string; prompt: string; goalMode: boolean
  status: TaskStatus; source?: TaskSource; sessionId?: string; goalId?: string
  /** Opt-in, model-generated, tool-free title. */
  generateTitle?: boolean; titleMaxChars?: number
  seenRunning?: boolean; detail?: string; createdAt: number; updatedAt: number
  attempts?: TaskAttempt[]
}
export type TaskInput = Pick<Task,'title'|'workspaceId'|'prompt'|'goalMode'> & Partial<Pick<Task,'generateTitle'|'titleMaxChars'>>
export interface QueueState {
  enabled: boolean
  /** Legacy v1 key, retained for old config compatibility. New dispatch uses activeIds. */
  activeId: string|null
  activeIds: string[]
  /** Running Sessions from completed/older attempts; never task execution owners. */
  sessionActivity: string[]
  maxConcurrent: number
  tasks: Task[]
  error: string
}
export interface QueueSettings { version: 1; queue: QueueState }
export const EMPTY_QUEUE: QueueState = {enabled:false,activeId:null,activeIds:[],sessionActivity:[],maxConcurrent:1,tasks:[],error:''}
export const DEFAULT_SETTINGS: QueueSettings = {version:VERSION,queue:EMPTY_QUEUE}
export const UNRESOLVED: readonly TaskStatus[] = ['blocked','failed','interrupted']
export const STATES: readonly TaskStatus[] = ['pending','starting','running','completed','blocked','failed','interrupted','skipped']
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)
const active=(t:Task)=>t.status==='running'||t.status==='starting'
const legacy=(ids:string[])=>ids.length===1?ids[0]!:null
const withActive=(q:QueueState,ids:string[]):QueueState=>({...q,activeIds:ids,activeId:legacy(ids)})
function validAttempts(raw:unknown):raw is TaskAttempt[]{
  if(!Array.isArray(raw))return false
  const seen=new Set<string>()
  return raw.every(a=>{
    if(!object(a)||typeof a.id!=='string'||!a.id||seen.has(a.id)
      ||!STATES.includes(a.status as TaskStatus)
      ||typeof a.createdAt!=='number'||!Number.isFinite(a.createdAt)
      ||typeof a.updatedAt!=='number'||!Number.isFinite(a.updatedAt)
      ||(a.sessionId!==undefined&&typeof a.sessionId!=='string')
      ||(a.goalId!==undefined&&typeof a.goalId!=='string')
      ||(a.seenRunning!==undefined&&typeof a.seenRunning!=='boolean')
      ||(a.detail!==undefined&&typeof a.detail!=='string'))return false
    seen.add(a.id);return true
  })
}
/** Idempotently surface one legacy execution without deleting its Session identity. */
export function attemptsOf(t:Task):TaskAttempt[]{
  if(t.attempts!==undefined)return t.attempts
  if(t.status==='pending'&&!t.sessionId)return []
  return [{id:t.id+':attempt:1',status:t.status,sessionId:t.sessionId,goalId:t.goalId,
    seenRunning:t.seenRunning,detail:t.detail,createdAt:t.createdAt,updatedAt:t.updatedAt}]
}
function amendAttempt(t:Task,patch:Partial<Task>,now:number):Task{
  const attempts=attemptsOf(t)
  const out={...t,...patch,updatedAt:now}
  if(!attempts.length)return {...out,attempts}
  const last=attempts[attempts.length-1]!
  return {...out,attempts:[...attempts.slice(0,-1),{
    ...last,status:out.status,sessionId:out.sessionId,goalId:out.goalId,
    seenRunning:out.seenRunning,detail:out.detail,updatedAt:now
  }]}
}
export function decode(value:unknown):QueueSettings|undefined {
  if(!object(value)||value.version!==VERSION||!object(value.queue))return
  const q=value.queue
  if(typeof q.enabled!=='boolean'||typeof q.error!=='string'||!Array.isArray(q.tasks))return
  if(q.activeId!==undefined&&q.activeId!==null&&typeof q.activeId!=='string')return
  const max=q.maxConcurrent===undefined?1:q.maxConcurrent
  if(!Number.isInteger(max)||typeof max!=='number'||max<1||max>8)return
  const activities=q.sessionActivity===undefined?[]:q.sessionActivity
  if(!Array.isArray(activities)||activities.some(x=>typeof x!=='string'||!x)
    ||new Set(activities).size!==activities.length)return
  const tasks:Task[]=[],ids=new Set<string>(),sessionIds=new Set<string>()
  for(const raw of q.tasks){
    if(!object(raw)||typeof raw.id!=='string'||!raw.id||ids.has(raw.id)
      ||typeof raw.workspaceId!=='string'||typeof raw.title!=='string'||typeof raw.prompt!=='string'
      ||typeof raw.goalMode!=='boolean'||!STATES.includes(raw.status as TaskStatus)
      ||typeof raw.createdAt!=='number'||!Number.isFinite(raw.createdAt)
      ||typeof raw.updatedAt!=='number'||!Number.isFinite(raw.updatedAt)
      ||(raw.source!==undefined&&raw.source!=='queue'&&raw.source!=='discovered')
      ||(raw.generateTitle!==undefined&&typeof raw.generateTitle!=='boolean')
      ||(raw.titleMaxChars!==undefined&&(!Number.isInteger(raw.titleMaxChars)||typeof raw.titleMaxChars!=='number'||raw.titleMaxChars<8||raw.titleMaxChars>80))
      ||(raw.sessionId!==undefined&&typeof raw.sessionId!=='string')
      ||(raw.goalId!==undefined&&typeof raw.goalId!=='string')
      ||(raw.seenRunning!==undefined&&typeof raw.seenRunning!=='boolean')
      ||(raw.detail!==undefined&&typeof raw.detail!=='string')
      ||(raw.attempts!==undefined&&!validAttempts(raw.attempts)))return
    if(typeof raw.sessionId==='string'){
      if(sessionIds.has(raw.sessionId))return
      sessionIds.add(raw.sessionId)
    }
    ids.add(raw.id)
    const task=raw as unknown as Task
    tasks.push({...task,attempts:attemptsOf(task)})
  }
  const running=tasks.filter(active).map(t=>t.id)
  const slots=q.activeIds===undefined||(Array.isArray(q.activeIds)&&q.activeIds.length===0&&q.activeId)
    ?(q.activeId?[q.activeId]:running):q.activeIds
  if(!Array.isArray(slots)||slots.some(x=>typeof x!=='string')
    ||new Set(slots).size!==slots.length||slots.length!==running.length
    ||running.some(x=>!slots.includes(x)))return
  return {version:VERSION,queue:{
    enabled:q.enabled,activeId:legacy(slots),activeIds:[...slots],maxConcurrent:max,
    tasks,sessionActivity:[...activities],error:q.error
  }}
}
function titleOptions(input: TaskInput): Pick<Task, 'generateTitle'|'titleMaxChars'> {
  const max=input.titleMaxChars??24
  if(!Number.isInteger(max)||max<8||max>80)throw Error('模型标题长度必须是 8–80 的整数')
  return {generateTitle:input.generateTitle??false,titleMaxChars:max}
}
export function add(q:QueueState,input:TaskInput,id:string,now=Date.now()):QueueState{
  if(!input.workspaceId||!input.prompt.trim()||q.tasks.some(t=>t.id===id))throw Error('工作区和任务说明不能为空，任务 ID 必须唯一')
  const normalized = titleOptions(input)
  return {...q,tasks:[...q.tasks,{...input,...normalized,title:input.title.trim(),prompt:input.prompt.trim(),source:'queue',status:'pending',id,createdAt:now,updatedAt:now}]}
}
export function edit(q:QueueState,id:string,input:TaskInput,now=Date.now()):QueueState{
  if(!input.workspaceId||!input.prompt.trim())throw Error('工作区和任务说明不能为空')
  return {...q,tasks:q.tasks.map(t=>{
    if(t.id!==id)return t
    if(t.status!=='pending'||t.source==='discovered')throw Error('只允许编辑尚未执行的队列任务')
    return {...t,...input,...titleOptions(input),title:input.title.trim(),prompt:input.prompt.trim(),updatedAt:now}
  })}
}
export function remove(q:QueueState,id:string):QueueState{
  if(q.activeIds.includes(id))throw Error('运行中的任务不能删除')
  if(q.tasks.some(t=>t.id===id&&UNRESOLVED.includes(t.status)))throw Error('异常任务必须先检查原 Session 并进行人工处置，不能删除证据')
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
  if(!q.enabled||q.activeIds.length+q.sessionActivity.length>=q.maxConcurrent||q.tasks.some(t=>UNRESOLVED.includes(t.status)))return
  return q.tasks.find(t=>t.status==='pending'&&t.source!=='discovered')
}
/** A currently running Session is counted once, without reopening a completed task. */
export function trackSessionActivity(q:QueueState,sessionId:string):QueueState{
  if(q.tasks.some(t=>q.activeIds.includes(t.id)&&t.sessionId===sessionId))return q
  if(q.sessionActivity.includes(sessionId))return q
  return {...q,sessionActivity:[...q.sessionActivity,sessionId]}
}
export function releaseSessionActivity(q:QueueState,sessionId:string):QueueState{
  if(!q.sessionActivity.includes(sessionId))return q
  return {...q,sessionActivity:q.sessionActivity.filter(x=>x!==sessionId)}
}
export function claim(q:QueueState,id:string,now=Date.now()):QueueState{
  if(next(q)?.id!==id)throw Error('任务不在可调度队首或并发容量已满')
  return withActive({...q,tasks:q.tasks.map(t=>{
    if(t.id!==id)return t
    const attempts=attemptsOf(t)
    return {...t,status:'starting',updatedAt:now,attempts:[...attempts,{
      id:t.id+':attempt:'+(attempts.length+1),status:'starting' as const,
      createdAt:now,updatedAt:now
    }]}
  })},[...q.activeIds,id])
}
export function updateActive(q:QueueState,id:string,patch:Partial<Task>,now=Date.now()):QueueState{
  if(!q.activeIds.includes(id))throw Error('当前任务执行权已经失效')
  const forbidden=['id','workspaceId','title','prompt','goalMode','generateTitle','titleMaxChars','createdAt','source']
  if(forbidden.some(k=>Object.prototype.hasOwnProperty.call(patch,k)))throw Error('不允许修改执行中任务身份')
  if(patch.sessionId&&q.tasks.some(t=>t.id!==id&&t.sessionId===patch.sessionId))throw Error('Session 已归属其他任务')
  const {status,...rest}=patch
  if(status!==undefined&&!['running','completed','blocked','failed','interrupted'].includes(status))throw Error('非法任务状态')
  const terminal=status!==undefined&&['completed','blocked','failed','interrupted'].includes(status)
  const ids=terminal?q.activeIds.filter(x=>x!==id):q.activeIds
  return withActive({...q,
    enabled:status&&UNRESOLVED.includes(status)?false:q.enabled,
    error:status&&UNRESOLVED.includes(status)?(patch.detail||status):q.error,
    tasks:q.tasks.map(t=>t.id===id?amendAttempt(t,{...rest,...(status?{status}: {})},now):t)
  },ids)
}
/** Release a reserved slot only when no Session was created and no command submitted. */
export function releaseUnsubmittedClaim(q:QueueState,id:string):QueueState{
  const task=q.tasks.find(t=>t.id===id)
  if(!task||task.status!=='starting'||task.sessionId||!q.activeIds.includes(id))return q
  return withActive({...q,tasks:q.tasks.map(t=>{
    if(t.id!==id)return t
    const attempts=attemptsOf(t)
    // This reservation never reached a Session: discard its unsubmitted attempt.
    return {...t,status:'pending',updatedAt:Date.now(),
      attempts:attempts.at(-1)?.status==='starting'&&!attempts.at(-1)?.sessionId
        ?attempts.slice(0,-1):attempts}
  })},q.activeIds.filter(x=>x!==id))
}
export function setSessionId(q:QueueState,id:string,sessionId:string):QueueState{
  if(!q.activeIds.includes(id))throw Error('当前任务执行权已失效')
  if(q.tasks.some(t=>t.id!==id&&t.sessionId===sessionId))throw Error('Session 已归属另一任务')
  return {...q,tasks:q.tasks.map(t=>t.id===id?amendAttempt(t,{sessionId},Date.now()):t)}
}
export function recover(q:QueueState,reason='应用重新启动，旧会话等待核实'):QueueState{
  if(!q.enabled&&!q.activeIds.length&&!q.sessionActivity.length)return q
  const affected=new Set(q.activeIds)
  return withActive({...q,enabled:false,error:reason,sessionActivity:[],
    tasks:q.tasks.map(t=>affected.has(t.id)?amendAttempt(t,{status:'interrupted',detail:reason},Date.now()):t)
  },[])
}
/** Adopt only a Host-confirmed *currently running* Session; never submit another prompt. */
export function adopt(q:QueueState,data:{sessionId:string;workspaceId:string;title:string;goalMode:boolean;goalId?:string;prompt?:string},id:string,now=Date.now()):QueueState{
  const current=q.tasks.find(t=>t.sessionId===data.sessionId)
  if(current){
    if(current.status==='running'||current.status==='starting')return q
    if(current.status!=='interrupted')return q
    const ids=[...q.activeIds,current.id]
    return withActive({...q,tasks:q.tasks.map(t=>t.id===current.id
      ?amendAttempt(t,{status:'running',detail:'已重新关联仍在运行的原 Session；队列保持暂停',
        goalId:data.goalId??t.goalId,seenRunning:true},now):t)},ids)
  }
  if(q.tasks.some(t=>t.id===id))throw Error('任务 ID 重复')
  const task:Task={
    id,sessionId:data.sessionId,workspaceId:data.workspaceId,title:data.title,
    prompt:data.prompt??'',goalMode:data.goalMode,goalId:data.goalId,source:'discovered',
    status:'running',seenRunning:true,detail:'发现已有运行 Session；仅观察，不重复执行',
    createdAt:now,updatedAt:now
  }
  return withActive({...q,tasks:[...q.tasks,{...task,attempts:attemptsOf(task)}]},[...q.activeIds,id])
}
export function updateTitle(q:QueueState,id:string,title:string):QueueState{
  if(!title.trim())return q
  return {...q,tasks:q.tasks.map(t=>t.id===id?{...t,title:title.trim(),updatedAt:Date.now()}:t)}
}
/** Atomically reserve the original Session for exactly one explicit Goal resume. */
export function claimGoalResume(q:QueueState,id:string,goalId:string,now=Date.now()):QueueState{
  const task=q.tasks.find(t=>t.id===id)
  if(!task||!['interrupted','blocked'].includes(task.status)||!task.goalMode||!task.sessionId)
    throw Error('旧 Goal 状态已改变或不能恢复，请刷新')
  if(task.goalId&&task.goalId!==goalId)throw Error('原 Goal ID 已改变，拒绝恢复')
  if(q.activeIds.length+q.sessionActivity.length>=q.maxConcurrent)throw Error('当前并发名额已满')
  if(q.activeIds.includes(id))throw Error('该 Goal 已处于恢复过程')
  return withActive({...q,tasks:q.tasks.map(t=>t.id===id
    ?amendAttempt(t,{status:'starting',goalId,detail:'旧 Goal 恢复命令准备中'},now):t)},
    [...q.activeIds,id])
}
export function retry(q:QueueState,id:string):QueueState{
  if(q.activeIds.includes(id))throw Error('不能重新派发仍在运行的任务')
  const task=q.tasks.find(t=>t.id===id)
  if(task&&UNRESOLVED.includes(task.status)&&!task.prompt.trim())
    throw Error('导入的 Session 没有可复用的任务说明，不能重新派发；请人工跳过后新建任务')
  return {...q,tasks:q.tasks.map(t=>t.id===id&&UNRESOLVED.includes(t.status)?{
    ...t,attempts:attemptsOf(t),status:'pending',source:'queue',
    sessionId:undefined,goalId:undefined,seenRunning:false,
    detail:'重新排队会创建新 Session，请先确认旧 Session 已停止',updatedAt:Date.now()
  }:t)}
}
export function skip(q:QueueState,id:string):QueueState{
  if(q.activeIds.includes(id))throw Error('运行任务不能跳过')
  if(!q.tasks.some(t=>t.id===id&&UNRESOLVED.includes(t.status)))throw Error('只能手工跳过未处置的异常任务')
  return {...q,tasks:q.tasks.map(t=>t.id===id&&UNRESOLVED.includes(t.status)
    ?amendAttempt(t,{status:'skipped',detail:'用户确认跳过；不代表执行完成'},Date.now()):t)}
}
