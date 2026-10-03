import { createStore } from './store'

export type Tab = 'editor' | 'simulator' | 'datapath'

/** Активний розділ. Приховані розділи лишаються змонтованими, тож прокручування в них відкладається до показу. */
export const uiStore = createStore<{ tab: Tab }>({ tab: 'editor' })
