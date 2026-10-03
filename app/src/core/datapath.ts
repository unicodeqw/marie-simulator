import { createStore } from './store'
import { EMPTY_SNAPSHOT, IDLE_FRAME } from './types'
import type { DataPathSnapshot, Frame, Program, ProgramLine, Radix, Status } from './types'
import { dp } from './wasm'

export const DP_DELAY_MIN = 10
export const DP_DELAY_MAX = 30_000
export const DP_DELAY_DEFAULT = 1000
/** Пауза між кадрами вибірки в режимі швидкої вибірки, мс (як в оригіналі). */
const FAST_FETCH_DELAY = 10

type RunMode = 'run' | 'step'

interface DpState {
  snap: DataPathSnapshot
  /** Слово пам'яті за адресою з MAR — для вузла пам'яті на схемі. */
  marWord: number
  program: ProgramLine[]
  trace: string[]
  /** `step` — анімація однієї команди; режим зберігається, поки машина чекає вводу. */
  running: RunMode | null
  /** Затримка після мікрооперації, мс; між її кадрами — половина. */
  delay: number
  fastFetch: boolean
  inputRadix: Radix
  status: Status
}

let timer: number | undefined

export const dpStore = createStore<DpState>({
  snap: { ...EMPTY_SNAPSHOT, frame: IDLE_FRAME, traceLen: 0 },
  marWord: 0,
  program: [],
  trace: [],
  running: null,
  delay: DP_DELAY_DEFAULT,
  fastFetch: false,
  // В оригінальному MarieDPath ввід типово шістнадцятковий.
  inputRadix: 'hex',
  status: { key: 'idle' },
})

function refresh(extra: Partial<DpState> = {}) {
  const snap: DataPathSnapshot = dp.snapshot()
  let { trace } = dpStore.get()
  if (snap.traceLen < trace.length) trace = dp.trace(0)
  else if (snap.traceLen > trace.length) trace = [...trace, ...dp.trace(trace.length)]
  dpStore.set({ snap, marWord: dp.peek(snap.mar), trace, ...extra })
}

function halt() {
  window.clearTimeout(timer)
  timer = undefined
}

function stoppedStatus(snap: DataPathSnapshot): Status {
  switch (snap.state) {
    case 'blockedOnInput':
      return { key: 'waitingInput' }
    case 'halted':
      return { key: 'halted' }
    case 'fault':
      return { key: 'fault', fault: snap.fault }
    default:
      return { key: 'idle' }
  }
}

function frameDelay(frame: Frame) {
  const { delay, fastFetch } = dpStore.get()
  if (fastFetch && frame.phase === 'fetch') return FAST_FETCH_DELAY
  return frame.wait === 'full' ? delay : Math.max(delay / 2, 5)
}

function tick() {
  const { running } = dpStore.get()
  if (!running) return
  const done = dp.tick()
  const snap: DataPathSnapshot = dp.snapshot()
  if (snap.state !== 'ready') {
    timer = undefined
    refresh({ running: snap.state === 'blockedOnInput' ? running : null, status: stoppedStatus(snap) })
  } else if (done && running === 'step') {
    timer = undefined
    refresh({ running: null, status: { key: 'pressStep' } })
  } else {
    refresh()
    timer = window.setTimeout(tick, frameDelay(snap.frame))
  }
}

function start(mode: RunMode) {
  const { snap, running } = dpStore.get()
  if (snap.state === 'noProgram' || snap.state === 'blockedOnInput') return
  if (running) {
    dpStore.set({ running: mode })
    return
  }
  // Після зупинки Пуск і Крок починають програму спочатку, як в оригіналі.
  if (snap.state === 'halted' || snap.state === 'fault') dp.restart()
  refresh({ running: mode, status: { key: 'running' } })
  tick()
}

export function loadProgram(program: Program) {
  halt()
  dp.load(program)
  dpStore.set({ trace: [] })
  refresh({ program: program.lines, running: null, status: { key: 'loaded' } })
}

export const run = () => start('run')
/** Один повний цикл «вибірка — декодування — виконання» з анімацією. */
export const step = () => start('step')

export function stop() {
  if (!dpStore.get().running) return
  halt()
  const waiting = dpStore.get().snap.state === 'blockedOnInput'
  refresh({ running: null, status: { key: waiting ? 'waitingInput' : 'stopped' } })
}

export function provideInput(text: string) {
  if (dpStore.get().snap.state !== 'blockedOnInput') return
  dp.provideInput(text)
  const snap: DataPathSnapshot = dp.snapshot()
  const { running } = dpStore.get()
  if (snap.state !== 'ready') {
    refresh({ running: null, status: stoppedStatus(snap) })
    return
  }
  // Без активного режиму команду Input усе одно треба довести до кінця.
  refresh({ running: running ?? 'step', status: { key: 'running' } })
  tick()
}

export function restart() {
  halt()
  dp.restart()
  const loaded = dpStore.get().snap.state !== 'noProgram'
  refresh({ running: null, status: { key: loaded ? 'pressRun' : 'idle' } })
}

export function reset() {
  halt()
  dp.reset()
  refresh({ program: [], running: null, status: { key: 'idle' } })
}

export function setDelay(delay: number) {
  dpStore.set({ delay: Math.min(DP_DELAY_MAX, Math.max(DP_DELAY_MIN, Math.round(delay))) })
}

export function setFastFetch(on: boolean) {
  dpStore.set({ fastFetch: on })
}

export function setInputRadix(radix: Radix) {
  dp.setInputRadix(radix)
  dpStore.set({ inputRadix: radix })
}
