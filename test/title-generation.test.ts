import { test } from 'node:test'
import assert from 'node:assert/strict'
import { add, decode, edit, EMPTY_QUEUE } from '../src/queue.ts'
import { parseTitlePayload, boundedTitle } from '../src/title-policy.ts'
import { registerTitleCommand } from '../src/title-command.ts'

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
  assert.deepEqual(parseTitlePayload(JSON.stringify({prompt:'任务说明',maxChars:24})),{prompt:'任务说明',maxChars:24})
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
  const agentSession={id:'task-session', append:()=>{throw Error('must not append prompt')}}
  const ctx={
    commands:{register(def:any){handler=def.handler;assert.equal(def.recordInput,false)}},
    agentDefaultModel:{currentSelection:()=>({provider:'test-provider',model:'test-model'})},
    llm:{async prepareCall(config:any){
      assert.equal(config.maxTokens,128)
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
    agent:{session:agentSession},rawInput:JSON.stringify({prompt:'请编写并测试系统',maxChars:8}),
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
