import { defineStore } from '@deepseek-ai/dsh-client-store'
// U05 (design §6.5): view state routes failures by source — form fields, task rows,
// and system-level stay separate; notice carries the "next step" hint after a disposition.
export const viewStore = defineStore({
  init: () => ({
    open: false, error: '', notice: '',
    formErrors: {} as Record<string, string>,
    taskErrors: {} as Record<string, string>,
  }),
  actions: {
    open: draft => { draft.open = true; draft.error = ''; draft.notice = ''; draft.formErrors = {}; draft.taskErrors = {} },
    close: draft => { draft.open = false; draft.error = ''; draft.notice = ''; draft.formErrors = {}; draft.taskErrors = {} },
    error: (draft, message: string) => { draft.error = message },
    notice: (draft, message: string) => { draft.notice = message },
    formError: (draft, id: string, message: string) => { if(message)draft.formErrors[id]=message; else delete draft.formErrors[id] },
    taskError: (draft, id: string, message: string) => { if(message)draft.taskErrors[id]=message; else delete draft.taskErrors[id] },
  },
})
