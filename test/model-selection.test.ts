import {test} from 'node:test'
import assert from 'node:assert/strict'
import {add,claim,decode,edit,EMPTY_QUEUE,recover,setTaskModel,updateActive,type QueueSettings} from '../src/queue.ts'
import {resolveTaskModel} from '../src/model-policy.ts'
import {Coordinator} from '../src/client/coordinator.ts'
import {confirmTaskModel,HostTaskModels,type TaskModels} from '../src/client/models.ts'
import {TEST_MODEL,TEST_CATALOG} from './model-fixture.ts'

test('task selection survives CAS-shaped JSON roundtrip, edit, recovery and legacy decoding',()=>{
  let q=add(EMPTY_QUEUE,{title:'',prompt:'work',workspaceId:'ws',goalMode:true,modelSelection:TEST_MODEL},'a')
  assert.deepEqual(decode(JSON.parse(JSON.stringify({version:1,queue:q})))?.queue.tasks[0]?.modelSelection,TEST_MODEL)
  q=claim({...q,enabled:true},'a');q=setTaskModel(q,'a',TEST_MODEL,'precheck')
  assert.deepEqual(recover(q).tasks[0]?.modelSelection,TEST_MODEL)
  assert.throws(()=>updateActive(q,'a',{modelSelection:TEST_MODEL}),/身份/)
  assert.throws(()=>setTaskModel({...q,tasks:[{...q.tasks[0]!,sessionId:'existing'}]},'a',TEST_MODEL,'precheck'),/已有 Session/)
  const legacy=add(EMPTY_QUEUE,{title:'',prompt:'work',workspaceId:'ws',goalMode:true},'old')
  assert.equal(decode({version:1,queue:legacy})?.queue.tasks[0]?.modelSelection,undefined)
  assert.equal(decode({version:1,queue:{...legacy,tasks:[{...legacy.tasks[0],modelSelection:{provider:'p'}}]}}),undefined)
  assert.equal(edit({...q,activeIds:[],activeId:null,tasks:[{...q.tasks[0]!,status:'pending'}]},'a',{title:'',prompt:'work',workspaceId:'ws',goalMode:true}).tasks[0]?.modelSelection,undefined)
})

test('catalog enforces exact model capabilities and never replaces unavailable selection',()=>{
  assert.deepEqual(resolveTaskModel(TEST_CATALOG),TEST_MODEL)
  assert.deepEqual(resolveTaskModel(TEST_CATALOG,{provider:TEST_MODEL.provider,model:TEST_MODEL.model}),TEST_MODEL)
  assert.deepEqual(resolveTaskModel({...TEST_CATALOG,default:{...TEST_MODEL,reasoningEffort:'high'}},TEST_MODEL),TEST_MODEL,'saved task must not follow later Host default changes')
  assert.throws(()=>resolveTaskModel(TEST_CATALOG,{...TEST_MODEL,reasoningEffort:'max'}),/推理强度/)
  assert.throws(()=>resolveTaskModel(TEST_CATALOG,{...TEST_MODEL,model:'gone'}),/不可用/)
  assert.throws(()=>resolveTaskModel(TEST_CATALOG,{...TEST_MODEL,model:'plain'}),/不支持/)
  assert.deepEqual(resolveTaskModel(TEST_CATALOG,{provider:TEST_MODEL.provider,model:'plain'}),{provider:TEST_MODEL.provider,model:'plain'})
})

test('official model gateway propagates read, business and unknown-write failures',async()=>{
  const models=new HostTaskModels({remote:{session:{modelCatalog:async()=>({ok:false,error:{message:'catalog unavailable'}}),selectModel:async()=>{throw Error('response lost')}}}} as never)
  await assert.rejects(models.catalog(),/catalog unavailable/)
  await assert.rejects(models.select('s' as never,TEST_MODEL),/response lost/)
})

test('title gateway preserves known error results and fails closed on uncertain RPC outcomes',async()=>{
  let response:unknown={ok:true,value:{commandId:'cmd-1',result:{kind:'error',text:'finish=max-tokens'}}}
  const seen:unknown[][]=[]
  const models=new HostTaskModels({remote:{commands:{execute:async(...args:unknown[])=>{seen.push(args);return response}}}} as never)
  const face={sessionId:'test-session'}
  assert.deepEqual(await models.title(face as never,'/goal-queue-title {}'),{matched:true,error:'finish=max-tokens'})
  assert.deepEqual(seen[0],['test-session','/goal-queue-title {}',[]])
  response={ok:true,value:undefined};assert.deepEqual(await models.title(face as never,'/goal-queue-title {}'),{matched:false})
  response={ok:false,error:{message:'transport lost'}}
  await assert.rejects(models.title(face as never,'/goal-queue-title {}'),/未确认/)
})

test('model confirmation waits for durable projection, rejects mismatches/timeouts and generation reset',async()=>{
  let next:unknown=null,listener=()=>{},stops=0
  const face={projections:{faceOf:()=>({getSnapshot:()=>({next}),subscribe:(fn:()=>void)=>{listener=fn;return()=>{stops++}}})}}
  const pending=confirmTaskModel(face as never,TEST_MODEL,()=>true,100)
  next={...TEST_MODEL,reasoningEffort:'high'};listener()
  next=TEST_MODEL;listener();await pending;assert.equal(stops,1)
  next=null
  await assert.rejects(confirmTaskModel(face as never,TEST_MODEL,()=>true,5),/投影未确认/)
  await assert.rejects(confirmTaskModel(face as never,TEST_MODEL,()=>false,100),/连接已切换/)
})

const settle=async()=>{for(let i=0;i<18;i++)await new Promise(r=>setTimeout(r,0))}
function fixture(options:{failSelect?:boolean;differentSelection?:boolean;invalidModel?:boolean;failFreeze?:boolean;titleFailure?:boolean;resetSelect?:boolean;unknownTitle?:boolean;switchDuringTitle?:boolean}={}){
  const listeners=new Set<()=>void>(),events:string[]=[],commands:string[]=[],savedModels:unknown[]=[]
  let value:QueueSettings={version:1,queue:add(add(EMPTY_QUEUE,{title:'',prompt:'work',workspaceId:'ws',goalMode:true,generateTitle:true,...options.invalidModel?{modelSelection:{...TEST_MODEL,model:'missing'}}:{}},'a'),{title:'',prompt:'later',workspaceId:'ws',goalMode:true},'b')}
  let next=TEST_MODEL,creates=0
  const settings={getSnapshot:()=>({status:'ready',value}),subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)}},failClosed:()=>{},set:async(_key:string,q:typeof EMPTY_QUEUE)=>{
    if(q.tasks[0]?.modelSelection){events.push('freeze');savedModels.push(q.tasks[0].modelSelection);if(options.failFreeze)throw Error('freeze CAS unknown')}
    value={version:1,queue:q};for(const fn of listeners)fn()
  }}
  const face={getSnapshot:()=>({running:false,awaitingFirstTurn:false,lastAgentError:null}),subscribe:()=>()=>{},projections:{faceOf:(key:string)=>({getSnapshot:()=>key==='modelSelection'?{next}:null,subscribe:()=>()=>{}})},command:async(line:string)=>{commands.push(line);events.push(line.startsWith('/goal-queue-title')?'title':'goal');return options.titleFailure&&line.startsWith('/goal-queue-title')?{ok:false,error:{message:'finish=max-tokens'}}:{ok:true,value:{matched:true}}}}
  const sessions={create:async()=>{events.push('create');creates++;return 'new-session'},retain:()=>({ready:Promise.resolve(),binding:{session:face},release(){}})}
  const models:TaskModels={catalog:async()=>TEST_CATALOG,select:async(_id,selection)=>{events.push('select');if(options.resetSelect)await coordinator.connectionReset();if(options.failSelect)throw Error('selection result unknown');next=selection as typeof TEST_MODEL;return options.differentSelection?{...selection,reasoningEffort:'high'}:selection},title:async(_session,line)=>{const r=await face.command(line);if(options.unknownTitle)throw Error('title result unknown');if(options.switchDuringTitle)next={...TEST_MODEL,reasoningEffort:'high'};return r.ok?{matched:true}:{matched:true,error:r.error!.message}}}
  const coordinator=new Coordinator(sessions as never,{list:{getSnapshot:()=>({items:[{workspaceId:'ws'}]})}} as never,settings as never,()=>true,undefined,models)
  return {coordinator,events,commands,savedModels,value:()=>value,creates:()=>creates}
}

test('legacy dispatch freezes complete model before creation, confirms selection then titles and submits once',async()=>{
  const x=fixture();try{x.coordinator.start();await settle();await x.coordinator.enable(true);await settle()
    assert.deepEqual(x.events.filter(e=>e!=='freeze'),['create','select','title','goal'])
    assert.equal(x.events[0],'freeze')
    assert.deepEqual(x.value().queue.tasks[0]?.modelSelection,TEST_MODEL)
    assert.deepEqual(JSON.parse(x.commands[0]!.slice('/goal-queue-title '.length)).modelSelection,TEST_MODEL)
    assert.equal(x.commands.filter(c=>c==='/goal work').length,1)
  }finally{x.coordinator.dispose()}
})

for(const option of ['failSelect','differentSelection','invalidModel','failFreeze','resetSelect'] as const)test(`model ${option} prevents title/task submission and later dispatch`,async()=>{
  const x=fixture({[option]:true});try{x.coordinator.start();await settle();await x.coordinator.enable(true);await settle()
    assert.equal(x.commands.length,0)
    assert.equal(x.creates(),option==='invalidModel'||option==='failFreeze'?0:1)
    assert.equal(x.value().queue.enabled,false)
    assert.equal(x.value().queue.tasks[1]?.status,'pending')
  }finally{x.coordinator.dispose()}
})

test('known optional title failure preserves diagnostics and submits task only once',async()=>{
  const x=fixture({titleFailure:true});try{x.coordinator.start();await settle();await x.coordinator.enable(true);await settle()
    assert.equal(x.commands.length,2);assert.equal(x.commands[1],'/goal work')
    // U05: the title diagnostic is bound to the task (titleError), never the global error bar.
    assert.match(x.value().queue.tasks[0]?.titleError??'',/finish=max-tokens/)
    assert.equal(x.value().queue.error,'','known title failure must not pollute q.error')
  }finally{x.coordinator.dispose()}
})

for(const option of ['unknownTitle','switchDuringTitle'] as const)test(`${option} stops dispatch after auxiliary request without submitting Goal`,async()=>{
  const x=fixture({[option]:true});try{x.coordinator.start();await settle();await x.coordinator.enable(true);await settle()
    assert.equal(x.commands.length,1);assert.ok(x.commands[0]?.startsWith('/goal-queue-title '))
    assert.equal(x.value().queue.enabled,false);assert.equal(x.value().queue.tasks[0]?.status,'interrupted')
    assert.equal(x.value().queue.tasks[1]?.status,'pending')
  }finally{x.coordinator.dispose()}
})
