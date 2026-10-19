/** Workspace-aware, reorderable single-lane queue. No second Session/Goal authority. */
import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { PropsStore, PropsHooks, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { DEFAULT_SETTINGS, type QueueSettings, type Task } from '../queue.ts'
import type { viewStore } from './store.ts'
import type { Coordinator } from './coordinator.ts'

type Ops = Pick<Coordinator, 'add' | 'edit' | 'remove' | 'move' | 'retry' | 'enable' | 'open'>
export type BoardProps = PropsStore<typeof viewStore> & PropsRuntime<'shell.overlay'> &
  PropsHooks<{queueSettings: SettingsScope<QueueSettings>, workspaces: {
    getSnapshot():WorkspaceSnapshot;subscribe(listener:()=>void):()=>void
  }}> & {operations:Ops}
const labels: Record<Task['status'], string> = {
  pending:'待执行', starting:'启动中', running:'运行中', completed:'已完成',
  blocked:'已阻塞', failed:'失败', interrupted:'待人工恢复',
}
function message(error: unknown):string { return error instanceof Error ? error.message : String(error) }
export function QueueBoard(props:BoardProps) {
  const open = props.useStore(s=>s.open)
  const error = props.useStore(s=>s.error)
  const settings = props.useQueueSettings(s=>s.value ?? DEFAULT_SETTINGS)
  const workspaces = props.useWorkspaces(s=>s)
  const q = settings.queue
  const [editing,setEditing] = useState<string|null>(null)
  const [title,setTitle] = useState('')
  const [workspaceId,setWorkspaceId] = useState('')
  const [prompt,setPrompt] = useState('')
  const [goalMode,setGoalMode] = useState(true)
  const [submitting,setSubmitting] = useState(false)
  useEffect(()=>{
    if (!open) return
    const onKey = (e:KeyboardEvent)=>{if(e.key==='Escape')props.actions.close()}
    window.addEventListener('keydown',onKey)
    return ()=>window.removeEventListener('keydown',onKey)
  },[open,props.actions])
  if(!open) return null
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
  const busy = q.activeId !== null
  return createPortal(<div className="gq-root" role="dialog" aria-modal="true" aria-label="DSH 任务队列">
    <header className="gq-head">
      <div><h1>DSH Goal Queue</h1><span>跨工作区串行任务 · {q.tasks.filter(t=>t.status==='pending').length} 项待执行</span></div>
      <div className="gq-actions">
        <button type="button" onClick={newForm}>添加任务</button>
        <button type="button" className={q.enabled?'gq-warn':'gq-primary'} onClick={()=>{void change(()=>props.operations.enable(!q.enabled))}}>
          {q.enabled?'暂停队列':'启动队列'}
        </button>
        <button type="button" onClick={()=>props.actions.close()}>关闭</button>
      </div>
    </header>
    <div className="gq-notes">
      {q.enabled?'队列已启用：每次仅派发一项任务。':'队列已暂停：不会启动下一项；已有任务不会被中断。'}
      {busy?' 当前执行槽已占用。':''}
      <div>目标模式以 DSH Goal 的 complete / blocked 为准；普通模式以已观察到的运行→空闲为准，不代表代码已通过人工验收。</div>
    </div>
    {q.error && <div className="gq-error" role="alert">{q.error}</div>}
    {error && <div className="gq-error" role="alert">操作失败：{error}</div>}
    <main className="gq-list">
      {q.tasks.length===0?<div className="gq-empty">队列为空。添加任务并选择工作区，随后点击启动队列。</div>:q.tasks.map((task,i)=>{
        const editable = task.status==='pending'
        return <article className="gq-task" key={task.id} data-status={task.status}>
          <div className="gq-task-top">
            <span className="gq-order">{i+1}</span>
            <div className="gq-desc">
              <strong>{task.title}</strong>
              <small>{workspaces.items.find(w=>w.workspaceId===task.workspaceId)?.title??task.workspaceId}</small>
            </div>
            <span className="gq-pill">{task.goalMode?'目标模式 /goal':'普通模式'}</span>
            <span className="gq-pill" data-status={task.status}>{labels[task.status]}</span>
          </div>
          <p className="gq-prompt">{task.prompt}</p>
          {task.detail&&<p className="gq-detail">{task.detail}</p>}
          <div className="gq-task-controls">
            <button type="button" disabled={!editable||!q.tasks.slice(0,i).some(t=>t.status==='pending')} onClick={()=>{void change(()=>props.operations.move(task.id,-1))}}>上移</button>
            <button type="button" disabled={!editable||!q.tasks.slice(i+1).some(t=>t.status==='pending')} onClick={()=>{void change(()=>props.operations.move(task.id,1))}}>下移</button>
            <button type="button" disabled={!editable} onClick={()=>editForm(task)}>编辑</button>
            <button type="button" disabled={task.id===q.activeId} onClick={()=>{void change(()=>props.operations.remove(task.id))}}>删除</button>
            {task.sessionId&&<button type="button" onClick={()=>{props.operations.open(task.id);props.actions.close()}}>打开 Session</button>}
            {['failed','blocked','interrupted'].includes(task.status)&&<button type="button" onClick={()=>{
              if(!window.confirm('重新排队将创建新的 Session。请先确认旧 Session 已停止，防止重复修改代码。'))return
              void change(()=>props.operations.retry(task.id))
            }}>重新排队</button>}
          </div>
        </article>
      })}
    </main>
    {editing!==null&&<div className="gq-modal-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget)setEditing(null)}}>
      <form className="gq-modal" onSubmit={e=>{void onSave(e)}}>
        <h2>{editing==='new'?'添加任务':'编辑待执行任务'}</h2>
        <label>任务标题<input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)} placeholder="例如：实现登录模块" /></label>
        <label>执行工作区<select required value={workspaceId} onChange={e=>setWorkspaceId(e.target.value)}>
          <option value="">选择工作区</option>
          {workspaces.items.map(w=><option key={w.workspaceId} value={w.workspaceId}>{w.title} — {w.path}</option>)}
        </select></label>
        <label className="gq-check"><input type="checkbox" checked={goalMode} onChange={e=>setGoalMode(e.target.checked)}/> 使用 DSH 原生目标模式（/goal）</label>
        <label>任务说明<textarea required value={prompt} onChange={e=>setPrompt(e.target.value)} rows={7} placeholder="说明任务、约束和验收标准"/></label>
        <p>目标模式将说明作为一个 Goal 创建；普通模式只执行一轮普通任务。每项任务创建独立 Session。</p>
        <footer><button type="button" onClick={()=>setEditing(null)}>取消</button><button className="gq-primary" disabled={submitting||!workspaceId} type="submit">保存</button></footer>
      </form>
    </div>}
  </div>,document.body)
}
