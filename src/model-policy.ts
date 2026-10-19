/** Complete per-task routing; reasoning identifiers belong to the Host catalog. */
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'

export interface TaskModelSelection { provider: string; model: string; reasoningEffort?: string }
export function isModelSelection(value: unknown): value is TaskModelSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return typeof v.provider === 'string' && Boolean(v.provider.trim())
    && typeof v.model === 'string' && Boolean(v.model.trim())
    && (v.reasoningEffort === undefined || (typeof v.reasoningEffort === 'string' && Boolean(v.reasoningEffort.trim())))
}
export function sameModel(a: TaskModelSelection | null | undefined, b: TaskModelSelection): boolean {
  return Boolean(a && a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort)
}
/** Resolve omission once, then persist the concrete selection before creating a Session. */
export function resolveTaskModel(catalog: ModelCatalog, selection = catalog.default): TaskModelSelection {
  if (!isModelSelection(selection)) throw Error('任务模型配置无效')
  const model = catalog.groups.find(p => p.id === selection.provider)?.models.find(m => m.id === selection.model)
  if (!model || !catalog.routableProviders.includes(selection.provider)) throw Error('任务模型当前不可用；请检查 Host 模型目录')
  const effort = selection.reasoningEffort ?? model.reasoning?.defaultEffort
  if (model.reasoning) {
    if (!effort || !model.reasoning.efforts.some(e => e.id === effort)) throw Error('请选择该模型支持的推理强度')
  } else if (effort !== undefined) throw Error('该模型不支持推理强度设置')
  return { provider: selection.provider, model: selection.model, ...(effort === undefined ? {} : { reasoningEffort: effort }) }
}
