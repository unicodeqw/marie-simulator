import type { Dict } from '@/i18n'
import * as datapath from './datapath'
import { timestamp } from './format'
import * as simulator from './sim'
import { createStore } from './store'
import type { AssemblyReport, Program } from './types'
import { assemble } from './wasm'

export const UNTITLED = 'untitled.mas'

/** Тимчасове сповіщення; `text` дістає повідомлення зі словника поточної мови. */
export interface Notice {
  id: number
  kind: 'error' | 'info'
  text: (t: Dict) => string
}

interface ProjectState {
  fileName: string
  /** Повний шлях для збереження без діалогу; лише в Tauri. */
  filePath: string | null
  source: string
  /** Є незбережені зміни. */
  dirty: boolean
  report: AssemblyReport | null
  /** Текст змінено після останнього асемблювання. */
  stale: boolean
  notice: Notice | null
}

export const projectStore = createStore<ProjectState>({
  fileName: UNTITLED,
  filePath: null,
  source: '',
  dirty: false,
  report: null,
  stale: false,
  notice: null,
})

let noticeId = 0

export function notify(kind: Notice['kind'], text: Notice['text']) {
  projectStore.set({ notice: { id: ++noticeId, kind, text } })
}

export function dismissNotice() {
  projectStore.set({ notice: null })
}

export function setSource(source: string) {
  if (source === projectStore.get().source) return
  projectStore.set({ source, dirty: true, stale: true })
}

/** Замінює вихідний текст (новий файл, відкриття, приклад) і скидає обидві машини. */
export function openSource(fileName: string, source: string, filePath: string | null = null) {
  projectStore.set({ fileName, filePath, source, dirty: false, report: null, stale: false })
  simulator.reset()
  datapath.reset()
}

export function markSaved(fileName: string, filePath: string | null) {
  projectStore.set({ fileName, filePath, dirty: false })
}

/** Завантажує ту саму програму в симулятор і в тракт даних. */
export function loadProgram(program: Program) {
  simulator.loadProgram(program)
  datapath.loadProgram(program)
}

/** Асемблює поточний текст; без помилок програма одразу завантажується в обидві машини. */
export function assembleProject(): AssemblyReport {
  const { source, fileName } = projectStore.get()
  const report = assemble(source, fileName, timestamp())
  projectStore.set({ report, stale: false })
  if (report.program && report.program.lines.length > 0) loadProgram(report.program)
  if (report.errorCount > 0) notify('error', (t) => t.editor.failed(report.errorCount))
  else notify('info', (t) => t.editor.assembled)
  return report
}
