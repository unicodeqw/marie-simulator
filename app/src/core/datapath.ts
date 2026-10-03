import { createControl, stoppedStatus, type Outcome } from './control'
import { createStore } from './store'
import type { DataPathSnapshot, Frame, Program, ProgramLine, Radix, Status } from './types'
import { dp } from './wasm'

export const DP_DELAY_MIN = 10
export const DP_DELAY_MAX = 30_000
export const DP_DELAY_DEFAULT = 1000
/** Пауза між кадрами вибірки в режимі швидкої вибірки, мс (як в оригіналі). */
const FAST_FETCH_DELAY = 10
/** Скільки останніх рядків трасування тримає інтерфейс. */
const TRACE_TAIL = 400

type RunMode = 'run' | 'step'

interface DpState {
  snap: DataPathSnapshot
  /** Слово пам'яті за адресою з MAR — для вузла пам'яті на схемі. */
  marWord: number
  program: ProgramLine[]
  /** Останні рядки трасування; номер першого — `snap.traceLen - trace.length`. */
  trace: string[]
  /** `step` — анімація однієї команди; режим зберігається, поки машина чекає вводу. */
  running: RunMode | null
  /** Затримка після мікрооперації, мс; між її кадрами — половина. */
  delay: number
  fastFetch: boolean
  inputRadix: Radix
  status: Status
}

const EMPTY: DataPathSnapshot = {
  ac: 0,
  ir: 0,
  mbr: 0,
  pc: 0,
  mar: 0,
  input: 0,
  output: 0,
  state: 'noProgram',
  fault: null,
  focusRow: null,
  traceLen: 0,
  frame: {
    phase: 'idle',
    rtl: '',
    write: null,
    read: null,
    aux: [false, false, false, false],
    active: 0,
    alu: false,
    control: false,
    bus: false,
    wait: 'brief',
  },
}

export const dpStore = createStore<DpState>({
  snap: EMPTY,
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

function refresh(patch: Partial<DpState> = {}) {
  const snap: DataPathSnapshot = dp.snapshot()
  const previous = dpStore.get()
  let { trace } = previous
  if (snap.traceLen < previous.snap.traceLen) {
    // Трасування почалося заново (рестарт, завантаження).
    trace = dp.trace(Math.max(0, snap.traceLen - TRACE_TAIL))
  } else if (snap.traceLen > previous.snap.traceLen) {
    trace = [...trace, ...dp.trace(previous.snap.traceLen)].slice(-TRACE_TAIL)
  }
  dpStore.set({ snap, marWord: dp.peek(snap.mar), trace, ...patch })
}

function frameDelay(frame: Frame) {
  const { delay, fastFetch } = dpStore.get()
  if (fastFetch && frame.phase === 'fetch') return FAST_FETCH_DELAY
  return frame.wait === 'full' ? delay : Math.max(delay / 2, 5)
}

function advance(mode: RunMode): Outcome {
  const done = dp.tick()
  const snap: DataPathSnapshot = dp.snapshot()
  if (snap.state !== 'ready') return { status: stoppedStatus(snap) }
  if (done && mode === 'step') return { status: { key: 'pressStep' } }
  return { wait: frameDelay(snap.frame) }
}

const control = createControl<RunMode>({
  core: () => dp,
  running: () => dpStore.get().running,
  refresh,
  advance,
  startDelay: () => 0,
  // Без активного режиму команду Input усе одно треба довести до кінця.
  afterInput: 'step',
})

export const run = () => control.start('run')
/** Один повний цикл «вибірка — декодування — виконання» з анімацією. */
export const step = () => control.start('step')
export const stop = control.stop
export const provideInput = control.provideInput
export const restart = control.restart

export function loadProgram(program: Program) {
  control.halt()
  dp.load(program)
  refresh({ program: program.lines, running: null, status: { key: 'loaded' } })
}

export function reset() {
  control.halt()
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

/** Трасування для збереження у файл: усе, що ще зберігає ядро, із заголовком колонок. */
export function traceText(): string {
  return ['  IR   OUT    IN    AC   MBR   PC   MAR', ...dp.trace(0), ''].join('\n')
}
