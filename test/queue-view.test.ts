import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_QUEUE,add } from '../src/queue.ts'
import { filterTaskRows } from '../src/client/queue-view.ts'

const input=(s:string)=>({workspaceId:'ws',title:s,prompt:s,goalMode:false})
test('T12: filtering retains original dispatch position and history identity',()=>{
  let q=add(add(add(EMPTY_QUEUE,input('A'),'a'),input('B'),'b'),input('C'),'c')
  q={...q,tasks:q.tasks.map(t=>t.id==='a'
    ?{...t,status:'completed' as const,sessionId:'s-a'}:t.id==='b'
    ?{...t,status:'blocked' as const}:t)}
  assert.deepEqual(filterTaskRows(q,'current').map(x=>x.task.id),['c'])
  assert.deepEqual(filterTaskRows(q,'abnormal').map(x=>x.task.id),['b'])
  assert.deepEqual(filterTaskRows(q,'history').map(x=>x.task.id),['a'])
  assert.deepEqual(filterTaskRows(q,'all').map(x=>x.index),[0,1,2])
  assert.deepEqual(q.tasks.map(t=>t.id),['a','b','c'],'UI filter must never reorder persistent FIFO')
})
