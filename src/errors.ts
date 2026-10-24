/** Unified error codes (design §5). Client maps by code, never parses message text. */
export type QueueErrorCode =
  | 'DIRECTORY_READ_FAILED' | 'NOT_BOOTED' | 'CONNECTION_CHANGED'
  | 'GOAL_IDENTITY_MISMATCH' | 'SESSION_STILL_RUNNING' | 'SESSION_NOT_FOUND'
  | 'REQUEUE_EDIT_NOT_PROVEN' | 'SUBMISSION_UNKNOWN' | 'CAPACITY_FULL'
  | 'UNRESOLVED_BLOCKING' | 'NOT_AUTHORIZED' | 'TASK_NOT_FOUND'

export class QueueError extends Error {
  readonly code: QueueErrorCode
  constructor(code: QueueErrorCode, message: string) {
    super(message)
    this.name = 'QueueError'
    this.code = code
  }
}
