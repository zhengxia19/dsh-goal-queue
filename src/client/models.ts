import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-commands'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sameModel, type TaskModelSelection } from '../model-policy.ts'

// design §9: the dispatch phase domain (Task/Attempt optional fields live in queue.ts).
export type { AttemptPhase, DispatchPhase } from '../queue.ts'

export interface TaskModels {
  catalog(): Promise<ModelCatalog>
  select(sessionId: SessionId, selection: TaskModelSelection): Promise<TaskModelSelection>
  title(session: SessionFace, line: string): Promise<{matched:boolean;error?:string}>
}
export class HostTaskModels implements TaskModels {
  private readonly ctx: Context
  constructor(ctx: Context) { this.ctx=ctx }
  async catalog(): Promise<ModelCatalog> {
    const result = await this.ctx.remote.session.modelCatalog()
    if (!result.ok) throw Error(result.error.message)
    return result.value
  }
  async select(sessionId: SessionId, selection: TaskModelSelection): Promise<TaskModelSelection> {
    const result = await this.ctx.remote.session.selectModel({sessionId, ...selection})
    if (!result.ok) throw Error(result.error.message)
    return result.value.selected
  }
  async title(session:SessionFace,line:string):Promise<{matched:boolean;error?:string}> {
    // Session.command() drops CommandExecution.result; retain the authoritative outcome.
    const response=await this.ctx.remote.commands.execute(session.sessionId,line,[])
    if(!response.ok)throw Error('标题命令提交结果未确认；请核实原 Session')
    if(!response.value)return {matched:false}
    const result=response.value.result
    return {matched:true,...result.kind==='error'?{error:result.text}: {}}
  }
}
/** A successful RPC alone is insufficient: wait for the same Session's durable selection projection. */
export async function confirmTaskModel(session: SessionFace, selection: TaskModelSelection, valid: () => boolean, timeoutMs = 5000): Promise<void> {
  const projection = session.projections.faceOf('modelSelection')
  await new Promise<void>((resolve, reject) => {
    let stop = () => {}
    const timer = setTimeout(() => { stop(); reject(Error('模型选择投影未确认；请核实原 Session')) }, timeoutMs)
    const check = () => {
      if (!valid()) { clearTimeout(timer); stop(); reject(Error('连接已切换，模型选择结果不再可信')); return }
      const state = projection.getSnapshot() as {next?: TaskModelSelection | null} | undefined
      if (sameModel(state?.next, selection)) { clearTimeout(timer); stop(); resolve() }
    }
    stop = projection.subscribe(check)
    check()
  })
}
