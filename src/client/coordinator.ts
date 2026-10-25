/** Client-owned queue scheduler; never replays an unknown remote command. */
import type { ISessions, SessionFace, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { QueueSettingsSource } from './settings.ts'
import { observeTask } from './observe-task.ts'
import { confirmTaskModel, type TaskModels } from './models.ts'
import { resolveTaskModel, sameModel } from '../model-policy.ts'
import { QueueError } from '../errors.ts'
import type { SessionDirectory, DirectorySnapshot } from './directory.ts'
import { UNRESOLVED,add,adopt,claim,decode,edit,flagForReview,move,next,recover,remove,retry,
  setConcurrency,setSessionId,setTaskModel,skip,updateActive,updateTitle,releaseUnsubmittedClaim,claimGoalResume,trackSessionActivity,releaseSessionActivity,type QueueState,type Task,type TaskInput } from '../queue.ts'
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { goalQueue: unknown }
}
interface Active {
  taskId:string; epoch:number; session:SessionFace; reference:SessionReference
  subscriptions:(()=>void)[]
}
const err=(e:unknown)=>e instanceof Error?e.message:String(e)
/** Freshness of the trusted running-Session baseline (design §6.2, U03). */
export type SyncState =
  | {state:'initializing'}
  | {state:'scanning';startedAt:number}
  | {state:'fresh';syncedAt:number}
  | {state:'failed';reason:string;failedAt:number}
/** Sorted signature of running non-subagent Session ids in one trusted snapshot. */
const rowSignature=(rows:readonly {sessionId:string;running:boolean;origin?:string}[]):string=>
  rows.filter(r=>r.running&&r.origin!=='subagent').map(r=>r.sessionId).sort().join(',')
export class Coordinator {
  private chain:Promise<void>=Promise.resolve()
  private live=new Map<string,Active>()
  private detachedActivity=new Map<string,{reference:SessionReference;stop:()=>void}>()
  private observing=new Set<string>()
  private observeAgain=new Set<string>()
  private checking=false
  private repump=false
  private closed=false
  private booted=false
  /** A trusted Session-directory read is required before first dispatch (U02). */
  private directoryFresh=false
  private scanning:Promise<void>|undefined
  private armed=false
  // U03: discovery is scheduled by boot + list-change observation, never only by UI open.
  private syncState:SyncState={state:'initializing'}
  private runningSignature=''
  private discoveryQueued=false
  private bootedWaiters:(()=>void)[]=[]
  private readonly syncListeners=new Set<()=>void>()
  getSyncState():SyncState{return this.syncState}
  subscribeSync(listener:()=>void):()=>void{
    this.syncListeners.add(listener)
    return ()=>{this.syncListeners.delete(listener)}
  }
  private setSyncState(next:SyncState):void{
    this.syncState=next
    for(const listener of this.syncListeners)listener()
  }
  private readonly authorizationListeners=new Set<()=>void>()
  isAuthorized():boolean{return this.armed}
  subscribeAuthorization(listener:()=>void):()=>void{
    this.authorizationListeners.add(listener)
    return ()=>{this.authorizationListeners.delete(listener)}
  }
  private setArmed(value:boolean):void{
    if(this.armed===value)return
    this.armed=value
    for(const listener of this.authorizationListeners)listener()
  }
  private controlIntent=0
  private epoch=0
  private readonly disposers:(()=>void)[]=[]
  private readonly sessions:ISessions
  private readonly workspaces:IWorkspaces
  private readonly settings:QueueSettingsSource
  private readonly connected:()=>boolean
  private readonly openSession?: (id:SessionId)=>void
  private readonly models?:TaskModels
  private readonly directory?:SessionDirectory
  constructor(
    sessions:ISessions,workspaces:IWorkspaces,settings:QueueSettingsSource,
    connected:()=>boolean,openSession?:(id:SessionId)=>void,models?:TaskModels,directory?:SessionDirectory
  ){
    this.sessions=sessions;this.workspaces=workspaces;this.settings=settings
    this.connected=connected;this.openSession=openSession
    this.models=models;this.directory=directory
  }
  start():void {
    this.disposers.push(this.settings.subscribe(()=>{
      if(this.settings.getSnapshot().status!=='ready'){
        this.setArmed(false)
        this.controlIntent++
      }
      void this.pump()
      if(this.settings.getSnapshot().status==='ready'){
        if(this.booted)for(const waiter of this.bootedWaiters.splice(0))waiter()
        for(const id of this.live.keys())void this.observe(id)
      }
    }))
    // Session titles are owned by DSH; never rename automatically or issue a synthetic prompt.
    // U03: the same event also compares the running signature so new Sessions are discovered
    // without opening the panel (R01).
    if(this.sessions.list)this.disposers.push(this.sessions.list.subscribe(()=>{
      void this.syncTitles()
      this.handleListChange()
    }))
    void this.pump()
  }
  async connectionReset():Promise<void>{
    if(this.closed)return
    this.setArmed(false);this.controlIntent++;this.epoch++;this.releaseAll()
    this.booted=false;this.directoryFresh=false;this.runningSignature='';this.discoveryQueued=false
    this.setSyncState({state:'initializing'})
    void this.pump()
  }
  dispose():void{
    this.closed=true;this.setArmed(false);this.controlIntent++;this.epoch++
    this.releaseAll();this.directoryFresh=false;this.runningSignature='';this.discoveryQueued=false
    for(const waiter of this.bootedWaiters.splice(0))waiter()
    for(const stop of this.disposers.splice(0))stop()
  }
  private queue():QueueState {
    const snapshot=this.settings.getSnapshot()
    if(snapshot.status!=='ready')throw Error(snapshot.error??'Host 配置未加载')
    const decoded=decode(snapshot.value)
    if(!decoded)throw Error('Host 队列格式无效，不能继续调度')
    return decoded.queue
  }
  private write(fn:(q:QueueState)=>QueueState):Promise<void>{
    const op=this.chain.catch(()=>{}).then(async()=>{
      if(this.closed)return
      const prev=this.queue(),updated=fn(prev)
      if(updated!==prev)await this.settings.set('queue',updated)
    })
    this.chain=op.catch(()=>{})
    return op
  }
  private quarantine(reason:string):void{
    this.setArmed(false);this.controlIntent++;this.booted=false
    this.settings.failClosed(reason)
    this.releaseAll()
  }
  add(input:TaskInput):Promise<void>{
    return this.saveInput(input,normalized=>this.write(q=>add(q,normalized,crypto.randomUUID())))
  }
  edit(id:string,input:TaskInput):Promise<void>{
    return this.saveInput(input,normalized=>this.write(q=>edit(q,id,normalized)))
  }
  private async saveInput(input:TaskInput,save:(input:TaskInput)=>Promise<void>):Promise<void>{
    if(!this.models)throw Error('Host 模型服务不可用')
    const generation=this.epoch
    const catalog=await this.models.catalog()
    const modelSelection=input.modelSelection?resolveTaskModel(catalog,input.modelSelection):undefined
    if(generation!==this.epoch||!this.connected()||this.closed)throw Error('连接已切换，请重新选择模型')
    await save({...input,modelSelection})
  }
  remove(id:string):Promise<void>{return this.write(q=>remove(q,id))}
  move(id:string,offset:-1|1):Promise<void>{return this.write(q=>move(q,id,offset))}
  /** Inspect the original Host Session immediately before an irreversible disposition. */
  private async disposeAbnormal(id:string,action:'retry'|'skip'):Promise<void>{
    const task=this.queue().tasks.find(t=>t.id===id)
    if(!task||!UNRESOLVED.includes(task.status))throw Error('任务已经处置或状态已变化')
    if(!this.connected())throw Error('Host 未连接，无法核实原 Session')
    if(!task.sessionId){
      if(action==='retry')throw Error('原 Session ID 缺失，无法确认是否已执行；请检查工作区并人工跳过后重新创建任务')
      // Explicit UI confirmation is required; preserve that no Host evidence was available.
      return this.write(q=>{
        const result=skip(q,id)
        return {...result,tasks:result.tasks.map(t=>t.id===id
          ?{...t,detail:'用户人工跳过（原 Session ID 缺失，未能验证旧操作是否执行）'}:t)}
      })
    }
    const generation=this.epoch
    const ref=this.sessions.retain(task.sessionId as SessionId,{source:'goalQueue'})
    try{
      await ref.ready
      if(generation!==this.epoch||!this.connected())throw Error('连接切换，原 Session 状态不可核实')
      const current=ref.binding.session.getSnapshot()
      if(current.running)throw Error('原 Session '+task.sessionId+' 仍在运行，不能重新排队或跳过')
      await this.write(q=>{
        if(generation!==this.epoch||!this.connected()||ref.binding.session.getSnapshot().running)
          throw Error('原 Session 状态已经改变，请重新检查')
        if(q.tasks.find(t=>t.id===id)?.sessionId!==task.sessionId)
          throw Error('任务对应的 Session 已改变，拒绝处置')
        return action==='retry'?retry(q,id):skip(q,id)
      })
    }finally{ref.release()}
  }
  retry(id:string):Promise<void>{return this.disposeAbnormal(id,'retry')}
  skip(id:string):Promise<void>{return this.disposeAbnormal(id,'skip')}
  setConcurrency(limit:number):Promise<void>{return this.write(q=>setConcurrency(q,limit))}
  open(id:string):void{
    const sessionId=this.queue().tasks.find(t=>t.id===id)?.sessionId
    if(sessionId)this.openSession?.(sessionId as SessionId)
  }
  openAttempt(id:string,attemptId:string):void{
    const attempt=this.queue().tasks.find(t=>t.id===id)?.attempts?.find(a=>a.id===attemptId)
    if(attempt?.sessionId)this.openSession?.(attempt.sessionId as SessionId)
  }
  /** U04: open a tracked external Session by id; existence is checked against the trusted directory. */
  async openSessionById(sessionId:string):Promise<void>{
    if(this.directory){
      const snapshot=await this.directory.list()
      if(!snapshot.rows.some(r=>r.sessionId===sessionId))
        throw new QueueError('SESSION_NOT_FOUND','会话已不存在')
    }
    this.openSession?.(sessionId as SessionId)
  }
  async enable(enabled:boolean):Promise<void>{
    const intent=++this.controlIntent
    if(!enabled)this.setArmed(false)
    const generation=this.epoch
    await this.write(q=>{
      if(intent!==this.controlIntent)return q
      if(!this.booted||!this.connected()||generation!==this.epoch)throw Error('连接或恢复未就绪')
      if(enabled&&this.directory&&!this.directoryFresh)throw Error('可信的 DPH Session 运行扫描尚未完成，请先刷新运行任务再启动队列')
      if(enabled&&q.tasks.some(t=>UNRESOLVED.includes(t.status)))
        throw Error('存在未确认的历史任务，请先检查原 Session 并处置')
      return {...q,enabled,error:enabled?'':q.error}
    })
    if(enabled&&intent===this.controlIntent){
      if(this.closed||generation!==this.epoch||!this.connected()||!this.booted)
        throw Error('连接已切换；请重新手工启用')
      this.setArmed(true);void this.pump()
    }
  }
  private async pump():Promise<void>{
    if(this.closed)return
    if(this.checking){this.repump=true;return}
    this.checking=true
    try{
      if(this.settings.getSnapshot().status!=='ready')return
      if(!this.booted){
        this.setArmed(false)
        this.directoryFresh=false
        await this.write(q=>recover(q,'程序启动或连接切换；检查旧 Session 后手工激活队列'))
        this.booted=true
        for(const waiter of this.bootedWaiters.splice(0))waiter()
        // U03: the first read-only discovery is scheduled by boot itself, not by opening the panel.
        this.scheduleDiscovery()
        return
      }
      if(!this.armed||!this.connected()||(this.directory&&!this.directoryFresh))return
      // Sequentially reserve each available slot before submitting external work.
      while(this.armed&&!this.closed&&this.connected()){
        const task=next(this.queue())
        if(!task)break
        const generation=this.epoch
        const authorization=this.controlIntent
        await this.write(q=>claim(q,task.id))
        if(generation!==this.epoch||this.closed||!this.armed||!this.connected()
          ||authorization!==this.controlIntent){
          await this.write(q=>releaseUnsubmittedClaim(q,task.id))
          break
        }
        await this.dispatch(task,authorization)
      }
    }catch(e){
      console.error('[goal-queue] unsafe dispatch',e)
      this.quarantine('调度状态不确定，已停止派发：'+err(e))
    }finally{
      this.checking=false
      if(this.repump){this.repump=false;queueMicrotask(()=>{void this.pump()})}
    }
  }
  private async hold(id:string,sessionId:SessionId,expectedEpoch=this.epoch):Promise<Active>{
    const reference=this.sessions.retain(sessionId,{source:'goalQueue'})
    try{await reference.ready}catch(e){reference.release();throw e}
    if(this.closed||expectedEpoch!==this.epoch){reference.release();throw Error('Client 连接已切换，放弃旧 Session 引用')}
    const session=reference.binding.session
    const held:Active={taskId:id,epoch:this.epoch,session,reference,subscriptions:[]}
    this.live.set(id,held)
    held.subscriptions.push(session.subscribe(()=>{void this.observe(id)}))
    held.subscriptions.push(session.projections.faceOf('goal').subscribe(()=>{void this.observe(id)}))
    return held
  }
  private async dispatch(task:Task,authorization:number):Promise<void>{
    const generation=this.epoch
    let created=false,submitted=false
    const revoked=()=>authorization!==this.controlIntent||!this.armed||!this.connected()
    const abandon=async():Promise<boolean>=>{
      if(generation!==this.epoch||this.closed){this.release(task.id);return true}
      if(!revoked())return false
      // Remote Session may exist. Preserve its ID and stop, never return it to pending.
      await this.fail(task.id,'interrupted',
        '暂停或连接状态已变更；新 Session 已创建但任务执行命令未提交，请检查原会话')
      return true
    }
    try{
      const workspace=this.workspaces.list.getSnapshot().items.find(w=>w.workspaceId===task.workspaceId)
      if(!workspace)throw Error('工作区已删除')
      if(!this.models)throw Error('Host 模型服务不可用')
      const modelSelection=resolveTaskModel(await this.models.catalog(),task.modelSelection)
      if(generation!==this.epoch||this.closed||!this.connected())return
      await this.write(q=>setTaskModel(q,task.id,modelSelection))
      if(generation!==this.epoch||this.closed||!this.connected())return
      const sessionId=await this.sessions.create({workspaceId:workspace.workspaceId})
      created=true
      if(generation!==this.epoch||this.closed)return
      await this.write(q=>setSessionId(q,task.id,sessionId))
      const held=await this.hold(task.id,sessionId,generation)
      if(await abandon())return
      const selected=await this.models.select(sessionId,modelSelection)
      if(!sameModel(selected,modelSelection))throw Error('Host 接受的模型配置与任务选择不一致')
      await confirmTaskModel(held.session,modelSelection,()=>generation===this.epoch&&!this.closed&&this.connected())
      // Optional tool-free auxiliary LLM title request. It never submits a user prompt
      // to the task Session; a title failure must not silently replay or cancel the task.
      if(task.generateTitle){
        const result=await this.models.title(held.session,'/goal-queue-title '+JSON.stringify({
          maxChars:task.titleMaxChars??24,prompt:task.prompt,modelSelection
        }))
        const failure=result.matched?result.error:'Host 未安装模型标题生成命令'
        if(failure){
          console.warn('[goal-queue] optional AI title generation failed; task proceeds normally:',failure)
          // U05: the warning is bound to the task (archived into the attempt at the next
          // claim); it never touches q.error and never overwrites execution detail.
          await this.write(q=>q.activeIds.includes(task.id)
            ?updateActive(q,task.id,{titleError:'模型标题生成失败：'+failure}):q)
        }
      }
      if(await abandon())return
      // A manual model switch while the auxiliary call ran must not split title/task routing.
      const modelState=held.session.projections.faceOf('modelSelection').getSnapshot() as {next?:typeof modelSelection}|undefined
      if(!sameModel(modelState?.next,modelSelection))throw Error('任务提交前 Session 模型配置已变化，请人工核实')
      if(task.goalMode){
        submitted=true
        const response=await held.session.command('/goal '+task.prompt.trim())
        if(!response.ok)throw Error(response.error.message)
        if(!response.value.matched)throw Error('原生 /goal 命令不可用')
      }else{
        submitted=true
        const response=await held.session.prompt([{type:'text',text:task.prompt}],'queue')
        if(!response.ok)throw Error(response.error.message)
      }
      if(generation!==this.epoch||this.closed)return
      await this.write(q=>updateActive(q,task.id,{status:'running'}))
      await this.observe(task.id)
    }catch(e){
      this.setArmed(false)
      if(generation===this.epoch&&!this.closed){
        try{await this.fail(task.id,created?'interrupted':'failed',
          err(e)+'；'+(created?(submitted?'命令可能已提交':'Session 已创建'):'Session 创建未确认')+'，请手工核实')}
        catch(p){this.quarantine('任务失败状态保存失败：'+err(p))}
      }
    }
  }
  private release(id:string):void{
    const held=this.live.get(id);if(!held)return
    this.live.delete(id);for(const stop of held.subscriptions.splice(0))stop()
    held.reference.release()
  }
  private releaseDetached(id:string):void{
    const held=this.detachedActivity.get(id)
    if(!held)return
    this.detachedActivity.delete(id);held.stop();held.reference.release()
  }
  private releaseAll():void{
    for(const id of [...this.live.keys()])this.release(id)
    for(const id of [...this.detachedActivity.keys()])this.releaseDetached(id)
  }
  /** Watch reused old Sessions independently of their immutable task history. */
  private async trackDetached(id:string,generation:number):Promise<void>{
    if(this.detachedActivity.has(id))return
    const reference=this.sessions.retain(id as SessionId,{source:'goalQueue'})
    try{await reference.ready}catch(e){reference.release();throw e}
    if(generation!==this.epoch||this.closed||!this.connected()){
      reference.release();throw Error('连接变更，无法确认旧 Session')
    }
    const session=reference.binding.session
    if(!session.getSnapshot().running){reference.release();return}
    await this.write(q=>trackSessionActivity(q,id))
    if(generation!==this.epoch||this.closed){reference.release();return}
    const onStop=()=>{
      if(session.getSnapshot().running)return
      void this.write(q=>releaseSessionActivity(q,id)).then(()=>{
        this.releaseDetached(id);void this.pump()
      }).catch(e=>this.quarantine('旧 Session 活动状态写入失败：'+err(e)))
    }
    const stop=session.subscribe(onStop)
    this.detachedActivity.set(id,{reference,stop})
    onStop()
  }
  private async fail(id:string,status:'failed'|'blocked'|'interrupted',detail:string):Promise<void>{
    this.setArmed(false)
    await this.write(q=>q.activeIds.includes(id)?updateActive(q,id,{status,detail}):q)
    this.release(id)
  }
  private async observe(id:string):Promise<void>{
    if(this.closed||this.settings.getSnapshot().status!=='ready')return
    if(this.observing.has(id)){this.observeAgain.add(id);return}
    this.observing.add(id)
    try{
      const held=this.live.get(id)
      if(!held||held.epoch!==this.epoch)return
      const finished=await observeTask(held.session,{
        current:()=>this.queue().tasks.find(t=>t.id===id),
        update:async patch=>{await this.write(q=>updateActive(q,id,patch))},
        fail:async(status,detail)=>{await this.fail(id,status,detail)}
      })
      if(finished&&this.live.get(id)===held){
        this.release(id);void this.pump()
      }
    }catch(e){
      this.setArmed(false)
      if(this.live.has(id)){
        try{await this.fail(id,'interrupted',err(e))}
        catch(p){this.quarantine('Session 状态写入失败：'+err(p))}
      }
    }finally{
      this.observing.delete(id)
      if(this.observeAgain.delete(id))queueMicrotask(()=>{void this.observe(id)})
    }
  }
  /** Concurrent refresh clicks share one discovery pass; boot schedules the first one (U03). */
  discover():Promise<void>{
    if(this.closed)return Promise.resolve()
    if(!this.booted||this.settings.getSnapshot().status!=='ready'){
      // Pre-boot discovery is not an error: it waits for boot reconciliation, then runs.
      void this.pump()
      return this.whenBooted().then(()=>this.discover())
    }
    if(this.scanning){this.discoveryQueued=true;return this.scanning}
    const pending=this.scanRunning()
    const shared=pending.then(()=>undefined)
    this.scanning=shared
    const settle=()=>{
      if(this.scanning!==shared)return
      this.scanning=undefined
      // Changes observed mid-scan must not be lost: one merged follow-up pass.
      if(this.discoveryQueued){
        this.discoveryQueued=false
        void this.discover().catch(e=>console.warn('[goal-queue] queued discovery failed',e))
      }
    }
    void shared.then(settle,settle)
    return shared
  }
  /** Boot/list observation schedules discovery without opening the panel; failures land in syncState. */
  private scheduleDiscovery():void{
    if(this.closed||!this.booted||!this.connected())return
    void this.discover().catch(e=>console.warn('[goal-queue] scheduled discovery failed',e))
  }
  /** The Host running-set changed since the last trusted snapshot: trigger one merged discovery. */
  private handleListChange():void{
    if(this.closed||!this.sessions.list)return
    const state=this.sessions.list.getSnapshot()
    const signature=state.ids
      .filter(id=>{const row=state.byId[id];return row&&row.running&&row.origin!=='subagent'})
      .sort().join(',')
    if(signature===this.runningSignature)return
    this.scheduleDiscovery()
  }
  private whenBooted():Promise<void>{
    if(this.booted)return Promise.resolve()
    return new Promise<void>(resolve=>{this.bootedWaiters.push(resolve)})
  }
  /** One discovery pass; any failure disarms and marks the baseline failed (U02/U03). */
  private async scanRunning():Promise<void>{
    this.setSyncState({state:'scanning',startedAt:Date.now()})
    try{
      await this.runScan()
    }catch(e){
      this.setArmed(false)
      this.setSyncState({state:'failed',reason:err(e),failedAt:Date.now()})
      throw e
    }
  }
  /** Discovery only observes; it never submits a model command. */
  private async runScan():Promise<void>{
    if(!this.connected()||!this.booted||this.settings.getSnapshot().status!=='ready')
      throw Error('Host 尚未就绪')
    if(!this.directory)throw Error('Host 尚未就绪')
    const generation=this.epoch
    this.directoryFresh=false
    // U02: the directory read is the authoritative running baseline. A failed read disarms;
    // a later successful read refreshes the baseline but never re-arms (B1: no auto replay).
    let snapshot:DirectorySnapshot
    try{
      snapshot=await this.directory.list()
    }catch(e){
      throw e instanceof QueueError?e:new QueueError('DIRECTORY_READ_FAILED','无法读取运行会话列表：'+err(e))
    }
    if(generation!==this.epoch||!this.connected())throw Error('扫描期间连接已切换，重新打开队列再试')
    // Client-manager refresh only feeds titles/retain; its failure is best-effort degraded.
    try{await this.sessions.refresh()}catch(e){console.warn('[goal-queue] session refresh degraded',e)}
    if(generation!==this.epoch||!this.connected())throw Error('扫描期间连接已切换，重新打开队列再试')
    for(const row of snapshot.rows){
      const id=row.sessionId as SessionId
      if(this.closed||!this.connected()||generation!==this.epoch)throw Error('扫描过程中连接已断开，请重新检查 Session')
      if(!row.running||row.origin==='subagent')continue
      const snapshotQueue=this.queue()
      const old=snapshotQueue.tasks.find(t=>t.sessionId===id)
      const historic=snapshotQueue.tasks.some(t=>t.attempts?.some(a=>a.sessionId===id))
      if((old&&!['interrupted','running','starting'].includes(old.status))||(!old&&historic)){
        await this.trackDetached(id,generation)
        continue
      }
      if(old&&this.live.has(old.id))continue
      const workspaces=this.workspaces.list.getSnapshot().items
      const workspace=workspaces.find(w=>w.sessionIds.includes(id))
        ??workspaces.find(w=>w.path===row.cwd)
      // Read goal projection from the exact existing Session; never infer from a title.
      const reference=this.sessions.retain(id,{source:'goalQueue'})
      let projection:{goal?:{id:string;objective:string;phase:string}}|undefined
      try{
        await reference.ready
        const raw=reference.binding.session.projections.faceOf('goal').getSnapshot()
        if(raw&&typeof raw==='object')projection=raw as typeof projection
      }finally{reference.release()}
      if(generation!==this.epoch||this.closed)throw Error('连接已切换，不能沿用旧扫描结果')
      const goal=projection?.goal
      // U01 identity pre-check before adopt: an interrupted task is never adopted or settled
      // when another Goal owns the Session, or when no execution-boundary evidence exists.
      if(old&&old.status==='interrupted'){
        const mismatch=Boolean(old.goalId&&goal?.id&&old.goalId!==goal.id)
        if(!old.goalMode||mismatch){
          await this.trackDetached(id,generation)
          await this.write(q=>flagForReview(q,old.id,mismatch
            ?'同一会话正在运行其他 Goal（id 不符），原任务证据保留，请人工核实'
            :'原会话仍在运行，缺少本次执行边界证据，请人工核实'))
          continue
        }
      }
      const taskId=old?.id??crypto.randomUUID()
      await this.write(q=>adopt(q,{
        sessionId:id,workspaceId:workspace?.workspaceId??'',title:'',
        goalMode:old?.goalMode??Boolean(goal),goalId:goal?.id,prompt:old?.prompt??goal?.objective??''
      },taskId))
      if(!this.live.has(taskId)){
        try{await this.hold(taskId,id,generation)}catch(e){
          await this.fail(taskId,'interrupted','无法重新连接旧 Session：'+err(e));continue
        }
        void this.observe(taskId)
      }
    }
    await this.syncTitles()
    if(generation!==this.epoch||this.closed)throw Error('连接已切换，扫描结果无效')
    this.runningSignature=rowSignature(snapshot.rows)
    this.directoryFresh=true
    this.setSyncState({state:'fresh',syncedAt:Date.now()})
    void this.pump()
  }
  private async syncTitles():Promise<void>{
    if(this.closed||!this.sessions.list||this.settings.getSnapshot().status!=='ready')return
    const rows=this.sessions.list.getSnapshot().byId
    const updates=this.queue().tasks.filter(t=>t.sessionId&&rows[t.sessionId as SessionId]?.title && (!t.title || (t.generateTitle && rows[t.sessionId as SessionId]?.title!==t.title)))
    if(!updates.length)return
    try{
      await this.write(q=>{
        let out=q
        for(const task of updates){
          const title=task.sessionId?rows[task.sessionId as SessionId]?.title:undefined
          if(title&&out.tasks.find(t=>t.id===task.id&&(!t.title||(t.generateTitle&&t.title!==title))))out=updateTitle(out,task.id,title)
        }
        return out
      })
    }catch(e){console.warn('[goal-queue] title sync failed',e)}
  }
  /** Explicit user action; resumes only an existing Goal in its original Session. */
  async resumeGoal(id:string):Promise<void>{
    const task=this.queue().tasks.find(t=>t.id===id)
    if(!task||!['interrupted','blocked'].includes(task.status)||!task.goalMode||!task.sessionId)
      throw Error('只有已中断或阻塞且保留原 Session 的 Goal 可以继续')
    const generation=this.epoch
    const ref=this.sessions.retain(task.sessionId as SessionId,{source:'goalQueue'})
    let claimed=false
    try{
      await ref.ready
      if(generation!==this.epoch||!this.connected())throw Error('连接发生切换，拒绝恢复')
      const raw=ref.binding.session.projections.faceOf('goal').getSnapshot()
      const goal=raw&&typeof raw==='object'&&'goal' in raw
        ?(raw as {goal?:{id:string;phase:string}}).goal:undefined
      if(!goal||!['active','paused','blocked'].includes(goal.phase))
        throw Error('原 Session 中没有可恢复的 Goal')
      if(task.goalId&&task.goalId!==goal.id)throw Error('原 Goal ID 已改变，拒绝恢复')
      if(ref.binding.session.getSnapshot().running)
        throw Error('原 Session 正在运行，请刷新运行任务，勿重复恢复')
      await this.write(q=>claimGoalResume(q,id,goal.id))
      claimed=true
      if(generation!==this.epoch||!this.connected())throw Error('连接切换，恢复已隔离')
      await this.hold(id,task.sessionId as SessionId,generation)
      const response=await ref.binding.session.command('/goal resume')
      if(!response.ok||!response.value.matched)throw Error('Goal 恢复命令未被接受')
      await this.write(q=>updateActive(q,id,{status:'running',goalId:goal.id}))
      void this.observe(id)
    }catch(e){
      // A competing call that failed to obtain ownership must not interrupt
      // the first request's already claimed Session.
      if(claimed){
        try{await this.fail(id,'interrupted','恢复状态不确定：'+err(e))}
        catch(p){this.quarantine('无法保存 Goal 恢复异常：'+err(p))}
      }
      throw e
    }finally{ref.release()}
  }
}
