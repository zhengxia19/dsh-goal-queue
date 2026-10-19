import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import type { TaskModels } from '../src/client/models.ts'
export const TEST_MODEL = {provider:'test-provider',model:'test-model',reasoningEffort:'medium'}
export const TEST_CATALOG:ModelCatalog = {default:TEST_MODEL,routableProviders:['test-provider'],failures:[],groups:[{
  id:'test-provider',name:'Test',models:[{id:'test-model',name:'Test model',reasoning:{defaultEffort:'medium',efforts:[{id:'off',name:'Off'},{id:'medium',name:'Medium'},{id:'high',name:'High'}]}},{id:'plain',name:'Plain'}]
}]}
export const testModels:TaskModels={catalog:async()=>TEST_CATALOG,select:async(_id,s)=>s,title:async(session,line)=>{
  const r=await session.command(line)
  return r.ok?{matched:r.value.matched}:{matched:true,error:r.error.message}
}}
