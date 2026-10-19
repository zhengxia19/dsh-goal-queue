/** Workspace-aware, reorderable single-lane queue. No second Session/Goal authority. */
import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { PropsStore, PropsHooks, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { QueueSettingsSource } from './settings.ts'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { DEFAULT_SETTINGS, UNRESOLVED, type Task } from '../queue.ts'
import type { viewStore } from './store.ts'
import type { Coordinator } from './coordinator.ts'

type Ops = Pick<Coordinator, 'add' | 'edit' | 'remove' | 'move' | 'retry' | 'skip' | 'enable' | 'open' | 'discover' | 'resumeGoal' | 'setConcurrency'> & {refresh: () => Promise<void>}
export type BoardProps = PropsStore<typeof viewStore> & PropsRuntime<'shell.overlay'> &
  PropsHooks<{queueSettings: QueueSettingsSource, workspaces: {
    getSnapshot():WorkspaceSnapshot;subscribe(listener:()=>void):()=>void
  }}> & {operations:Ops}
const labels: Record<Task['status'], string> = {
  pending:'待执行', starting:'启动中', running:'运行中', completed:'已完成',
  blocked:'已阻塞', failed:'失败', interrupted:'待人工恢复', skipped:'人工跳过',
}
function message(error: unknown):string { return error instanceof Error ? error.message : String(error) }
export function QueueBoard(props:BoardProps) {
  const open = props.useStore(s=>s.open)
  const error = props.useStore(s=>s.error)
  const loadingState = props.useQueueSettings(s=>s)
  const settings = loadingState.value ?? DEFAULT_SETTINGS
  const workspaces = props.useWorkspaces(s=>s)
  const q = settings.queue
  const blockers = q.tasks.filter(t => UNRESOLVED.includes(t.status))
  const [editing,setEditing] = useState<string|null>(null)
  const [title,setTitle] = useState('')
  const [workspaceId,setWorkspaceId] = useState('')
  const [prompt,setPrompt] = useState('')
  const [goalMode,setGoalMode] = useState(true)
  const [submitting,setSubmitting] = useState(false)
  const [discovering,setDiscovering] = useState(false)
  useEffect(()=>{
    if (!open) return
    const onKey = (e:KeyboardEvent)=>{if(e.key==='Escape')props.actions.close()}
    window.addEventListener('keydown',onKey)
    return ()=>window.removeEventListener('keydown',onKey)
  },[open,props.actions])
  useEffect(()=>{
    if(!open || loadingState.status!=='ready')return
    let alive=true
    setDiscovering(true)
    void props.operations.discover().catch(e=>props.actions.error(message(e))).finally(()=>{if(alive)setDiscovering(false)})
    return ()=>{alive=false}
  },[open,loadingState.status])
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
  const newForm = ()=>{setEditing('new');setTitle('');setWorkspaceId(workspaces.items[0]?.workspaceId??'');setPrompt('');setGoalMode(true)}
  const editForm = (t:Task)=>{setEditing(t.id);setTitle(t.title);setWorkspaceId(t.workspaceId);setPrompt(t.prompt);setGoalMode(t.goalMode)}
  const onSave = async (event:FormEvent)=>{
    event.preventDefault()
    if(submitting)return
    setSubmitting(true)
    const input={title,workspaceId,prompt,goalMode}
    try {
      if(editing==='new')await props.operations.add(input)
      else if(editing)await props.operations.edit(editing,input)
      setEditing(null);props.actions.error('')
    }catch(e){props.actions.error(message(e))}
    finally{setSubmitting(false)}
  }
  const busy = q.activeIds.length > 0
  return createPortal(<div className="gq-root" role="dialog" aria-modal="true" aria-label="DSH 任务队列">
    <header className="gq-head">
      <div><h1>DSH 任务队列</h1><span>跨工作区任务 · {q.tasks.filter(t=>t.status==='pending').length} 项待执行</span></div>
      <div className="gq-actions">
        <button type="button" onClick={newForm}>添加任务</button>
        <button type="button" disabled={discovering} onClick={()=>{setDiscovering(true);void change(()=>props.operations.discover().then(()=>{})).finally(()=>setDiscovering(false))}}>{discovering?'扫描中…':'刷新运行任务'}</button>
        <label>最大并发 <select aria-label="最大并发任务数" value={q.maxConcurrent} onChange={e=>{void change(()=>props.operations.setConcurrency(Number(e.target.value)))}}>
          {Array.from({length:8},(_,i)=>i+1).map(n=><option key={n} value={n}>{n}</option>)}
        </select></label>
        <button type="button" className={q.enabled?'gq-warn':'gq-primary'} disabled={!q.enabled && (blockers.length>0 || discovering)} onClick={()=>{void change(()=>props.operations.enable(!q.enabled))}}>
          {q.enabled?'暂停队列':'启动队列'}
        </button>
        <button type="button" onClick={()=>props.actions.close()}>关闭</button>
      </div>
    </header>
    <div className="gq-notes">
      {q.enabled?'队列已启用：按并发上限派发任务。':'队列已暂停：不会启动下一项；已有任务不会被中断。'}
      {busy?` 当前有 ${q.activeIds.length} 项运行／观察任务，最大并发 ${q.maxConcurrent}。`:''}
      {q.activeIds.length>q.maxConcurrent&&<div className="gq-error">发现的运行任务已超过并发上限；不会强制结束已有 Session，也不会派发新任务。</div>}
      {blockers.length>0 && <div className="gq-error" role="alert">有 {blockers.length} 项异常任务尚未处理，已禁止启动后续任务。先查看旧 Session，明确选择重新排队或人工跳过。</div>}
      <div>目标模式以 DSH Goal 的 complete / blocked 为准；普通模式以已观察到的运行→空闲为准，不代表代码已通过人工验收。</div>
    </div>
    {q.error && <div className="gq-error" role="alert">{q.error}</div>}
    {error && <div className="gq-error" role="alert">操作失败：{error}</div>}
    <main className="gq-list">
      {q.tasks.length===0?<div className="gq-empty">队列为空。添加任务并选择工作区，随后点击启动队列。</div>:q.tasks.map((task,i)=>{
        const editable = task.status==='pending' && task.source!=='discovered'
        return <article className="gq-task" key={task.id} data-status={task.status}>
          <div className="gq-task-top">
            <span className="gq-order">{i+1}</span>
            <div className="gq-desc">
              <strong>{task.title || (task.goalMode ? '未命名目标任务' : '等待 DSH 自动生成标题')}</strong>
              <small>{workspaces.items.find(w=>w.workspaceId===task.workspaceId)?.title??(task.workspaceId||'未关联工作区')}</small>
            </div>
            <span className="gq-pill">{task.source==='discovered'?'DPH 原有任务':task.goalMode?'目标模式 /goal':'普通模式'}</span>
            <span className="gq-pill" data-status={task.status}>{labels[task.status]}</span>
          </div>
          <p className="gq-prompt">{task.prompt||'已纳入 DPH 现有 Session；无需重新提交指令'}</p>
          {task.detail&&<p className="gq-detail">{task.detail}</p>}
          <div className="gq-task-controls">
            <button type="button" disabled={!editable||!q.tasks.slice(0,i).some(t=>t.status==='pending')} onClick={()=>{void change(()=>props.operations.move(task.id,-1))}}>上移</button>
            <button type="button" disabled={!editable||!q.tasks.slice(i+1).some(t=>t.status==='pending')} onClick={()=>{void change(()=>props.operations.move(task.id,1))}}>下移</button>
            <button type="button" disabled={!editable} onClick={()=>editForm(task)}>编辑</button>
            <button type="button" disabled={q.activeIds.includes(task.id)||UNRESOLVED.includes(task.status)} onClick={()=>{void change(()=>props.operations.remove(task.id))}}>删除</button>
            {task.sessionId&&<button type="button" onClick={()=>{props.operations.open(task.id);props.actions.close()}}>打开 Session</button>}
            {task.status==='interrupted'&&task.goalMode&&task.sessionId&&<button type="button" onClick={()=>{if(!window.confirm('将在原 Session 内执行 /goal resume；请确认先前的执行已经停止。'))return;void change(()=>props.operations.resumeGoal(task.id))}}>激活旧 Goal</button>}
            {UNRESOLVED.includes(task.status)&&Boolean(task.prompt.trim())&&<button type="button" onClick={()=>{
              if(!window.confirm('重新排队将创建新的 Session。请先确认旧 Session 已停止，防止重复修改代码。'))return
              void change(()=>props.operations.retry(task.id))
            }}>重新排队</button>}
            {UNRESOLVED.includes(task.status)&&<button type="button" onClick={()=>{
              if(!window.confirm('只有确认旧 Session 已停止或妥善处理之后，才能跳过该异常任务。跳过不会标记原任务成功；确认人工跳过吗？'))return
              void change(()=>props.operations.skip(task.id))
            }}>人工跳过</button>}
          </div>
        </article>
      })}
    </main>
    {editing!==null&&<div className="gq-modal-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget)setEditing(null)}}>
      <form className="gq-modal" onSubmit={e=>{void onSave(e)}}>
        <h2>{editing==='new'?'添加任务':'编辑待执行任务'}</h2>
        <label>任务标题（可留空）<input maxLength={200} value={title} onChange={e=>setTitle(e.target.value)} placeholder="可选，留空时普通模式沿用 DSH 自动标题" /></label>
        <label>执行工作区<select required value={workspaceId} onChange={e=>setWorkspaceId(e.target.value)}>
          <option value="">选择工作区</option>
          {workspaces.items.map(w=><option key={w.workspaceId} value={w.workspaceId}>{w.title} — {w.path}</option>)}
        </select></label>
        <label className="gq-check"><input type="checkbox" checked={goalMode} onChange={e=>setGoalMode(e.target.checked)}/> 使用 DSH 原生目标模式（/goal）</label>
        <label>任务说明<textarea required value={prompt} onChange={e=>setPrompt(e.target.value)} rows={7} placeholder="说明任务、约束和验收标准"/></label>
        <p>标题可留空；普通任务由 DSH 原生标题服务生成。纯 /goal 不产生首条普通用户消息，暂不保证自动生成模型标题；不发送额外指令避免重复执行。每项新任务建立独立 Session。</p>
        <footer><button type="button" onClick={()=>setEditing(null)}>取消</button><button className="gq-primary" disabled={submitting||!workspaceId} type="submit">保存</button></footer>
      </form>
    </div>}
  </div>,document.body)
}
