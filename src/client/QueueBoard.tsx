/** Workspace-aware, reorderable single-lane queue. No second Session/Goal authority. */
import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { PropsStore, PropsHooks, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { QueueSettingsSource } from './settings.ts'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { DEFAULT_SETTINGS, UNRESOLVED, summarizeQueue, type Task } from '../queue.ts'
import { MAX_TITLE_INPUT_CHARS } from '../title-policy.ts'
import type { viewStore } from './store.ts'
import type { Coordinator } from './coordinator.ts'
import type { TaskInspection } from './inspection.ts'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import { resolveTaskModel, type TaskModelSelection } from '../model-policy.ts'
import { filterTaskRows, type TaskFilter } from './queue-view.ts'

type Ops = Pick<Coordinator, 'add' | 'edit' | 'remove' | 'move' | 'retry' | 'skip' | 'enable' | 'open' | 'discover' | 'resumeGoal' | 'isAuthorized' | 'subscribeAuthorization' | 'getSyncState' | 'subscribeSync' | 'openAttempt' | 'openSessionById' | 'inspect' | 'requeueEdited'> & {refresh: () => Promise<void>; modelCatalog: () => Promise<ModelCatalog>}
export type BoardProps = PropsStore<typeof viewStore> & PropsRuntime<'shell.overlay'> &
  PropsHooks<{queueSettings: QueueSettingsSource, workspaces: {
    getSnapshot():WorkspaceSnapshot;subscribe(listener:()=>void):()=>void
  }}> & {operations:Ops}
const labels: Record<Task['status'], string> = {
  pending:'待执行', starting:'启动中', running:'运行中', completed:'已完成',
  blocked:'已阻塞', failed:'失败', interrupted:'待人工恢复', skipped:'人工跳过',
}
// U06: a plain task has no Goal to resume — its interrupted state is "to verify", not "to recover".
const statusLabel=(task:Task)=>task.status==='interrupted'?(task.goalMode?'待人工恢复':'待核实'):labels[task.status]
function message(error: unknown):string { return error instanceof Error ? error.message : String(error) }
export function QueueBoard(props:BoardProps) {
  const open = props.useStore(s=>s.open)
  const error = props.useStore(s=>s.error)
  // U05: failures are rendered bound to their source; the global bar keeps system-level only.
  const notice = props.useStore(s=>s.notice)
  const formErrors = props.useStore(s=>s.formErrors)
  const taskErrors = props.useStore(s=>s.taskErrors)
  const loadingState = props.useQueueSettings(s=>s)
  const settings = loadingState.value ?? DEFAULT_SETTINGS
  const workspaces = props.useWorkspaces(s=>s)
  const q = settings.queue
  const authorized=useSyncExternalStore(props.operations.subscribeAuthorization, props.operations.isAuthorized)
  const queueEnabled=q.enabled && authorized
  const blockers = q.tasks.filter(t => UNRESOLVED.includes(t.status))
  const summary=summarizeQueue(q)
  const [editing,setEditing] = useState<string|null>(null)
  const [title,setTitle] = useState('')
  const [workspaceId,setWorkspaceId] = useState('')
  const [prompt,setPrompt] = useState('')
  const [goalMode,setGoalMode] = useState(true)
  const [generateTitle,setGenerateTitle] = useState(false)
  const [titleMaxChars,setTitleMaxChars] = useState(24)
  const [submitting,setSubmitting] = useState(false)
  // U03: discovery freshness is Host-scheduled; the board only renders what the Coordinator reports.
  const syncState = useSyncExternalStore(props.operations.subscribeSync, props.operations.getSyncState)
  const discovering = syncState.state==='scanning'
  const [catalog,setCatalog] = useState<ModelCatalog>()
  const [catalogError,setCatalogError] = useState('')
  const [selection,setSelection] = useState<TaskModelSelection>()
  const [followDefault,setFollowDefault] = useState(false)
  const [catalogRevision,setCatalogRevision] = useState(0)
  useEffect(()=>{
    let alive=true
    setCatalog(undefined);setCatalogError('')
    if(!open||loadingState.status!=='ready')return
    void props.operations.modelCatalog().then(value=>{if(alive)setCatalog(value)},e=>{if(alive)setCatalogError(message(e))})
    return()=>{alive=false}
  },[open,catalogRevision,loadingState.status,props.operations.modelCatalog])
  const [filter,setFilter] = useState<TaskFilter>('current')
  const [expanded,setExpanded] = useState<Record<string,boolean>>({})
  useEffect(()=>{
    if (!open) return
    const onKey = (e:KeyboardEvent)=>{if(e.key==='Escape')props.actions.close()}
    window.addEventListener('keydown',onKey)
    return ()=>window.removeEventListener('keydown',onKey)
  },[open,props.actions])
  if(!open) return null
  // Errors must never be misrepresented as a real empty queue. Mutations are not mounted
  // until a fresh, validated Host configuration snapshot has arrived.
  if (loadingState.status !== 'ready') return createPortal(<div className="gq-root" role="dialog" aria-modal="true" aria-label="DSH 任务队列配置状态">
    <header className="gq-head"><div><h1>DSH Goal Queue</h1><span>跨工作区串行任务</span></div>
      <button type="button" onClick={()=>props.actions.close()}>关闭</button></header>
    <main className="gq-list">
      {loadingState.status === 'loading'
        ? <div className="gq-notes" role="status">正在读取 Host 任务队列配置；读取完成前不能操作或派发任务。</div>
        : <div className="gq-error" role="alert">队列配置读取或保存失败：{loadingState.error ?? '未知错误'}。尚未读取到可信任务状态，原有数据不代表丢失。请先核对旧 Session，随后重试读取。</div>}
      {loadingState.status === 'error' && <button type="button" onClick={()=>{
        void props.operations.refresh().catch(e=>props.actions.error(message(e)))
      }}>重试读取配置</button>}
      {error && <div className="gq-error" role="alert">操作失败：{error}</div>}
    </main>
  </div>, document.body)
  const change = async (op:()=>Promise<void>)=> {
    try { await op();props.actions.error('') }
    catch(e){props.actions.error(message(e))}
  }
  // U05: task-row (and external-row) failures bind to that row instead of the global bar.
  const changeTask = async (id:string,op:()=>Promise<void>)=> {
    try { await op();props.actions.taskError(id,'') }
    catch(e){props.actions.taskError(id,message(e))}
  }
  // U06: one read-only verification entry per task; every action re-checks at submission time.
  const [panel,setPanel] = useState<string|null>(null)
  const [insp,setInsp] = useState<TaskInspection|null>(null)
  const [inspecting,setInspecting] = useState(false)
  const [acting,setActing] = useState(false)
  const [requeueFor,setRequeueFor] = useState<string|null>(null)
  const openPanel = (id:string)=>{
    if(panel===id){setPanel(null);setInsp(null);return}
    setPanel(id);setInsp(null);setActing(false)
    void (async()=>{
      setInspecting(true)
      try{setInsp(await props.operations.inspect(id));props.actions.taskError(id,'')}
      catch(e){props.actions.taskError(id,message(e))}
      finally{setInspecting(false)}
    })()
  }
  const act = async (id:string,op:()=>Promise<void>,done:string)=>{
    if(acting)return
    setActing(true)
    try{await op();props.actions.taskError(id,'');props.actions.notice(done);setPanel(null);setInsp(null)}
    catch(e){props.actions.taskError(id,message(e))}
    finally{setActing(false)}
  }
  const newForm = ()=>{setEditing('new');setRequeueFor(null);setTitle('');setWorkspaceId(workspaces.items[0]?.workspaceId??'');setPrompt('');setGoalMode(true);setGenerateTitle(false);setTitleMaxChars(24);setFollowDefault(false);setSelection(catalog?.default)}
  const editForm = (t:Task)=>{setEditing(t.id);setRequeueFor(null);setTitle(t.title);setWorkspaceId(t.workspaceId);setPrompt(t.prompt);setGoalMode(t.goalMode);setGenerateTitle(t.generateTitle??false);setTitleMaxChars(t.titleMaxChars??24);setFollowDefault(!t.modelSelection);setSelection(t.modelSelection??catalog?.default)}
  const displayedSelection=followDefault?catalog?.default:selection
  const selectedModel=catalog?.groups.find(p=>p.id===displayedSelection?.provider)?.models.find(m=>m.id===displayedSelection?.model)
  let modelError=''
  if(catalog)try{if(!followDefault&&!selection)throw Error('请选择执行模型');resolveTaskModel(catalog,followDefault?catalog.default:selection)}catch(e){modelError=message(e)}
  const onSave = async (event:FormEvent)=>{
    event.preventDefault()
    if(submitting)return
    if(generateTitle&&prompt.length>MAX_TITLE_INPUT_CHARS){
      props.actions.formError('title','模型标题最多接受 8000 个 UTF-16 代码单元，请缩短题词或关闭标题生成')
      return
    }
    setSubmitting(true)
    try {
      if(!catalog)throw Error(catalogError||'正在读取 Host 模型目录')
      if(modelError)throw Error(modelError)
      const modelSelection=followDefault?undefined:resolveTaskModel(catalog,selection)
      const input={title:generateTitle?'':title,workspaceId,prompt,goalMode,generateTitle,titleMaxChars,modelSelection}
      if(editing==='new')await props.operations.add(input)
      else if(requeueFor){await props.operations.requeueEdited(requeueFor,input);props.actions.notice('已编辑并重新排队，点击“启动队列”执行');setPanel(null);setInsp(null)}
      else if(editing)await props.operations.edit(editing,input)
      setEditing(null);setRequeueFor(null);props.actions.formError('form','')
    }catch(e){props.actions.formError('form',message(e))}
    finally{setSubmitting(false)}
  }
  const busy = summary.occupied > 0
  const visibleRows=filterTaskRows(q,filter)
  const formatTime=(value:number)=>{
    const date=new Date(value)
    return Number.isNaN(date.getTime())?'未知':date.toLocaleString()
  }
  const syncLabel=syncState.state==='fresh'?'运行任务已同步 · '+formatTime(syncState.syncedAt)
    :syncState.state==='scanning'?'正在扫描运行任务…'
    :syncState.state==='failed'?'运行任务同步失败：'+syncState.reason
    :'运行任务基线建立中…'
  return createPortal(<div className="gq-root" role="dialog" aria-modal="true" aria-label="DSH 任务队列">
    <header className="gq-head">
      <div><h1>DSH 任务队列</h1><span>跨工作区任务 · {summary.pending} 项待执行 · {summary.unresolved} 项异常</span><span className="gq-sync" role="status">{syncLabel}</span></div>
      <div className="gq-actions">
        <button type="button" onClick={newForm}>添加任务</button>
        <button type="button" disabled={discovering} onClick={()=>{void change(()=>props.operations.discover())}}>{discovering?'扫描中…':'刷新运行任务'}</button>
        <button type="button" className={queueEnabled?'gq-warn':'gq-primary'} disabled={!queueEnabled && (blockers.length>0 || discovering)} onClick={()=>{void change(()=>props.operations.enable(!queueEnabled))}}>
          {queueEnabled?'暂停队列':'启动队列'}
        </button>
        <button type="button" onClick={()=>props.actions.close()}>关闭</button>
      </div>
    </header>
    <div className="gq-notes">
      {queueEnabled?'队列已启用：串行派发，至多 1 项占用执行。':'队列未获当前客户端启动授权：不会启动下一项；已有任务不会被中断。'}
      {busy?` 当前有 ${summary.occupied} 项运行／观察任务（启动 ${summary.starting} · 运行 ${summary.observedRunning} · 外部 ${summary.externalActivity}）；串行模式：至多 1 项占用执行。`:''}
      {summary.occupied>q.maxConcurrent&&<div className="gq-error">发现的运行任务已超过串行执行上限；不会强制结束已有 Session，也不会派发新任务。</div>}
      {blockers.length>0 && <div className="gq-error" role="alert">有 {blockers.length} 项异常任务尚未处理，已禁止启动后续任务。先查看旧 Session，明确选择重新排队或人工跳过。</div>}
      <div>目标模式以 DSH Goal 的 complete / blocked 为准；普通模式以已观察到的运行→空闲为准，不代表代码已通过人工验收。</div>
    </div>
    {q.error && <div className="gq-error" role="status">{q.error}</div>}
    {notice && <div className="gq-notice" role="status">{notice}</div>}
    {error && <div className="gq-error" role="alert">操作失败：{error}</div>}
    <nav className="gq-filters" aria-label="队列筛选">
      {([['current','待执行与运行'],['abnormal','异常待处理'],['history','已完成与跳过'],['all','全部任务']] as const).map(([value,label])=>
        <button key={value} type="button" aria-pressed={filter===value}
          onClick={()=>setFilter(value)}>{label}</button>)}
    </nav>
    <main className="gq-list">
      {q.tasks.length===0?<div className="gq-empty">队列为空。添加任务并选择工作区，随后点击启动队列。</div>:visibleRows.length===0?<div className="gq-empty">此分类暂无任务。可切换筛选查看其他记录。</div>:visibleRows.map(({task,index:i})=>{
        const editable = task.status==='pending' && task.source!=='discovered'
        return <article className="gq-task" key={task.id} data-status={task.status}>
          <div className="gq-task-top">
            <span className="gq-order">{i+1}</span>
            <div className="gq-desc">
              <strong>{task.title || (task.goalMode ? '未命名目标任务' : '等待 DSH 自动生成标题')}</strong>
              <small>{workspaces.items.find(w=>w.workspaceId===task.workspaceId)?.title??(task.workspaceId||'未关联工作区')}</small>
            </div>
            <span className="gq-pill">{task.source==='discovered'?'DPH 原有任务':task.goalMode?'目标模式 /goal':'普通模式'}</span>
            <span className="gq-pill" data-status={task.status}>{statusLabel(task)}</span>
          </div>
          <p className="gq-prompt">{task.prompt||'已纳入 DPH 现有 Session；无需重新提交指令'}</p>
          <p className="gq-detail">{task.modelSelection?`模型：${task.modelSelection.provider} / ${task.modelSelection.model} · 推理：${task.modelSelection.reasoningEffort??'不适用'}`:task.source==='discovered'?'模型：沿用原 Session 配置':'模型：派发时使用 Host 默认并固定配置'}</p>
          <p className="gq-detail">创建 {formatTime(task.createdAt)} · 最近状态 {formatTime(task.updatedAt)}</p>
          {task.detail&&<p className="gq-detail">{task.detail}</p>}
           {task.titleError&&<p className="gq-detail" role="status">{task.titleError}</p>}
           {taskErrors[task.id]&&<p className="gq-error" role="alert">操作失败：{taskErrors[task.id]}</p>}
          <div className="gq-task-controls">
            <button type="button" disabled={!editable||!q.tasks.slice(0,i).some(t=>t.status==='pending')} onClick={()=>{void changeTask(task.id,()=>props.operations.move(task.id,-1))}}>上移</button>
            <button type="button" disabled={!editable||!q.tasks.slice(i+1).some(t=>t.status==='pending')} onClick={()=>{void changeTask(task.id,()=>props.operations.move(task.id,1))}}>下移</button>
            <button type="button" disabled={!editable} onClick={()=>editForm(task)}>编辑</button>
            {!UNRESOLVED.includes(task.status)&&<button type="button" disabled={q.activeIds.includes(task.id)} onClick={()=>{void changeTask(task.id,()=>props.operations.remove(task.id))}}>删除</button>}
            {task.sessionId&&<button type="button" onClick={()=>{props.operations.open(task.id);props.actions.close()}}>查看原会话</button>}
            {Boolean(task.attempts?.length)&&<button type="button" aria-expanded={Boolean(expanded[task.id])}
              onClick={()=>setExpanded(s=>({...s,[task.id]:!s[task.id]}))}>执行记录 ({task.attempts?.length})</button>}
            {(UNRESOLVED.includes(task.status)||task.needsReview)&&<button type="button" aria-expanded={panel===task.id} onClick={()=>openPanel(task.id)}>查看并处理</button>}
          </div>
          {panel===task.id&&<div className="gq-inspect" aria-label="核实面板">
            {inspecting&&<p role="status">正在只读核实原 Session 与 Goal…</p>}
            {insp&&<>
              <p className="gq-detail">核实结果：Session {insp.sessionFound?(insp.sessionRunning?'存在，仍在运行':'存在，已停止'):'已不存在'} · Goal ID {insp.goalIdMatches===null?'不适用':insp.goalIdMatches?'与原 Session 一致':'与原 Session 不一致'}</p>
              {insp.warnings.map((w,k)=><p key={k} className="gq-detail" role="status">{w}</p>)}
              <div className="gq-inspect-actions">
                <button type="button" disabled={!task.sessionId||acting} onClick={()=>{props.operations.open(task.id);props.actions.close()}}>查看原会话</button>
                <button type="button" disabled={!insp.canResume||acting} onClick={()=>{void act(task.id,()=>props.operations.resumeGoal(task.id),'原 Goal 已恢复，占用一个执行名额')}}>恢复原 Goal</button>
                <button type="button" disabled={!insp.canRetry||acting} onClick={()=>{void act(task.id,()=>props.operations.retry(task.id),'已重新排队，点击“启动队列”执行')}}>重试此任务（新会话）</button>
                <button type="button" disabled={!insp.canSkip||acting} onClick={()=>{void act(task.id,()=>props.operations.skip(task.id),'已跳过，队列仍暂停。点击“启动队列”继续待执行任务。')}}>跳过此任务</button>
                <button type="button" disabled={!insp.canRequeueEdited||acting} onClick={()=>{editForm(task);setRequeueFor(task.id)}}>编辑后重新排队</button>
                <button type="button" disabled={q.activeIds.includes(task.id)||UNRESOLVED.includes(task.status)||acting} onClick={()=>{void act(task.id,()=>props.operations.remove(task.id),'记录已删除；其余任务状态不变')}}>删除记录</button>
              </div>
              {!insp.canResume&&insp.reasons.resume&&<p className="gq-detail">恢复原 Goal：{insp.reasons.resume}</p>}
              {!insp.canRetry&&insp.reasons.retry&&<p className="gq-detail">重试此任务：{insp.reasons.retry}</p>}
              {!insp.canSkip&&insp.reasons.skip&&<p className="gq-detail">跳过此任务：{insp.reasons.skip}</p>}
              {!insp.canRequeueEdited&&insp.reasons.requeueEdited&&<p className="gq-detail">编辑后重新排队：{insp.reasons.requeueEdited}</p>}
              {q.activeIds.includes(task.id)?<p className="gq-detail">删除记录：运行中的任务不能删除。</p>:UNRESOLVED.includes(task.status)&&<p className="gq-detail">删除记录：异常任务须先人工处置，不能删除证据。</p>}
            </>}
          </div>}
          {expanded[task.id]&&<div className="gq-history" aria-label="历次执行记录">
            {task.attempts?.map((attempt,index)=><div className="gq-history-row" key={attempt.id}>
              <span>第 {index+1} 次 · {labels[attempt.status]} · Session：{attempt.sessionId||'未知'} · 记录 {formatTime(attempt.updatedAt)}</span>
              {attempt.sessionId&&<button type="button" onClick={()=>{
                props.operations.openAttempt(task.id,attempt.id);props.actions.close()
              }}>打开历史 Session</button>}
            </div>)}
          </div>}
        </article>
      })}
      {q.sessionActivity.length>0&&<section className="gq-external" aria-label="外部活动">
        <h2>外部活动（{q.sessionActivity.length}）</h2>
        <p className="gq-detail">队列外观察到的运行 Session，占用执行名额；仅其权威停止后释放，不会被队列强制结束。</p>
        {q.sessionActivity.map(id=><div className="gq-external-row" key={id}>
          <span>Session：{id}</span>
          {taskErrors[id]&&<span className="gq-error" role="alert">{taskErrors[id]}</span>}
          <button type="button" onClick={()=>{void changeTask(id,()=>props.operations.openSessionById(id))}}>打开</button>
        </div>)}
      </section>}
    </main>
    {editing!==null&&<div className="gq-modal-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget){setEditing(null);setRequeueFor(null)}}}>
      <form className="gq-modal" onSubmit={e=>{void onSave(e)}}>
        <h2>{editing==='new'?'添加任务':requeueFor?'编辑后重新排队':'编辑待执行任务'}</h2>
        <label>任务标题（可留空）<input maxLength={200} value={title} disabled={generateTitle} onChange={e=>setTitle(e.target.value)} placeholder={generateTitle?'将由模型生成标题':'可选，留空时普通模式沿用 DSH 自动标题'} /></label>
        {formErrors.title&&<p role="alert">{formErrors.title}</p>}
        <label className="gq-check"><input type="checkbox" checked={generateTitle} onChange={e=>{setGenerateTitle(e.target.checked);if(e.target.checked)setTitle('')}}/> 由模型根据任务题词生成标题（额外模型请求）</label>
        {generateTitle&&<label>模型标题最长字符数 <input type="number" min={8} max={80} step={1} required value={titleMaxChars} onChange={e=>setTitleMaxChars(Number(e.target.value))}/></label>}
        <label>执行工作区<select required value={workspaceId} onChange={e=>setWorkspaceId(e.target.value)}>
          <option value="">选择工作区</option>
          {workspaces.items.map(w=><option key={w.workspaceId} value={w.workspaceId}>{w.title} — {w.path}</option>)}
        </select></label>
        {!catalog&&<p role="status">{catalogError||'正在读取 Host 模型目录…'}</p>}
        <button type="button" onClick={()=>setCatalogRevision(n=>n+1)}>刷新模型目录</button>
        {catalog?.failures.map(f=><p key={f.id} role="alert">模型目录读取失败：{f.name}。请检查 Host 配置。</p>)}
        <label className="gq-check"><input type="checkbox" checked={followDefault} onChange={e=>setFollowDefault(e.target.checked)}/> 派发时使用 Host 默认模型和推理强度</label>
        <label>执行模型<select required={!followDefault} disabled={followDefault||!catalog} value={displayedSelection?JSON.stringify([displayedSelection.provider,displayedSelection.model]):''} onChange={e=>{
          const [provider,model]=JSON.parse(e.target.value) as [string,string]
          const info=catalog?.groups.find(p=>p.id===provider)?.models.find(m=>m.id===model)
          setSelection({provider,model,...info?.reasoning?.defaultEffort?{reasoningEffort:info.reasoning.defaultEffort}:{}})
        }}>
          <option value="" disabled>选择执行模型</option>
          {displayedSelection&&!selectedModel&&<option value={JSON.stringify([displayedSelection.provider,displayedSelection.model])}>{displayedSelection.provider} / {displayedSelection.model}（当前不可用）</option>}
          {catalog?.groups.map(p=><optgroup key={p.id} label={p.name}>{p.models.map(m=><option key={m.id} value={JSON.stringify([p.id,m.id])}>{m.name}</option>)}</optgroup>)}
        </select></label>
        <label>推理强度<select required={Boolean(!followDefault&&selectedModel?.reasoning)} disabled={followDefault||!selectedModel?.reasoning} value={displayedSelection?.reasoningEffort??selectedModel?.reasoning?.defaultEffort??''} onChange={e=>setSelection(s=>s?{...s,reasoningEffort:e.target.value}:s)}>
          <option value="" disabled>{selectedModel?.reasoning?'选择推理强度':'不适用'}</option>
          {displayedSelection?.reasoningEffort&&!selectedModel?.reasoning?.efforts.some(e=>e.id===displayedSelection.reasoningEffort)&&<option value={displayedSelection.reasoningEffort}>{displayedSelection.reasoningEffort}（当前不支持）</option>}
          {selectedModel?.reasoning?.efforts.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
        </select></label>
        {modelError&&<p role="alert">{modelError}</p>}
        <p>标题生成使用与任务相同的模型和推理强度。未选择“派发时使用 Host 默认”时，保存即固定配置。Harness 原生模型选择也会更新 Host 默认模型；恢复已有 Session 不重新设置模型。</p>
        <label className="gq-check"><input type="checkbox" checked={goalMode} onChange={e=>setGoalMode(e.target.checked)}/> 使用 DSH 原生目标模式（/goal）</label>
        <label>任务说明<textarea required value={prompt} onChange={e=>setPrompt(e.target.value)} rows={7} placeholder="说明任务、约束和验收标准"/></label>
        {generateTitle&&<p role={prompt.length>MAX_TITLE_INPUT_CHARS?'alert':'status'}>标题辅助请求最多 {MAX_TITLE_INPUT_CHARS} 个 UTF-16 代码单元，当前 {prompt.length}。超限可取消模型标题，原任务题词不会被截断。</p>}
        <p>标题可留空；不勾选时普通任务沿用 DSH 原生标题，纯 /goal 无法触发首消息自动命名。勾选后插件通过 Host 无工具的独立模型请求生成标题（8–80 字符硬上限），不向任务 Session 发送额外执行指令。</p>
        <footer>{formErrors.form&&<p role="alert">保存失败：{formErrors.form}</p>}<button type="button" onClick={()=>{setEditing(null);setRequeueFor(null)}}>取消</button><button className="gq-primary" disabled={submitting||!workspaceId||!catalog||Boolean(modelError)||(generateTitle&&prompt.length>MAX_TITLE_INPUT_CHARS)} type="submit">{requeueFor?'重新排队':'保存'}</button></footer>
      </form>
    </div>}
  </div>,document.body)
}
