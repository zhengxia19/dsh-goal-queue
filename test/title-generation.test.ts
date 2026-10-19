import { test } from 'node:test'
import assert from 'node:assert/strict'
import { add, decode, edit, EMPTY_QUEUE } from '../src/queue.ts'
import { parseTitlePayload, boundedTitle } from '../src/title-policy.ts'
import { registerTitleCommand } from '../src/title-command.ts'
import { TEST_MODEL } from './model-fixture.ts'

const input={workspaceId:'ws',prompt:'请完成项目测试和代码检查',goalMode:true,title:''}

test('AI title opt-in and limit default are persisted without breaking legacy tasks',()=>{
  const a=add(EMPTY_QUEUE,input,'a')
  assert.equal(a.tasks[0]?.generateTitle,false)
  assert.equal(a.tasks[0]?.titleMaxChars,24)
  const b=edit(a,'a',{...input,generateTitle:true,titleMaxChars:12})
  assert.equal(b.tasks[0]?.generateTitle,true)
  assert.equal(b.tasks[0]?.titleMaxChars,12)
  assert.equal(decode({version:1,queue:b})?.queue.tasks[0]?.generateTitle,true)
  assert.equal(decode({version:1,queue:{...b,tasks:[{...b.tasks[0],generateTitle:undefined,titleMaxChars:undefined}]}})?.queue.tasks[0]?.generateTitle,undefined)
  assert.throws(()=>add(EMPTY_QUEUE,{...input,titleMaxChars:81},'x'),/8–80/)
})

test('model title input rejects invalid bounds and overlong prompts',()=>{
  assert.deepEqual(parseTitlePayload(JSON.stringify({prompt:'任务说明',maxChars:24,modelSelection:TEST_MODEL})),{prompt:'任务说明',maxChars:24,modelSelection:TEST_MODEL})
  for(const n of [0,7,81,1.5,'24'])assert.throws(()=>parseTitlePayload(JSON.stringify({prompt:'a',maxChars:n})))
  assert.throws(()=>parseTitlePayload(JSON.stringify({prompt:'a'.repeat(8001),maxChars:24})),/8000/)
  assert.throws(()=>parseTitlePayload('invalid'))
})

test('title model output respects Unicode character cap and discards explanations',()=>{
  assert.equal(boundedTitle('**支持中文标题生成和长度约束**\n额外说明',8),'支持中文标题生成')
  assert.equal(boundedTitle('“测试部署和发布”',12),'测试部署和发布')
  assert.equal(Array.from(boundedTitle('😀'.repeat(30),8)).length,8)
  assert.throws(()=>boundedTitle('   ',12),/有效标题/)
})

test('Host title command performs separate tool-free LLM call and native title rename',async()=>{
  let handler: ((x:any)=>Promise<any>)|undefined
  let streamArgs:any
  let title=''
  const agentSession={id:'task-session',snapshotEvents:()=>[{type:'model/selection',data:TEST_MODEL}], append:()=>{throw Error('must not append prompt')}}
  const ctx={
    commands:{register(def:any){handler=def.handler;assert.equal(def.recordInput,false)}},
    agentDefaultModel:{currentSelection:()=>({provider:'test-provider',model:'test-model'})},
    llm:{async prepareCall(config:any){
      assert.equal(config.maxTokens,undefined)
      assert.deepEqual(config,TEST_MODEL)
      return {
        config,
        stream(options:any){
          streamArgs=options
          return (async function*(){
            yield {type:'text-delta',index:0,text:'生成的标题不得超出指定长度'}
            yield {type:'finish',reason:{kind:'stop'}}
          })()
        }
      }
    }},
    sessionTitle:{rename(session:any,s:string){assert.equal(session,agentSession);title=s}}
  }
  registerTitleCommand(ctx as never)
  assert.ok(handler)
  const result=await handler!({
    agent:{session:agentSession},rawInput:JSON.stringify({prompt:'请编写并测试系统',maxChars:8,modelSelection:TEST_MODEL}),
    signal:new AbortController().signal
  })
  assert.equal(result.kind,'success')
  assert.equal(Array.from(title).length,8)
  assert.equal(streamArgs.tools,undefined)
  assert.equal(streamArgs.sessionId,undefined)
  assert.equal(streamArgs.purpose,'session-title')
  assert.equal(streamArgs.messages.length,1)
  assert.equal(streamArgs.system.includes('task-title generator'),true)
})

for(const effort of ['off','medium','high'])test(`title inherits task ${effort} effort and model budget without a fixed token cap`,async()=>{
  const selected={...TEST_MODEL,reasoningEffort:effort}
  let handler:any,request:any,renamed=0
  const ctx={commands:{register(d:any){handler=d.handler}},llm:{prepareCall:async(config:any)=>{
    assert.deepEqual(config,selected)
    return {config:{...config,maxTokens:12288},stream:async function*(options:any){request=options;yield {type:'text-delta',index:0,text:'真实标题'};yield {type:'finish',reason:{kind:'stop'}}}}
  }},sessionTitle:{rename(){renamed++}}}
  registerTitleCommand(ctx as never)
  await handler({agent:{session:{snapshotEvents:()=>[{type:'model/selection',data:selected}]}},rawInput:JSON.stringify({prompt:'工作',maxChars:24,modelSelection:selected}),signal:new AbortController().signal})
  assert.equal(request.maxTokens,12288);assert.equal(request.reasoningEffort,effort)
  assert.equal(request.tools,undefined);assert.equal(request.sessionId,undefined);assert.equal(renamed,1)
})

for(const outcome of ['max-tokens','error','aborted','tool-calls','missing','empty','tool-content','mismatch'] as const)test(`title ${outcome} fails without rename, exposes safe reason and never retries`,async()=>{
  let handler:any,calls=0,renames=0
  const selected=TEST_MODEL
  const ctx={commands:{register(d:any){handler=d.handler}},llm:{prepareCall:async(config:any)=>({config,stream:async function*(){
    calls++
    if(outcome==='tool-content')yield {type:'tool-call-start',index:0,id:'x',name:'forbidden'}
    else if(outcome!=='empty')yield {type:'text-delta',index:0,text:'测试标题'}
    yield {type:'usage',usage:{inputTokens:10,outputTokens:128,reasoningTokens:120}}
    if(outcome!=='missing')yield {type:'finish',reason:outcome==='error'||outcome==='aborted'?{kind:outcome,failure:{code:'RATE_LIMIT',message:'private upstream text should not leak'}}:{kind:['empty','tool-content'].includes(outcome)?'stop':outcome}}
  }})},sessionTitle:{rename(){renames++}}}
  registerTitleCommand(ctx as never)
  const pending=handler({agent:{session:{snapshotEvents:()=>[{type:'model/selection',data:outcome==='mismatch'?{...selected,model:'other'}:selected}]}},rawInput:JSON.stringify({prompt:'工作',maxChars:24,modelSelection:selected}),signal:new AbortController().signal})
  if(outcome==='mismatch')await assert.rejects(pending,/不一致/)
  else {
    const result=await pending
    assert.equal(result.kind,'error');assert.doesNotMatch(result.text,/private upstream/)
    if(['max-tokens','error','aborted','tool-calls','missing'].includes(outcome))assert.match(result.text,new RegExp(`finish=${outcome}`))
  }
  assert.equal(renames,0);assert.equal(calls,outcome==='mismatch'?0:1)
})

test('uncertain title persistence is not degraded into a known optional model failure',async()=>{
  let handler:any
  registerTitleCommand({commands:{register(d:any){handler=d.handler}},llm:{prepareCall:async(config:any)=>({config,stream:async function*(){yield {type:'text-delta',index:0,text:'标题'};yield {type:'finish',reason:{kind:'stop'}}}})},sessionTitle:{rename(){throw Error('title write unknown')}}} as never)
  await assert.rejects(handler({agent:{session:{snapshotEvents:()=>[{type:'model/selection',data:TEST_MODEL}]}},rawInput:JSON.stringify({prompt:'工作',maxChars:24,modelSelection:TEST_MODEL}),signal:new AbortController().signal}),/write unknown/)
})
