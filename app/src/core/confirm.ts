import { createStore } from './store'

type Question = 'unsaved' | 'reset'

interface ConfirmState {
  question: Question | null
}

export const confirmStore = createStore<ConfirmState>({ question: null })

let resolve: ((ok: boolean) => void) | null = null

/** Показує діалог підтвердження (вбудований confirm у webview Tauri не працює). */
export function ask(question: Question): Promise<boolean> {
  resolve?.(false)
  confirmStore.set({ question })
  return new Promise((r) => {
    resolve = r
  })
}

export function answer(ok: boolean) {
  confirmStore.set({ question: null })
  resolve?.(ok)
  resolve = null
}
