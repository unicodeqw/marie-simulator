import { useSyncExternalStore } from 'react'

/** Мінімальне сховище стану. Селектор має повертати стабільне значення (поле стану або примітив). */
export function createStore<T extends object>(initial: T) {
  let state = initial
  const listeners = new Set<() => void>()
  const subscribe = (l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }
  return {
    get: () => state,
    set(patch: Partial<T>) {
      state = { ...state, ...patch }
      listeners.forEach((l) => l())
    },
    use<S>(select: (s: T) => S): S {
      return useSyncExternalStore(subscribe, () => select(state))
    },
  }
}
