import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_QUEUE, add, claim, decode, edit, move, next, recover, remove, retry, skip, updateActive, setSessionId, releaseUnsubmittedClaim } from '../src/queue.ts'
const input = (x:string) => ({title:x,workspaceId:`ws-${x}`,prompt:`do ${x}`,goalMode:true})
const with2 = () => add(add(EMPTY_QUEUE,input('A'),'a',10),input('B'),'b',20)
test('state decode rejects corruption, unknown status, duplicate IDs and inconsistent ownership',()=>{
  const q=with2(); assert.ok(decode({version:1,queue:q}))
  assert.equal(decode({version:1,queue:{...q,activeId:'a'}}),undefined)
  assert.equal(decode({version:1,queue:{...q,tasks:[q.tasks[0],q.tasks[0]]}}),undefined)
  assert.equal(decode({version:1,queue:{...q,tasks:[{...q.tasks[0],status:'broken'}]}}),undefined)
})
test('manual ordering controls FIFO, not timestamps',()=>{
 let q=with2(); q=move(q,'b',-1); assert.equal(q.tasks[0]?.id,'b'); q={...q,enabled:true}; assert.equal(next(q)?.id,'b')
 q=claim(q,'b'); assert.equal(next(q),undefined); assert.throws(()=>claim(q,'a')); assert.equal(move(q,'a',-1),q)
 q=updateActive(q,'b',{status:'running',sessionId:'s1'}); assert.equal(q.activeId,'b')
 q=updateActive(q,'b',{status:'completed'}); assert.equal(next(q)?.id,'a')
})
test('errors halt queue; never fall through to next goal',()=>{
 let q={...with2(),enabled:true}; q=claim(q,'a'); q=updateActive(q,'a',{status:'blocked',detail:'审批未完成'})
 assert.equal(q.enabled,false); assert.equal(q.activeId,null); assert.equal(next(q),undefined)
 q=retry(q,'a'); assert.equal(q.tasks[0]?.status,'pending'); assert.equal(q.tasks[0]?.sessionId,undefined)
})
test('recovery is fail-closed',()=>{
 let q={...with2(),enabled:true};q=claim(q,'a');q=recover(q); assert.equal(q.enabled,false)
 assert.equal(q.tasks[0]?.status,'interrupted');assert.equal(next(q),undefined)
})
test('only pending tasks are editable, and running tasks cannot be deleted',()=>{
 let q=with2();q=edit(q,'a',input('A2'));assert.equal(q.tasks[0]?.title,'A2'); q={...q,enabled:true};q=claim(q,'a')
 assert.throws(()=>edit(q,'a',input('edited'))); assert.throws(()=>remove(q,'a'));assert.equal(remove(q,'b').tasks.length,1)
})
test('only active task may report results and cannot mutate identity',()=>{
 let q={...with2(),enabled:true};q=claim(q,'a');assert.throws(()=>updateActive(q,'b',{status:'completed'}));assert.throws(()=>updateActive(q,'a',{title:'forged'}))
})
test('manual ordering skips completed or blocked history entries',()=>{
  let q = add(add(add(EMPTY_QUEUE,input('A'),'a'),input('B'),'b'),input('C'),'c')
  q={...q,tasks:q.tasks.map(t=>t.id==='b'?{...t,status:'completed' as const}:t)}
  q=move(q,'c',-1)
  assert.deepEqual(q.tasks.map(t=>t.id),['c','b','a'])
})

test('T01 recovering a previously enabled idle queue disarms without discarding pending tasks', () => {
  const before = { ...with2(), enabled: true, activeId: null }
  const after = recover(before, '重启需要人工确认')
  assert.equal(after.enabled, false)
  assert.equal(after.tasks.length, 2)
  assert.equal(after.tasks[0]?.status, 'pending')
  assert.equal(after.error, '重启需要人工确认')
  assert.equal(next(after), undefined)
})

test('T02 abnormal history must be explicitly retried or skipped before a later pending task', () => {
  let q = with2()
  q = { ...q, enabled: true, tasks: q.tasks.map(t => t.id === 'a' ? { ...t, status: 'interrupted' as const, sessionId: 'old-a' } : t) }
  assert.equal(next(q), undefined)
  assert.throws(() => remove(q, 'a'), /异常任务必须先检查/)
  q = skip(q, 'a')
  assert.equal(q.tasks[0]?.status, 'skipped')
  assert.equal(q.tasks[0]?.sessionId, 'old-a')
  assert.equal(next(q)?.id, 'b')
  assert.throws(() => skip(q, 'a'), /只能手工跳过/)
})

test('T02 a blocked or failed task also prevents implicit leapfrogging', () => {
  for (const status of ['blocked', 'failed'] as const) {
    let q = with2()
    q = { ...q, enabled: true, tasks: q.tasks.map(t => t.id === 'a' ? { ...t, status } : t) }
    assert.equal(next(q), undefined)
    q = skip(q, 'a')
    assert.equal(next(q)?.id, 'b')
  }
})

test('T08 RED: retry must retain the original Session as a historical Attempt',()=>{
  let q=add(EMPTY_QUEUE,input('history'),'h')
  q={...q,tasks:q.tasks.map(t=>({...t,status:'interrupted' as const,
    sessionId:'old-session',goalId:'old-goal',detail:'prior error'}))}
  q=retry(q,'h')
  assert.equal(q.tasks[0]?.status,'pending')
  assert.deepEqual(q.tasks[0]?.attempts?.map(x=>x.sessionId),['old-session'])
  assert.equal(q.tasks[0]?.attempts?.[0]?.goalId,'old-goal')
})

test('T08: two retries keep all three distinct execution Attempts and legacy migration is idempotent',()=>{
  let q=add(EMPTY_QUEUE,input('history'),'h')
  const prior={...q.tasks[0]!,status:'interrupted' as const,
    sessionId:'first-session',goalId:'first-goal'}
  const legacy={version:1,queue:{...q,tasks:[prior]}}
  q=decode(legacy)!.queue
  assert.equal(q.tasks[0]?.attempts?.length,1)
  assert.equal(decode({version:1,queue:q})?.queue.tasks[0]?.attempts?.length,1)
  q=retry(q,'h')
  q=claim({...q,enabled:true},'h')
  q=setSessionId(q,'h','second-session','session_created')
  q=updateActive(q,'h',{status:'interrupted',detail:'retry failed'})
  q=retry(q,'h')
  q=claim({...q,enabled:true},'h')
  q=setSessionId(q,'h','third-session','session_created')
  q=updateActive(q,'h',{status:'completed'})
  assert.deepEqual(q.tasks[0]?.attempts?.map(a=>a.sessionId),
    ['first-session','second-session','third-session'])
  assert.equal(q.tasks[0]?.attempts?.length,3)
  assert.equal(decode({version:1,queue:q})?.queue.tasks[0]?.attempts?.length,3)
  assert.equal(q.tasks[0]?.status,'completed')
})
test('T08: revoked before Session creation leaves no phantom Attempt',()=>{
  let q=add(EMPTY_QUEUE,input('no-start'),'h')
  q=claim({...q,enabled:true},'h')
  assert.equal(q.tasks[0]?.attempts?.length,1)
  q=releaseUnsubmittedClaim(q,'h')
  assert.equal(q.tasks[0]?.status,'pending')
  assert.equal(q.tasks[0]?.attempts?.length,0)
  assert.deepEqual(q.activeIds,[])
})
test('T08: duplicated or malformed Attempt data is rejected without queue reset',()=>{
  const q=add(EMPTY_QUEUE,input('bad'),'h')
  const attempt={id:'a',status:'running',createdAt:1,updatedAt:2,sessionId:'s'}
  assert.equal(decode({version:1,queue:{...q,tasks:[{
    ...q.tasks[0],attempts:[attempt,attempt]
  }]}}),undefined)
  assert.equal(decode({version:1,queue:{...q,tasks:[{
    ...q.tasks[0],attempts:[{...attempt,updatedAt:'bad'}]
  }]}}),undefined)
})

test('T10 RED: queue exposes a consistent summary including unresolved tasks',async()=>{
  const queueModule=await import('../src/queue.ts')
  const summarize=(queueModule as unknown as Record<string,unknown>).summarizeQueue
  assert.equal(typeof summarize,'function')
  let q=add(add(EMPTY_QUEUE,input('A'),'a'),input('B'),'b')
  q={...q,sessionActivity:['old-s'],tasks:q.tasks.map(t=>t.id==='a'
    ?{...t,status:'blocked' as const}:t)}
  const s=(summarize as (queue:typeof EMPTY_QUEUE)=>{unresolved:number;pending:number;starting:number;observedRunning:number;externalActivity:number;occupied:number})(q)
  assert.deepEqual(s,{unresolved:1,pending:1,starting:0,observedRunning:0,externalActivity:1,occupied:1})
})
