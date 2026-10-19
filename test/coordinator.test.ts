import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Coordinator } from '../src/client/coordinator.ts'
import { TEST_MODEL, testModels } from './model-fixture.ts'
import { EMPTY_QUEUE, add, type QueueSettings } from '../src/queue.ts'
const pause = async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setTimeout(resolve,0))}
const item=(label:string,goalMode=true)=>({title:label,workspaceId:'ws',prompt:`build ${label}`,goalMode})
class MockFace {
  private listeners=new Set<()=>void>()
  private goalListeners=new Set<()=>void>()
  state={running:false,awaitingFirstTurn:false,lastAgentError:null as string|null}
  goal: {goal:{id:string,objective:string,phase:string}} | null=null
  calls:string[]=[]
  rejectTitle=false
  projections={faceOf:(key:string)=>({getSnapshot:()=>key==='modelSelection'?{next:TEST_MODEL}:this.goal,subscribe:(fn:()=>void)=>{this.goalListeners.add(fn);return()=>{this.goalListeners.delete(fn)}}})}
  getSnapshot=()=>this.state
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn)}}
  emit(){for(const fn of this.listeners)fn();for(const fn of this.goalListeners)fn()}
  command=async(line:string)=>{this.calls.push(line);if(line.startsWith('/goal-queue-title '))return {ok:true,value:{matched:!this.rejectTitle}};this.goal={goal:{id:'goal-'+line,objective:line.slice(6),phase:'active'}};this.emit();return {ok:true,value:{matched:true}}}
  prompt=async()=>{this.calls.push('prompt');this.state.running=true;this.emit();return {ok:true,value:{accepted:true}}}
  rename=async()=>({ok:true})
}
class MockSettings {
  value:QueueSettings
  listeners=new Set<()=>void>()
  failOnStatus: string | null = null
  constructor(queue=EMPTY_QUEUE){this.value={version:1,queue}}
  getSnapshot=()=>({status:'ready',value:this.value})
  failClosed(_reason:string){}
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn)}}
  async set(_key:string, queue:typeof EMPTY_QUEUE){if(this.failOnStatus && queue.tasks.some(t=>t.status===this.failOnStatus)) throw Error('模拟状态写入失败');this.value={version:1,queue};for(const listener of this.listeners)listener()}
}
function system(settings:MockSettings){
  const faces:MockFace[]=[]
  const sessions={
    async create(){faces.push(new MockFace());return `session-${faces.length}`},
    binding(id:string){return {session:faces[Number(id.slice(8))-1]}},
    retain(id:string){const face=faces[Number(id.slice(8))-1];return {binding:{session:face},ready:Promise.resolve({session:face}),release(){}}},
  }
  const workspaces={list:{getSnapshot:()=>({items:[{workspaceId:'ws',title:'ws',path:'/tmp/ws'}]})}}
  const coordinator=new Coordinator(sessions as never, workspaces as never, settings as never, ()=>true,undefined,testModels)
  return {faces,coordinator}
}
test('goal-complete waits for actual idle, then dispatches second workspace task',async()=>{
  const q={...add(add(EMPTY_QUEUE,item('A'),'a'),item('B',false),'b'),enabled:true}
  const settings=new MockSettings(q), {faces,coordinator}=system(settings);coordinator.start();await pause();await coordinator.enable(true);await pause()
  assert.equal(faces.length,1); assert.equal(settings.value.queue.activeId,'a')
  faces[0]!.state.running=true;faces[0]!.emit();await pause()
  faces[0]!.goal!.goal.phase='complete';faces[0]!.emit();await pause()
  assert.equal(faces.length,1,'the next task must not launch before goal becomes idle')
  faces[0]!.state.running=false;faces[0]!.emit();await pause()
  assert.equal(settings.value.queue.tasks[0]!.status,'completed')
  assert.equal(faces.length,2)
  faces[1]!.state.running=false;faces[1]!.emit();await pause()
  assert.equal(settings.value.queue.tasks[1]!.status,'completed')
  coordinator.dispose()
})
test('goal blocker halts pipeline and does not start next task',async()=>{
  const q={...add(add(EMPTY_QUEUE,item('A'),'a'),item('B'),'b'),enabled:true}
  const settings=new MockSettings(q), {faces,coordinator}=system(settings);coordinator.start();await pause();await coordinator.enable(true);await pause()
  faces[0]!.goal!.goal.phase='blocked';faces[0]!.emit();await pause()
  assert.equal(settings.value.queue.enabled,false);assert.equal(settings.value.queue.tasks[0]?.status,'blocked');assert.equal(faces.length,1)
  coordinator.dispose()
})
test('normal task requires witnessed running before idle',async()=>{
  const q={...add(EMPTY_QUEUE,item('A',false),'a'),enabled:true}
  const settings=new MockSettings(q),{faces,coordinator}=system(settings);coordinator.start();await pause();await coordinator.enable(true);await pause()
  assert.equal(settings.value.queue.tasks[0]?.status,'running')
  faces[0]!.state.running=false;faces[0]!.emit();await pause()
  // The mocked prompt emits a running event before returning; that is a valid witness.
  assert.equal(settings.value.queue.tasks[0]?.status,'completed')
  coordinator.dispose()
})
test('reopen never automatically resumes unfinished goals',async()=>{
  const initial=add(EMPTY_QUEUE,item('A'),'a')
  const q={...initial,enabled:true,activeId:'a',tasks:[{...initial.tasks[0]!,status:'running' as const,sessionId:'s-old'}]}
  const settings=new MockSettings(q),{faces,coordinator}=system(settings);coordinator.start();await pause()
  assert.equal(settings.value.queue.enabled,false);assert.equal(settings.value.queue.tasks[0]?.status,'interrupted');assert.equal(faces.length,0)
  coordinator.dispose()
})
test('an ordinary task is not lost after prompt acceptance and idle',async()=>{
  const q={...add(EMPTY_QUEUE,item('fast',false),'fast'),enabled:true}
  const settings=new MockSettings(q),{faces,coordinator}=system(settings)
  coordinator.start()
  await pause();await coordinator.enable(true);await pause()
  assert.equal(faces.length,1)
  faces[0]!.state.running=false;faces[0]!.emit();await pause()
  assert.equal(settings.value.queue.tasks[0]?.status,'completed')
  coordinator.dispose()
})
test('connection reset drops held session and marks old active goal interrupted after settings load',async()=>{
  const initial=add(EMPTY_QUEUE,item('A'),'a')
  const q={...initial,enabled:true,activeId:'a',tasks:[{...initial.tasks[0]!,status:'running' as const,sessionId:'old'}]}
  const settings=new MockSettings(q),{coordinator,faces}=system(settings)
  coordinator.start();await pause()
  await coordinator.connectionReset();await pause()
  assert.equal(settings.value.queue.enabled,false)
  assert.equal(settings.value.queue.tasks[0]?.status,'interrupted')
  assert.equal(faces.length,0)
  coordinator.dispose()
})

test('T04 Goal completion state write failure blocks the following queue task', async()=>{
  const q=add(add(EMPTY_QUEUE,item('A'),'a'),item('B'),'b')
  const settings=new MockSettings(q), {faces,coordinator}=system(settings)
  coordinator.start();await pause();await coordinator.enable(true);await pause()
  faces[0]!.state.running=true;faces[0]!.emit();await pause()
  settings.failOnStatus='completed'
  faces[0]!.goal!.goal.phase='complete';faces[0]!.state.running=false;faces[0]!.emit();await pause()
  assert.equal(faces.length,1)
  assert.equal(settings.value.queue.enabled,false)
  assert.equal(settings.value.queue.tasks[0]?.status,'interrupted')
  coordinator.dispose()
})

test('T04 command accepted but running-state commit lost blocks subsequent tasks', async()=>{
  const q=add(add(EMPTY_QUEUE,item('A'),'a'),item('B'),'b')
  const settings=new MockSettings(q), {faces,coordinator}=system(settings)
  settings.failOnStatus='running'
  coordinator.start();await pause();await coordinator.enable(true);await pause()
  assert.equal(faces.length,1)
  assert.equal(settings.value.queue.enabled,false)
  assert.equal(settings.value.queue.tasks[0]?.status,'interrupted')
  coordinator.dispose()
})

test('AI title opt-in uses dedicated command before native Goal and does not add a task prompt',async()=>{
  const q=add(EMPTY_QUEUE,{...item('goal'),title:'',generateTitle:true,titleMaxChars:16},'g')
  const settings=new MockSettings(q),{faces,coordinator}=system(settings)
  coordinator.start();await pause();await coordinator.enable(true);await pause()
  assert.equal(faces.length,1)
  assert.equal(faces[0]!.calls.length,2)
  assert.equal(faces[0]!.calls[0]!.startsWith('/goal-queue-title '),true)
  assert.deepEqual(JSON.parse(faces[0]!.calls[0]!.slice('/goal-queue-title '.length)),{
    maxChars:16,prompt:'build goal',modelSelection:TEST_MODEL
  })
  assert.equal(faces[0]!.calls[1],'/goal build goal')
  assert.equal(faces[0]!.calls.includes('prompt'),false)
  coordinator.dispose()
})
test('AI title opt-out preserves ordinary submission, without title model request',async()=>{
  const q=add(EMPTY_QUEUE,item('ordinary',false),'g')
  const settings=new MockSettings(q),{faces,coordinator}=system(settings)
  coordinator.start();await pause();await coordinator.enable(true);await pause()
  assert.deepEqual(faces[0]!.calls,['prompt'])
  coordinator.dispose()
})
