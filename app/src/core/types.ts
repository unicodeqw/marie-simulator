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

export interface Instruction {
  name: string
  takesOperand: boolean
}

export interface InstructionSet {
  /** Індекс у масиві — код операції. */
  instructions: Instruction[]
  directives: string[]
}

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
  source: string
  /** null — рядок не займає адреси. Незібрані через помилку частини слова теж null. */
  code: { address: number; opcode: number | null; operand: number | null } | null
  label: string | null
  mnemonic: string | null
  operand: string | null
  comment: string | null
  errors: AsmError[]
}

export interface AsmSymbol {
  name: string
  address: number
  references: number[]
}

export interface AssemblyReport {
  lines: CodeLine[]
  symbols: AsmSymbol[]
  errorCount: number
  listing: string
  map: string | null
  program: Program | null
}

export interface Registers {
  ac: number
  ir: number
  mbr: number
  pc: number
  mar: number
  input: number
  output: number
}

interface MachineSnapshot extends Registers {
  state: MachineState
  fault: Fault | null
  focusRow: number | null
}

export interface Snapshot extends MachineSnapshot {
  focusCell: number | null
  breakpoints: boolean[]
  executed: number
  outputLen: number
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

export interface DataPathSnapshot extends MachineSnapshot {
  frame: Frame
  /** Скільки рядків трасування накопичено від рестарту. */
  traceLen: number
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
