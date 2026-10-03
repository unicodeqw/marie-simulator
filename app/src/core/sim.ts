import { createControl, stoppedStatus, type Outcome } from './control'
import { timestamp } from './format'
import { createStore } from './store'
import type { Program, ProgramLine, Radix, RegisterName, Snapshot, Status } from './types'
import { sim } from './wasm'

export const DELAY_MIN = 0
export const DELAY_MAX = 3000
/** Як в оригіналі; 0 вмикає пакетне виконання без затримки. */
export const DELAY_DEFAULT = 10

// Без затримки команди виконуються пакетами, поки не вичерпано бюджет
// кадру, щоб «Стоп» лишався чуйним.
const BATCH = 5000
const FRAME_BUDGET_MS = 12

type RunMode = 'run' | 'breakpoints'

interface SimState {
  snap: Snapshot
  memory: Uint16Array
  program: ProgramLine[]
  output: string
  /** Режим автоматичного виконання; лишається встановленим, поки машина чекає вводу. */
  running: RunMode | null
  delay: number
  status: Status
  inputRadix: Radix
  outputRadix: Radix
  linefeed: boolean
  registerRadix: Record<RegisterName, Radix>
}

const EMPTY: Snapshot = {
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
  focusCell: null,
  breakpoints: [],
  executed: 0,
  outputLen: 0,
}

export const simStore = createStore<SimState>({
  snap: EMPTY,
  memory: new Uint16Array(4096),
  program: [],
  output: '',
  running: null,
  delay: DELAY_DEFAULT,
  status: { key: 'idle' },
  // Ввід і вивід в оригіналі типово в ASCII, регістри — у HEX.
  inputRadix: 'ascii',
  outputRadix: 'ascii',
  linefeed: true,
  registerRadix: { pc: 'hex', mar: 'hex', mbr: 'hex', ac: 'hex', ir: 'hex' },
})

function refresh(patch: Partial<SimState> = {}) {
  const snap: Snapshot = sim.snapshot()
  const previous = simStore.get()
  // Вивід дочитується з місця, де зупинилися; після очищення чи перезавантаження — заново.
  let { output } = previous
  if (snap.outputLen < previous.snap.outputLen) output = sim.outputText(0)
  else if (snap.outputLen > previous.snap.outputLen) output += sim.outputText(previous.snap.outputLen)
  simStore.set({ snap, memory: sim.memory(), output, ...patch })
}

function advance(mode: RunMode): Outcome {
  const { delay } = simStore.get()
  const breakpoints = mode === 'breakpoints'
  let ready: boolean
  if (delay === 0) {
    const deadline = performance.now() + FRAME_BUDGET_MS
    do ready = sim.run(BATCH, breakpoints)
    while (ready && performance.now() < deadline)
  } else {
    ready = sim.run(1, breakpoints)
  }
  return ready ? { wait: delay } : { status: stoppedStatus(sim.snapshot()) }
}

const control = createControl<RunMode>({
  core: () => sim,
  running: () => simStore.get().running,
  refresh,
  advance,
  startDelay: () => simStore.get().delay,
  // Після вводу в покроковому режимі машина чекає наступного «Кроку».
  afterInput: null,
})

export const run = control.start
export const stop = control.stop
export const provideInput = control.provideInput
export const restart = control.restart

export function loadProgram(program: Program) {
  control.halt()
  sim.load(program)
  refresh({ program: program.lines, running: null, status: { key: 'loaded' } })
}

export function step() {
  control.halt()
  const ready = sim.step()
  refresh({ running: null, status: ready ? { key: 'pressStep' } : stoppedStatus(sim.snapshot()) })
}

export function reload() {
  if (simStore.get().snap.state === 'noProgram') return
  control.halt()
  sim.reload()
  refresh({ running: null, status: { key: 'loaded' } })
}

export function reset() {
  control.halt()
  sim.reset()
  refresh({ program: [], running: null, status: { key: 'idle' } })
}

export function toggleBreakpoint(row: number) {
  sim.toggleBreakpoint(row)
  refresh()
}

export function clearBreakpoints() {
  sim.clearBreakpoints()
  refresh()
}

export function setDelay(delay: number) {
  simStore.set({ delay: Math.min(DELAY_MAX, Math.max(DELAY_MIN, Math.round(delay))) })
}

export function setInputRadix(radix: Radix) {
  sim.setInputRadix(radix)
  simStore.set({ inputRadix: radix })
}

export function setOutputRadix(radix: Radix) {
  sim.setOutputRadix(radix)
  simStore.set({ outputRadix: radix, output: sim.outputText(0) })
}

export function setLinefeed(on: boolean) {
  sim.setOutputLinefeed(on)
  simStore.set({ linefeed: on })
}

export function clearOutput() {
  sim.clearOutput()
  refresh()
}

export function setRegisterRadix(register: RegisterName, radix: Radix) {
  simStore.set({ registerRadix: { ...simStore.get().registerRadix, [register]: radix } })
}

/** Текст core dump для діапазону адрес; регістри — у системах числення з панелі. */
export function coreDump(title: string, start: number, end: number): string {
  return sim.coreDump(title, timestamp(), start, end, simStore.get().registerRadix)
}
