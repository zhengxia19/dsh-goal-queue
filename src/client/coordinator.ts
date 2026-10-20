/** Client-owned queue scheduler; never replays an unknown remote command. */
import type { ISessions, SessionFace, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { QueueSettingsSource } from './settings.ts'
import { observeTask } from './observe-task.ts'
import { UNRESOLVED,add,adopt,claim,decode,edit,move,next,recover,remove,retry,
  setConcurrency,setSessionId,skip,updateActive,updateTitle,releaseUnsubmittedClaim,type QueueState,type Task,type TaskInput } from '../queue.ts'
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { goalQueue: unknown }
}
interface Active {
  taskId:string; epoch:number; session:SessionFace; reference:SessionReference
  subscriptions:(()=>void)[]
}
const err=(e:unknown)=>e instanceof Error?e.message:String(e)
export class Coordinator {
  private chain:Promise<void>=Promise.resolve()
  private live=new Map<string,Active>()
  private observing=new Set<string>()
  private observeAgain=new Set<string>()
  private checking=false
  private repump=false
  private closed=false
  private booted=false
  /** A trusted Host Session scan is required before first dispatch in Desktop. */
  private discovered=false
  private scanning:Promise<number>|undefined
  private armed=false
  private controlIntent=0
  private epoch=0
  private readonly disposers:(()=>void)[]=[]
  private readonly sessions:ISessions
  private readonly workspaces:IWorkspaces
  private readonly settings:QueueSettingsSource
  private readonly connected:()=>boolean
  private readonly openSession?: (id:SessionId)=>void
  constructor(
    sessions:ISessions,workspaces:IWorkspaces,settings:QueueSettingsSource,
    connected:()=>boolean,openSession?:(id:SessionId)=>void
  ){
    this.sessions=sessions;this.workspaces=workspaces;this.settings=settings
    this.connected=connected;this.openSession=openSession
  }
  start():void {
    this.disposers.push(this.settings.subscribe(()=>{
      void this.pump()
      if(this.settings.getSnapshot().status==='ready')
        for(const id of this.live.keys())void this.observe(id)
    }))
    // Session titles are owned by DSH; never rename automatically or issue a synthetic prompt.
    if(this.sessions.list)this.disposers.push(this.sessions.list.subscribe(()=>{
      void this.syncTitles()
    }))
    void this.pump()
  }
  async connectionReset():Promise<void>{
    if(this.closed)return
    this.armed=false;this.controlIntent++;this.epoch++;this.releaseAll()
    this.booted=false;this.discovered=false;void this.pump()
  }
  dispose():void{
    this.closed=true;this.armed=false;this.controlIntent++;this.epoch++
    this.releaseAll();this.discovered=false;for(const stop of this.disposers.splice(0))stop()
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
    this.armed=false;this.controlIntent++;this.booted=false
    this.settings.failClosed(reason)
    this.releaseAll()
  }
  add(input:TaskInput):Promise<void>{
    return this.write(q=>add(q,input,crypto.randomUUID()))
  }
  edit(id:string,input:TaskInput):Promise<void>{
    return this.write(q=>edit(q,id,input))
  }
  remove(id:string):Promise<void>{return this.write(q=>remove(q,id))}
  move(id:string,offset:-1|1):Promise<void>{return this.write(q=>move(q,id,offset))}
  retry(id:string):Promise<void>{return this.write(q=>retry(q,id))}
  skip(id:string):Promise<void>{return this.write(q=>skip(q,id))}
  setConcurrency(limit:number):Promise<void>{return this.write(q=>setConcurrency(q,limit))}
  open(id:string):void{
    const sessionId=this.queue().tasks.find(t=>t.id===id)?.sessionId
    if(sessionId)this.openSession?.(sessionId as SessionId)
  }
  async enable(enabled:boolean):Promise<void>{
    const intent=++this.controlIntent
    if(!enabled)this.armed=false
    const generation=this.epoch
    await this.write(q=>{
      if(intent!==this.controlIntent)return q
      if(!this.booted||!this.connected()||generation!==this.epoch)throw Error('连接或恢复未就绪')
      if(enabled&&this.sessions.list&&!this.discovered)throw Error('请先打开队列完成当前 DPH Session 扫描，再启动队列')
      if(enabled&&q.tasks.some(t=>UNRESOLVED.includes(t.status)))
        throw Error('存在未确认的历史任务，请先检查原 Session 并处置')
      return {...q,enabled,error:enabled?'':q.error}
    })
    if(enabled&&intent===this.controlIntent){
      if(this.closed||generation!==this.epoch||!this.connected()||!this.booted)
        throw Error('连接已切换；请重新手工启用')
      this.armed=true;void this.pump()
    }
  }
  private async pump():Promise<void>{
    if(this.closed)return
    if(this.checking){this.repump=true;return}
    this.checking=true
    try{
      if(this.settings.getSnapshot().status!=='ready')return
      if(!this.booted){
        this.armed=false
        this.discovered=false
        await this.write(q=>recover(q,'程序启动或连接切换；检查旧 Session 后手工激活队列'))
        this.booted=true
        return
      }
      if(!this.armed||!this.connected()||(this.sessions.list&&!this.discovered))return
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
        await this.dispatch(task)
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
  private async dispatch(task:Task):Promise<void>{
    const generation=this.epoch
    let created=false,submitted=false
    try{
      const workspace=this.workspaces.list.getSnapshot().items.find(w=>w.workspaceId===task.workspaceId)
      if(!workspace)throw Error('工作区已删除')
      const sessionId=await this.sessions.create({workspaceId:workspace.workspaceId})
      created=true
      if(generation!==this.epoch||this.closed)return
      await this.write(q=>setSessionId(q,task.id,sessionId))
      const held=await this.hold(task.id,sessionId,generation)
      if(generation!==this.epoch||this.closed){this.release(task.id);return}
      // Optional tool-free auxiliary LLM title request. It never submits a user prompt
      // to the task Session; a title failure must not silently replay or cancel the task.
      if(task.generateTitle){
        try {
          const result=await held.session.command('/goal-queue-title '+JSON.stringify({
            maxChars:task.titleMaxChars??24,prompt:task.prompt
          }))
          if(!result.ok)throw Error(result.error.message)
          if(!result.value.matched)throw Error('Host 未安装模型标题生成命令')
        } catch(e) {
          console.warn('[goal-queue] optional AI title generation failed; task proceeds normally:',err(e))
          await this.write(q=>q.activeIds.includes(task.id)
            ?updateActive(q,task.id,{detail:'模型标题生成失败：'+err(e)+'；任务继续正常派发'}):q)
        }
      }
      if(generation!==this.epoch||this.closed||!this.connected()){this.release(task.id);return}
      if(task.goalMode){
        submitted=true
        const response=await held.session.command('/goal '+task.prompt.replace(/\s+/g,' ').trim())
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
      this.armed=false
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
  private releaseAll():void{for(const id of [...this.live.keys()])this.release(id)}
  private async fail(id:string,status:'failed'|'blocked'|'interrupted',detail:string):Promise<void>{
    this.armed=false
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
      this.armed=false
      if(this.live.has(id)){
        try{await this.fail(id,'interrupted',err(e))}
        catch(p){this.quarantine('Session 状态写入失败：'+err(p))}
      }
    }finally{
      this.observing.delete(id)
      if(this.observeAgain.delete(id))queueMicrotask(()=>{void this.observe(id)})
    }
  }
  /** Concurrent refresh clicks share one discovery pass. */
  discover():Promise<number>{
    if(this.scanning)return this.scanning
    const pending=this.scanRunning()
    this.scanning=pending
    void pending.then(()=>{if(this.scanning===pending)this.scanning=undefined},()=>{if(this.scanning===pending)this.scanning=undefined})
    return pending
  }
  /** Discover at UI open. A discovery only observes; it never submits a model command. */
  private async scanRunning():Promise<number>{
    if(!this.connected()||!this.booted||this.settings.getSnapshot().status!=='ready')
      throw Error('Host 尚未就绪')
    const generation=this.epoch
    this.discovered=false
    await this.sessions.refresh()
    if(generation!==this.epoch||!this.connected())throw Error('扫描期间连接已切换，重新打开队列再试')
    const snapshot=this.sessions.list.getSnapshot()
    if(snapshot.phase!=='ready')throw Error('DSH Session 列表尚未读取完成，拒绝以空列表代替')
    let found=0
    for(const id of snapshot.ids){
      if(this.closed||!this.connected()||generation!==this.epoch)throw Error('扫描过程中连接已断开，请重新检查 Session')
      const row=snapshot.byId[id]
      if(!row||!row.running||row.origin==='subagent')continue
      const old=this.queue().tasks.find(t=>t.sessionId===id)
      if(old&&!['interrupted','running','starting'].includes(old.status))continue
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
      const taskId=old?.id??crypto.randomUUID()
      await this.write(q=>adopt(q,{
        sessionId:id,workspaceId:workspace?.workspaceId??'',title:row.title??'',
        goalMode:old?.goalMode??Boolean(goal),goalId:goal?.id,prompt:old?.prompt??goal?.objective??''
      },taskId))
      if(!this.live.has(taskId)){
        try{await this.hold(taskId,id,generation)}catch(e){
          await this.fail(taskId,'interrupted','无法重新连接旧 Session：'+err(e));continue
        }
        void this.observe(taskId)
      }
      found++
    }
    await this.syncTitles()
    if(generation!==this.epoch||this.closed)throw Error('连接已切换，扫描结果无效')
    this.discovered=true
    void this.pump()
    return found
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
    if(!task||task.status!=='interrupted'||!task.goalMode||!task.sessionId)
      throw Error('只有已中断且保留原 Session 的 Goal 可以激活')
    if(this.queue().activeIds.length>=this.queue().maxConcurrent)
      throw Error('当前并发名额已满')
    const ref=this.sessions.retain(task.sessionId as SessionId,{source:'goalQueue'})
    try{
      await ref.ready
      const raw=ref.binding.session.projections.faceOf('goal').getSnapshot()
      const goal=raw&&typeof raw==='object'&&'goal' in raw
        ?(raw as {goal?:{id:string;phase:string}}).goal:undefined
      if(!goal||!['active','paused','blocked'].includes(goal.phase))
        throw Error('原 Session 中没有可恢复的 Goal')
      if(ref.binding.session.getSnapshot().running)
        throw Error('原 Session 正在运行，请使用“刷新运行任务”重新关联，不要重复恢复')
      // Persist ownership before command; an uncertain command response prevents second dispatch.
      await this.write(q=>adopt(q,{
        sessionId:task.sessionId!,workspaceId:task.workspaceId,title:task.title,
        goalMode:true,goalId:goal.id,prompt:task.prompt
      },task.id))
      await this.hold(id,task.sessionId as SessionId)
      const response=await ref.binding.session.command('/goal resume')
      if(!response.ok||!response.value.matched)throw Error('Goal 恢复命令未被接受')
      void this.observe(id)
    }catch(e){
      try{await this.fail(id,'interrupted','恢复状态不确定：'+err(e))}
      catch(p){this.quarantine('无法保存 Goal 恢复异常：'+err(p))}
      throw e
    }finally{ref.release()}
  }
}
