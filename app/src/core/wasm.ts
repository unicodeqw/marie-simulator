import init, {
  DataPath,
  Simulator,
  assemble as wasmAssemble,
  formatWord as wasmFormatWord,
  initSync,
  instructionSet,
  readMex as wasmReadMex,
} from './pkg/sim_wasm'
import type { AssemblyReport, InstructionSet, Program, Radix } from './types'

export let sim: Simulator
export let dp: DataPath
/** Система команд із ядра — єдине джерело для ламп, довідки й підсвітки. */
export let isa: InstructionSet

/** У браузері модуль завантажується сам; у тестах байти `.wasm` передаються явно. */
export async function initCore(module?: BufferSource) {
  if (module) initSync({ module })
  else await init()
  sim = new Simulator()
  dp = new DataPath()
  isa = instructionSet()
}

export function assemble(source: string, fileName: string, timestamp: string): AssemblyReport {
  return wasmAssemble(source, fileName, timestamp)
}

/** Кидає Error, якщо це не оригінальний `.mex`. */
export function readMex(bytes: Uint8Array): { program: Program; source: string } {
  return wasmReadMex(bytes)
}

/** Значення регістра для показу; `address` — 12-бітні PC і MAR. */
export function formatWord(value: number, radix: Radix, address = false): string {
  return wasmFormatWord(value, radix, address)
}
