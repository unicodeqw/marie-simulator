import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as datapath from '../src/core/datapath'
import { DP_DELAY_DEFAULT, dpStore } from '../src/core/datapath'
import * as simulator from '../src/core/sim'
import { DELAY_DEFAULT, simStore } from '../src/core/sim'
import type { Program } from '../src/core/types'
import { assemble, initCore, isa } from '../src/core/wasm'

const COUNTDOWN = `
        ORG 100
Loop,   Load Count
        Output
        Subt One
        Store Count
        Skipcond 400
        Jump Loop
        Halt
Count,  DEC 3
One,    DEC 1
`
const ECHO = 'Input\nOutput\nHalt\n'
const FOREVER = 'Loop, Jump Loop\n'

function program(source: string): Program {
  const report = assemble(source, 'test.mas', '')
  expect(report.errorCount).toBe(0)
  return report.program!
}

beforeAll(async () => {
  await initCore(readFileSync(new URL('../src/core/pkg/sim_wasm_bg.wasm', import.meta.url)))
})

beforeEach(() => {
  // Лише таймери: `performance.now()` має йти справжнім, інакше пакетний режим не вийде з циклу.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  simulator.reset()
  simulator.setDelay(DELAY_DEFAULT)
  simulator.setInputRadix('dec')
  simulator.setOutputRadix('dec')
  simulator.setLinefeed(true)
  datapath.reset()
  datapath.setDelay(DP_DELAY_DEFAULT)
  datapath.setFastFetch(false)
  datapath.setInputRadix('dec')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('core bindings', () => {
  it('exposes the instruction set of the core', () => {
    expect(isa.instructions).toHaveLength(13)
    expect(isa.instructions[0]).toEqual({ name: 'JnS', takesOperand: true })
    expect(isa.instructions[7]).toEqual({ name: 'Halt', takesOperand: false })
    expect(isa.directives).toContain('ORG')
  })

  it('reports assembly errors per source line', () => {
    const report = assemble('Load X\nFoo\n', 'bad.mas', '')
    expect(report.errorCount).toBe(3)
    expect(report.program).toBeNull()
    expect(report.lines.map((l) => l.errors)).toEqual([['undefinedOperand'], ['unknownInstruction', 'missingOperand']])
    expect(report.lines[0].code).toEqual({ address: 0, opcode: 1, operand: null })
  })
})

describe('simulator store', () => {
  it('executes one instruction per tick and halts', () => {
    simulator.loadProgram(program(COUNTDOWN))
    expect(simStore.get().status.key).toBe('loaded')

    simulator.run('run')
    expect(simStore.get()).toMatchObject({ running: 'run', status: { key: 'running' } })
    expect(simStore.get().snap.executed).toBe(0)

    vi.advanceTimersByTime(DELAY_DEFAULT)
    expect(simStore.get().snap.executed).toBe(1)

    vi.runAllTimers()
    expect(simStore.get()).toMatchObject({ running: null, status: { key: 'halted' }, output: '3\n2\n1\n' })
    expect(simStore.get().memory[0x107]).toBe(0)
  })

  it('runs in batches when the delay is zero', () => {
    simulator.setDelay(0)
    simulator.loadProgram(program(COUNTDOWN))
    simulator.run('run')
    vi.advanceTimersByTime(0)
    expect(simStore.get().status.key).toBe('halted')
  })

  it('stops an endless program on request', () => {
    simulator.setDelay(0)
    simulator.loadProgram(program(FOREVER))
    simulator.run('run')
    vi.advanceTimersByTime(0)
    expect(simStore.get().running).toBe('run')

    simulator.stop()
    const { executed } = simStore.get().snap
    expect(simStore.get()).toMatchObject({ running: null, status: { key: 'stopped' } })
    vi.runAllTimers()
    expect(simStore.get().snap.executed).toBe(executed)
  })

  it('pauses after a breakpoint and resumes from the same place', () => {
    simulator.loadProgram(program(COUNTDOWN))
    simulator.toggleBreakpoint(1)
    simulator.run('breakpoints')
    vi.runAllTimers()
    expect(simStore.get()).toMatchObject({ running: null, status: { key: 'breakpoint' }, output: '3\n' })
    expect(simStore.get().snap).toMatchObject({ state: 'paused', pc: 0x102 })

    simulator.clearBreakpoints()
    simulator.run('run')
    vi.runAllTimers()
    expect(simStore.get()).toMatchObject({ status: { key: 'halted' }, output: '3\n2\n1\n' })
  })

  it('suspends a run on Input and resumes it after the value arrives', () => {
    simulator.loadProgram(program(ECHO))
    simulator.run('run')
    vi.runAllTimers()
    expect(simStore.get()).toMatchObject({ running: 'run', status: { key: 'waitingInput' } })

    simulator.provideInput('42')
    expect(simStore.get().status.key).toBe('running')
    vi.runAllTimers()
    expect(simStore.get()).toMatchObject({ running: null, status: { key: 'halted' }, output: '42\n' })
  })

  it('waits for the next step after Input in step mode', () => {
    simulator.loadProgram(program(ECHO))
    simulator.step()
    expect(simStore.get().status.key).toBe('waitingInput')

    simulator.provideInput('7')
    expect(simStore.get()).toMatchObject({ running: null, status: { key: 'pressStep' } })
    expect(simStore.get().snap.ac).toBe(7)
    vi.runAllTimers()
    expect(simStore.get().snap.executed).toBe(1)
  })

  it('halts abnormally on a value that is not a number', () => {
    simulator.loadProgram(program(ECHO))
    simulator.step()
    simulator.provideInput('seven')
    expect(simStore.get()).toMatchObject({ running: null, status: { key: 'fault', fault: 'illegalInput' } })
  })

  it('restarts a halted program on Run and keeps output in step with the radix', () => {
    simulator.loadProgram(program('Load X\nOutput\nAdd X\nStore X\nHalt\nX, DEC 5\n'))
    simulator.run('run')
    vi.runAllTimers()
    expect(simStore.get().output).toBe('5\n')

    // Рестарт не відновлює пам'ять і не чистить вивід: другий прохід бачить уже змінений X.
    simulator.run('run')
    vi.runAllTimers()
    expect(simStore.get().output).toBe('5\n10\n')
    simulator.setOutputRadix('hex')
    expect(simStore.get().output).toBe('0005\n000A\n')

    simulator.clearOutput()
    expect(simStore.get().output).toBe('')
    simulator.reload()
    expect(simStore.get().memory[5]).toBe(5)
  })
})

describe('datapath store', () => {
  const rtl = () => dpStore.get().snap.frame.rtl

  it('animates one instruction per step with waits that follow the delay', () => {
    datapath.loadProgram(program(COUNTDOWN))
    datapath.step()
    vi.advanceTimersByTime(0)
    expect(rtl()).toBe('MAR ← PC')
    expect(dpStore.get().snap.mar).toBe(0)

    // Кадр із передачею — через половину затримки, наступна мікрооперація — ще через повну.
    vi.advanceTimersByTime(DP_DELAY_DEFAULT / 2)
    expect(dpStore.get().snap.mar).toBe(0x100)
    vi.advanceTimersByTime(DP_DELAY_DEFAULT / 2 + DP_DELAY_DEFAULT)
    expect(rtl()).toBe('IR ← M[MAR]')

    vi.runAllTimers()
    expect(dpStore.get()).toMatchObject({ running: null, status: { key: 'pressStep' } })
    expect(dpStore.get().snap).toMatchObject({ pc: 0x101, ac: 3, ir: 0x1107 })
    expect(dpStore.get().trace).toHaveLength(6)
    expect(dpStore.get().marWord).toBe(3)
  })

  it('skips the waits of the fetch phase in fast fetch mode', () => {
    datapath.loadProgram(program(COUNTDOWN))
    datapath.setFastFetch(true)
    datapath.step()
    vi.advanceTimersByTime(200)
    expect(dpStore.get().snap.frame.phase).not.toBe('fetch')
    expect(dpStore.get().snap.ir).toBe(0x1107)
  })

  it('runs to Halt and restarts from the beginning', () => {
    datapath.loadProgram(program(COUNTDOWN))
    datapath.run()
    vi.runAllTimers()
    expect(dpStore.get()).toMatchObject({ running: null, status: { key: 'halted' } })
    expect(dpStore.get().snap.output).toBe(1)

    datapath.restart()
    expect(dpStore.get()).toMatchObject({ trace: [], status: { key: 'pressRun' } })
    expect(dpStore.get().snap).toMatchObject({ pc: 0x100, traceLen: 0 })
  })

  it('finishes Input after the value arrives even when stopped', () => {
    datapath.loadProgram(program(ECHO))
    datapath.run()
    vi.runAllTimers()
    expect(dpStore.get()).toMatchObject({ running: 'run', status: { key: 'waitingInput' } })

    datapath.stop()
    expect(dpStore.get()).toMatchObject({ running: null, status: { key: 'waitingInput' } })

    datapath.provideInput('9')
    vi.runAllTimers()
    expect(dpStore.get()).toMatchObject({ running: null, status: { key: 'pressStep' } })
    expect(dpStore.get().snap).toMatchObject({ ac: 9, input: 9, pc: 1 })
  })

  it('keeps only the tail of the trace', () => {
    datapath.setDelay(10)
    datapath.loadProgram(program(FOREVER))
    datapath.run()
    vi.advanceTimersByTime(60_000)
    datapath.stop()

    const { trace, snap } = dpStore.get()
    expect(snap.traceLen).toBeGreaterThan(400)
    expect(trace).toHaveLength(400)
    expect(datapath.traceText().split('\n')[0]).toBe('  IR   OUT    IN    AC   MBR   PC   MAR')
  })
})
