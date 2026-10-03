// Дзеркала типів `sim-core`, як їх серіалізує `sim-wasm`.

export type Radix = 'hex' | 'dec' | 'ascii'
export type MachineState = 'noProgram' | 'ready' | 'blockedOnInput' | 'paused' | 'halted' | 'fault'
export type Fault = 'illegalOpcode' | 'illegalCondition' | 'illegalInput'

export type AsmError =
  | 'orgNotFirst'
  | 'labelStartsWithDigit'
  | 'duplicateLabel'
  | 'unknownInstruction'
  | 'missingInstruction'
  | 'missingOperand'
  | 'addressOutOfRange'
  | 'invalidDecimal'
  | 'invalidOctal'
  | 'invalidHex'
  | 'undefinedOperand'
  | 'tooManyLines'

export interface ProgramLine {
  address: number
  word: number
  label: string
  mnemonic: string
  operand: string
}

export interface Program {
  lines: ProgramLine[]
}

/** Рядок вихідного коду після асемблювання; індекс у масиві = номер рядка − 1. */
export interface CodeLine {
  lineNo: string
  hexCode: string
  operand: string
  source: string
  label: string
  mnemonic: string
  operandToken: string
  comment: string
  errors: AsmError[]
}

export interface AsmSymbol {
  name: string
  address: string
  references: string[]
}

export interface AssemblyReport {
  lines: CodeLine[]
  symbols: AsmSymbol[]
  errorCount: number
  listing: string
  map: string | null
  program: Program | null
}

export interface Snapshot {
  ac: number
  ir: number
  mbr: number
  pc: number
  mar: number
  input: number
  output: number
  state: MachineState
  fault: Fault | null
  focusRow: number | null
  focusCell: number | null
  breakpoints: boolean[]
  executed: number
  outputLen: number
}

export const EMPTY_SNAPSHOT: Snapshot = {
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

export type Phase = 'idle' | 'fetch' | 'decode' | 'execute'

/** Коди вузлів тракту на лініях вибору (біти маски `Frame.active`). */
export const Part = { memory: 0, mar: 1, pc: 2, mbr: 3, ac: 4, in: 5, out: 6, ir: 7 } as const

export interface Frame {
  phase: Phase
  rtl: string
  write: number | null
  read: number | null
  /** Лінії 6..9: AC–MBR, MAR–пам'ять, AC–ALU, ALU–MBR. */
  aux: [boolean, boolean, boolean, boolean]
  active: number
  alu: boolean
  control: boolean
  bus: boolean
  wait: 'brief' | 'full'
}

export interface DataPathSnapshot {
  ac: number
  ir: number
  mbr: number
  pc: number
  mar: number
  input: number
  output: number
  state: MachineState
  fault: Fault | null
  frame: Frame
  focusRow: number | null
  traceLen: number
}

export const IDLE_FRAME: Frame = {
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
}

export type RegisterName = 'pc' | 'mar' | 'mbr' | 'ac' | 'ir'

/** Повідомлення рядка стану; текст дає словник i18n. */
export interface Status {
  key:
    | 'idle'
    | 'loaded'
    | 'running'
    | 'pressStep'
    | 'pressRun'
    | 'waitingInput'
    | 'breakpoint'
    | 'stopped'
    | 'halted'
    | 'fault'
  fault?: Fault | null
}

/** Місцевий час для заголовків лістингу й дампа: `2026-10-03 21:40:12`. */
export function timestamp(date = new Date()) {
  const two = (n: number) => String(n).padStart(2, '0')
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
  return `${day} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
}

export function hex(value: number, digits: number) {
  return value.toString(16).toUpperCase().padStart(digits, '0')
}

/** Значення регістра в обраній системі числення (16-бітне зі знаком для DEC). */
export function formatWord(value: number, radix: Radix, digits: 3 | 4 = 4) {
  if (radix === 'hex') return hex(value, digits)
  if (radix === 'dec') return String(value > 0x7fff ? value - 0x10000 : value)
  const code = value % 128
  return code === 0 ? '' : String.fromCharCode(code)
}
