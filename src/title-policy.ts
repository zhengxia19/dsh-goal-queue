/** Pure title input/output policy. Auxiliary model calls never enter the task's Agent inbox. */
export const DEFAULT_TITLE_CHARS = 24
export const MIN_TITLE_CHARS = 8
export const MAX_TITLE_CHARS = 80
export const MAX_TITLE_INPUT_CHARS = 8000

export interface TitlePayload { maxChars: number; prompt: string }

export function parseTitlePayload(raw: string): TitlePayload {
  let item: unknown
  try { item = JSON.parse(raw.trim()) } catch { throw Error('标题请求格式无效') }
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('标题请求格式无效')
  const data = item as Record<string, unknown>
  if (typeof data.maxChars !== 'number' || !Number.isInteger(data.maxChars)
    || data.maxChars < MIN_TITLE_CHARS || data.maxChars > MAX_TITLE_CHARS)
    throw Error('标题长度必须是 8–80 的整数')
  if (typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > MAX_TITLE_INPUT_CHARS)
    throw Error('标题题词为空或超过 8000 字符')
  return { maxChars: data.maxChars, prompt: data.prompt }
}

/** Enforce a code-point cap even when the model ignores the requested length. */
export function boundedTitle(text: string, maxChars: number): string {
  if (!Number.isInteger(maxChars) || maxChars < MIN_TITLE_CHARS || maxChars > MAX_TITLE_CHARS)
    throw Error('标题长度必须是 8–80 的整数')
  const first = text.split(/\r?\n/u).map(part => part.trim()).find(Boolean) ?? ''
  const cleaned = first
    .replace(/^\*{1,3}(.+?)\*{1,3}$/u, '$1')
    .replace(/^[\s"“”‘’'「」『』]+|[\s"“”‘’'「」『』]+$/gu, '')
    .replace(/[\u0000-\u001f\u007f]/gu, '')
    .trim()
  const bounded = Array.from(cleaned).slice(0, maxChars).join('').trim()
  if (!bounded) throw Error('模型未生成有效标题')
  return bounded
}
