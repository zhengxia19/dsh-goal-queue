/** Authoritative running baseline (design §6.3): running facts come only from remote.session.list. */
import type { Context } from '@deepseek-ai/cordis'
import { QueueError } from '../errors.ts'

export interface DirectoryRow {
  sessionId: string
  running: boolean
  origin?: 'subagent'
  cwd?: string
  updatedAt: number
}
export interface DirectorySnapshot { rows: readonly DirectoryRow[]; syncedAt: number }
export interface SessionDirectory { list(signal?: AbortSignal): Promise<DirectorySnapshot> }

/** SessionSummary carries no title: titles stay a best-effort syncTitles concern. */
export class HostSessionDirectory implements SessionDirectory {
  private readonly ctx: Context
  constructor(ctx: Context) { this.ctx = ctx }
  async list(signal?: AbortSignal): Promise<DirectorySnapshot> {
    const r = await this.ctx.remote.session.list({}, signal)
    if (!r.ok) throw new QueueError('DIRECTORY_READ_FAILED', '无法读取运行会话列表：'+r.error.message)
    return {
      rows: r.value.items.map(s => ({
        sessionId: s.sessionId,
        running: s.running,
        ...(s.origin === 'subagent' ? { origin: 'subagent' as const } : {}),
        ...(s.cwd !== undefined ? { cwd: s.cwd } : {}),
        updatedAt: s.updatedAt,
      })),
      syncedAt: Date.now(),
    }
  }
}
