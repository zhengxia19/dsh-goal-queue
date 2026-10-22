import { UNRESOLVED, type Task, type QueueState } from '../queue.ts'
export type TaskFilter='current'|'abnormal'|'history'|'all'
export function filterTaskRows(q:QueueState,filter:TaskFilter):{task:Task;index:number}[]{
  return q.tasks.map((task,index)=>({task,index})).filter(({task})=>{
    if(filter==='all')return true
    if(filter==='abnormal')return UNRESOLVED.includes(task.status)
    if(filter==='history')return task.status==='completed'||task.status==='skipped'
    return task.status==='pending'||task.status==='running'||task.status==='starting'
  })
}
