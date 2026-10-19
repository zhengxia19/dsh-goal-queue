import { defineStore } from '@deepseek-ai/dsh-client-store'
export const viewStore = defineStore({
  init: () => ({ open: false, error: '' }),
  actions: {
    open: draft => { draft.open = true; draft.error = '' },
    close: draft => { draft.open = false; draft.error = '' },
    error: (draft, message: string) => { draft.error = message },
  },
})
