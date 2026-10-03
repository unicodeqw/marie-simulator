import { createStore } from './store'
import { EMPTY_SNAPSHOT, timestamp } from './types'
import type { Program, ProgramLine, Radix, RegisterName, Snapshot, Status } from './types'
import { sim } from './wasm'

export const DELAY_MIN = 0
export const DELAY_MAX = 3000
/** Як в оригіналі; 0 вмикає пакетне виконання без затримки. */
export const DELAY_DEFAULT = 10

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

let timer: number | undefined

export const simStore = createStore<SimState>({
  snap: EMPTY_SNAPSHOT,
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

function refresh(extra: Partial<SimState> = {}) {
  simStore.set({ snap: sim.snapshot(), memory: sim.memory(), output: sim.outputText(), ...extra })
}

function halt() {
  window.clearTimeout(timer)
  timer = undefined
}

// Статус після того, як машина перестала бути готовою до наступної команди.
function stoppedStatus(snap: Snapshot): Status {
  switch (snap.state) {
    case 'blockedOnInput':
      return { key: 'waitingInput' }
    case 'paused':
      return { key: 'breakpoint' }
    case 'halted':
      return { key: 'halted' }
    case 'fault':
      return { key: 'fault', fault: snap.fault }
    default:
      return { key: 'idle' }
  }
}

function tick() {
  const { running, delay } = simStore.get()
  if (!running) return
  const breakpoints = running === 'breakpoints'
  if (delay === 0) {
    // Без затримки: пакети команд, поки не вичерпано бюджет кадру, щоб «Стоп» лишався чуйним.
    const deadline = performance.now() + 12
    do sim.run(5000, breakpoints)
    while (sim.snapshot().state === 'ready' && performance.now() < deadline)
  } else {
    sim.run(1, breakpoints)
  }
  const snap: Snapshot = sim.snapshot()
  if (snap.state === 'ready') {
    refresh()
    timer = window.setTimeout(tick, delay)
    return
  }
  timer = undefined
  refresh({ running: snap.state === 'blockedOnInput' ? running : null, status: stoppedStatus(snap) })
}

export function loadProgram(program: Program) {
  halt()
  sim.load(program)
  refresh({ program: program.lines, running: null, status: { key: 'loaded' } })
}

export function run(mode: RunMode) {
  const { snap, running } = simStore.get()
  if (snap.state === 'noProgram' || snap.state === 'blockedOnInput') return
  if (running) {
    simStore.set({ running: mode })
    return
  }
  // Після зупинки програма стартує заново, як в оригіналі.
  if (snap.state === 'halted' || snap.state === 'fault') sim.restart()
  refresh({ running: mode, status: { key: 'running' } })
  timer = window.setTimeout(tick, simStore.get().delay)
}

export function stop() {
  if (!simStore.get().running) return
  halt()
  const waiting = simStore.get().snap.state === 'blockedOnInput'
  refresh({ running: null, status: { key: waiting ? 'waitingInput' : 'stopped' } })
}

export function step() {
  halt()
  sim.step()
  const snap: Snapshot = sim.snapshot()
  refresh({ running: null, status: snap.state === 'ready' ? { key: 'pressStep' } : stoppedStatus(snap) })
}

/** Значення для команди Input. Після вводу автоматичний запуск продовжується. */
export function provideInput(text: string) {
  if (simStore.get().snap.state !== 'blockedOnInput') return
  sim.provideInput(text)
  const snap: Snapshot = sim.snapshot()
  const { running, delay } = simStore.get()
  if (snap.state !== 'ready') {
    refresh({ running: null, status: stoppedStatus(snap) })
  } else if (running) {
    refresh({ status: { key: 'running' } })
    timer = window.setTimeout(tick, delay)
  } else {
    refresh({ status: { key: 'pressStep' } })
  }
}

export function restart() {
  halt()
  sim.restart()
  const loaded = simStore.get().snap.state !== 'noProgram'
  refresh({ running: null, status: { key: loaded ? 'pressRun' : 'idle' } })
}

export function reload() {
  if (simStore.get().snap.state === 'noProgram') return
  halt()
  sim.reload()
  refresh({ running: null, status: { key: 'loaded' } })
}

export function reset() {
  halt()
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
  refresh({ outputRadix: radix })
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
export function coreDump(title: string, start: number, end: number) {
  return sim.coreDump(title, timestamp(), start, end, simStore.get().registerRadix)
}
