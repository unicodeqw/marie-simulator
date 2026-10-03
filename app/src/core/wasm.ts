import init, { DataPath, Simulator, assemble as wasmAssemble, readMex as wasmReadMex } from './pkg/sim_wasm'
import type { AssemblyReport, Program } from './types'

export let sim: Simulator
export let dp: DataPath

export async function initCore() {
  await init()
  sim = new Simulator()
  dp = new DataPath()
}

export function assemble(source: string, fileName: string, timestamp: string): AssemblyReport {
  return wasmAssemble(source, fileName, timestamp)
}

/** Кидає Error, якщо це не оригінальний `.mex`. */
export function readMex(bytes: Uint8Array): { program: Program; source: string } {
  return wasmReadMex(bytes)
}
