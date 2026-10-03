import { ask } from '@/core/confirm'
import {
  DP_DELAY_MAX,
  dpStore,
  provideInput,
  reset,
  restart,
  run,
  setDelay,
  setFastFetch,
  setInputRadix,
  step,
  stop,
} from '@/core/datapath'
import { exportTrace } from '@/core/fileActions'
import { projectStore } from '@/core/project'
import { Part, hex, type DataPathSnapshot, type Frame } from '@/core/types'
import { uiStore } from '@/core/ui'
import { useT } from '@/i18n'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { PaddleKey, RadixButton, StatusLine, Switch } from './hardware'
import { PaperHeader, ProgramListing } from './ProgramListing'
import { StatusText } from './status'
import { cn, formatDelay } from './styles'

// Геометрія мнемосхеми (px у сцені 1240×424): регістри в один ряд, шина зверху,
// джгут ліній запису над регістрами, джгут ліній читання під ними.
const REGISTERS: { part: number; name: string; key: keyof DataPathSnapshot; left: number; digits: number }[] = [
  { part: Part.ir, name: 'IR', key: 'ir', left: 176, digits: 4 },
  { part: Part.out, name: 'OUT', key: 'output', left: 288, digits: 4 },
  { part: Part.in, name: 'IN', key: 'input', left: 400, digits: 4 },
  { part: Part.ac, name: 'AC', key: 'ac', left: 512, digits: 4 },
  { part: Part.mbr, name: 'MBR', key: 'mbr', left: 728, digits: 4 },
  { part: Part.pc, name: 'PC', key: 'pc', left: 840, digits: 3 },
  { part: Part.mar, name: 'MAR', key: 'mar', left: 952, digits: 3 },
]
const NAMES = ['', 'MAR', 'PC', 'MBR', 'AC', 'IN', 'OUT', 'IR']
const BUS_Y = 35
const WRITE_Y = 95
const READ_Y = 319
const MEMORY_LEFT = 1096

const box = (left: number, top: number, width: number, height: number): CSSProperties => ({ left, top, width, height })
const isActive = (frame: Frame, part: number) => ((frame.active >> part) & 1) === 1

function Wire({ on, kind, style }: { on: boolean; kind: 'bus' | 'ctl'; style: CSSProperties }) {
  return (
    <div
      className={cn(
        'absolute',
        kind === 'bus'
          ? on
            ? 'bg-bus shadow-[0_0_10px_rgb(123_224_138/0.6)]'
            : 'bg-bus-off'
          : on
            ? 'bg-ctl'
            : 'bg-ctl-off',
      )}
      style={style}
    />
  )
}

const TapLamp = ({ on, left, top }: { on: boolean; left: number; top: number }) => (
  <span className="lamp absolute size-[11px]" data-on={on} style={{ left, top }} />
)

const node = 'absolute flex items-center justify-center rounded text-center'
const nodeOn = 'border border-lamp bg-amber font-semibold text-[#1a1612] shadow-[0_0_14px_rgb(255_198_92/0.6)]'
const nodeOff = 'border border-edge bg-node text-legend'

function Mimic() {
  const t = useT()
  const snap = dpStore.use((s) => s.snap)
  const marWord = dpStore.use((s) => s.marWord)
  const program = dpStore.use((s) => s.program)
  const { frame } = snap
  const writing = frame.write !== null
  const reading = frame.read !== null
  const target = (code: number | null) => (code === null ? '' : code === 0 ? t.datapath.memory.toLowerCase() : NAMES[code])
  const bits = (code: number | null) => (code === null ? '– – –' : code.toString(2).padStart(3, '0'))
  const line = snap.focusRow === null ? undefined : program[snap.focusRow]

  return (
    <div className="overflow-x-auto">
      <div className="relative mx-auto h-[424px] w-[1240px]">
        {/* Шина даних і відводи до регістрів. */}
        <Wire kind="bus" on={frame.bus} style={box(219, BUS_Y, MEMORY_LEFT - 219, 10)} />
        {REGISTERS.map((r) => (
          <Wire key={r.name} kind="bus" on={frame.bus} style={box(r.left + 43, BUS_Y + 10, 10, 105)} />
        ))}

        {/* Джгут запису: зверху до кожного регістра й до пам'яті. */}
        <Wire kind="ctl" on={writing} style={box(156, WRITE_Y, MEMORY_LEFT - 156, 3)} />
        {REGISTERS.map((r) => (
          <Wire key={r.name} kind="ctl" on={writing} style={box(r.left + 19, WRITE_Y + 3, 3, 52)} />
        ))}

        {/* Джгут читання: знизу. */}
        <Wire kind="ctl" on={reading} style={box(156, READ_Y, MEMORY_LEFT - 156, 3)} />
        {REGISTERS.map((r) => (
          <Wire key={r.name} kind="ctl" on={reading} style={box(r.left + 75, 214, 3, READ_Y - 214)} />
        ))}

        {/* Прямі зв'язки: AC–MBR, MAR–пам'ять, AC–ALU, ALU–MBR. */}
        <Wire kind="ctl" on={frame.aux[0]} style={box(608, 169, 120, 3)} />
        <Wire kind="ctl" on={frame.aux[1]} style={box(1048, 181, 48, 3)} />
        <Wire kind="ctl" on={frame.aux[2]} style={box(608, 197, 40, 3)} />
        <Wire kind="ctl" on={frame.aux[2]} style={box(645, 197, 3, 39)} />
        <Wire kind="ctl" on={frame.aux[3]} style={box(689, 197, 3, 39)} />
        <Wire kind="ctl" on={frame.aux[3]} style={box(689, 197, 39, 3)} />

        <div
          className={cn(
            node,
            'font-condensed text-sm leading-5 font-bold tracking-widest uppercase',
            frame.control ? 'bg-cu text-[#1a1612] shadow-[0_0_14px_rgb(242_184_166/0.5)]' : 'bg-cu-off text-legend',
          )}
          style={box(24, 60, 132, 290)}
        >
          {t.datapath.controlUnit}
        </div>

        {REGISTERS.map((r) => (
          <div
            key={r.name}
            className={cn(node, 'flex-col font-mono text-lg leading-6', isActive(frame, r.part) ? nodeOn : nodeOff)}
            style={box(r.left, 150, 96, 64)}
          >
            <b className="font-condensed text-sm tracking-widest">{r.name}</b>
            {hex(snap[r.key] as number, r.digits)}
          </div>
        ))}

        <div
          className={cn(
            node,
            'pt-[18px] font-condensed text-sm font-bold tracking-widest [clip-path:polygon(0_0,38%_0,50%_30%,62%_0,100%_0,82%_100%,18%_100%)]',
            frame.alu ? 'bg-amber text-[#1a1612]' : 'bg-[#4a4435] text-legend',
          )}
          style={box(624, 236, 88, 56)}
        >
          ALU
        </div>

        <div
          className={cn(
            node,
            'flex-col gap-2 px-2 font-condensed text-sm leading-5 font-bold tracking-widest uppercase',
            isActive(frame, Part.memory) ? nodeOn : nodeOff,
          )}
          style={box(MEMORY_LEFT, 24, 120, 320)}
        >
          {t.datapath.memory}
          <span className="font-mono text-[0.8125rem] font-semibold tracking-normal normal-case">
            M[{hex(snap.mar, 3)}]
            <br />= {hex(marWord, 4)}
          </span>
        </div>

        {/* Лампи на відводах показують обраний приймач і джерело. */}
        {REGISTERS.map((r) => (
          <TapLamp key={`w${r.name}`} on={frame.write === r.part} left={r.left + 15} top={136} />
        ))}
        <TapLamp on={frame.write === Part.memory} left={MEMORY_LEFT - 15} top={WRITE_Y - 4} />
        {REGISTERS.map((r) => (
          <TapLamp key={`r${r.name}`} on={frame.read === r.part} left={r.left + 71} top={218} />
        ))}
        <TapLamp on={frame.read === Part.memory} left={MEMORY_LEFT - 15} top={READ_Y - 4} />

        <div className="absolute flex flex-col items-center justify-center rounded-[3px] bg-panel font-mono text-[0.8125rem] leading-[1.125rem] font-semibold text-[#ff8a7e]" style={box(34, 104, 112, 44)}>
          <span className="uppercase">
            {t.datapath.write} {bits(frame.write)}
          </span>
          <span>{writing ? `→ ${target(frame.write)}` : ' '}</span>
        </div>
        <div className="absolute flex flex-col items-center justify-center rounded-[3px] bg-panel font-mono text-[0.8125rem] leading-[1.125rem] font-semibold text-[#a9c3e6]" style={box(34, 266, 112, 44)}>
          <span className="uppercase">
            {t.datapath.read} {bits(frame.read)}
          </span>
          <span>{reading ? `→ ${target(frame.read)}` : ' '}</span>
        </div>

        <div className="silk absolute w-40 text-center text-xs tracking-[0.14em] text-bus" style={{ left: 572, top: 8 }}>
          {t.datapath.bus}
        </div>
        <div className="absolute font-mono text-xs text-[#ff8a7e]" style={{ left: 164, top: 72 }} aria-hidden>
          /3
        </div>
        <div className="absolute font-mono text-xs text-[#a9c3e6]" style={{ left: 164, top: 328 }} aria-hidden>
          /3
        </div>

        <div className="silk absolute flex items-center text-[0.8125rem] tracking-widest text-dim" style={box(176, 372, 232, 44)}>
          {t.datapath.phase[frame.phase]}
          {frame.phase !== 'idle' && line ? ` · ${line.mnemonic} ${line.operand}` : ''}
        </div>
        <div className="readout absolute flex items-center justify-center text-xl font-semibold tracking-wide" style={box(420, 372, 400, 44)} role="status">
          {frame.rtl || '—'}
        </div>
      </div>
    </div>
  )
}

function InputField() {
  const t = useT()
  const waiting = dpStore.use((s) => s.snap.state === 'blockedOnInput')
  const radix = dpStore.use((s) => s.inputRadix)
  const [text, setText] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (waiting) ref.current?.focus()
  }, [waiting])

  return (
    <form
      className="ml-3 flex h-[3.75rem] items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        provideInput(text)
        setText('')
      }}
    >
      <label htmlFor="dp-in" className="silk">
        {t.teletype.input}
      </label>
      <input
        ref={ref}
        id="dp-in"
        type="text"
        autoComplete="off"
        spellCheck={false}
        disabled={!waiting}
        value={text}
        placeholder={waiting ? 'Enter ↵' : t.datapath.notExpected}
        className={cn('readout h-11 w-36 px-2.5 text-sm placeholder:text-dim', waiting && 'ring-3 ring-key-ochre')}
        onChange={(e) => setText(e.target.value)}
      />
      <RadixButton name={t.teletype.input} radix={radix} onChange={setInputRadix} />
    </form>
  )
}

function Controls() {
  const t = useT()
  const loaded = dpStore.use((s) => s.snap.state !== 'noProgram')
  const running = dpStore.use((s) => s.running !== null)
  const delay = dpStore.use((s) => s.delay)
  const fastFetch = dpStore.use((s) => s.fastFetch)
  return (
    <div className="flex flex-wrap items-end gap-x-3.5 gap-y-4 border-t border-hair pt-4">
      <PaddleKey label={t.panel.run} tone="ochre" title={`${t.panel.run} (F5)`} disabled={!loaded} onClick={run} />
      <PaddleKey label={t.panel.stop} tone="rust" title={`${t.panel.stop} (Shift+F5)`} disabled={!running} onClick={stop} />
      <PaddleKey label={t.panel.step} tone="ochre" title={`${t.panel.step} (F10)`} disabled={!loaded} onClick={step} />
      <PaddleKey label={t.panel.restart} tone="rust" title={t.panel.restartHint} disabled={!loaded} onClick={restart} />
      <PaddleKey
        label={t.panel.reset}
        tone="cream"
        title={t.panel.resetHint}
        onClick={async () => {
          if (await ask('reset')) reset()
        }}
      />
      <div className="ml-3 flex h-[3.75rem] items-center">
        <Switch variant="panel" checked={fastFetch} onChange={setFastFetch}>
          {t.datapath.fastFetch}
        </Switch>
      </div>
      <InputField />
      <div className="ml-auto flex min-w-56 flex-col gap-1.5">
        <label htmlFor="dp-delay" className="silk flex justify-between gap-3">
          <span>{t.datapath.microDelay}</span>
          <span className="font-mono tracking-normal text-amber normal-case">{formatDelay(delay, t)}</span>
        </label>
        <input
          id="dp-delay"
          type="range"
          className="slider"
          min={0}
          max={DP_DELAY_MAX}
          step={100}
          value={delay}
          onChange={(e) => setDelay(Number(e.target.value))}
        />
        <div className="flex justify-between font-mono text-[0.625rem] text-dim" aria-hidden>
          <span>{t.panel.ms(10)}</span>
          <span>{t.panel.seconds(DP_DELAY_MAX / 1000)}</span>
        </div>
      </div>
    </div>
  )
}

const CODES = ['000', '001', '010', '011', '100', '101', '110', '111']

function Codes() {
  const t = useT()
  const grid = 'grid grid-cols-[4.5rem_minmax(0,1fr)] items-center px-4'
  return (
    <section aria-label={t.datapath.codes} className="fanfold min-w-0 flex-[1_1_15.5rem]">
      <PaperHeader title={t.datapath.codes} />
      <div className={cn('silk flex h-7 border-y border-fan-rule tracking-widest text-fan-dim', grid)}>
        <div>{t.datapath.code}</div>
        <div>{t.datapath.device}</div>
      </div>
      <div className="font-mono">
        {CODES.map((code, i) => (
          <div key={code} className={cn(grid, 'h-[1.875rem]', i % 2 === 1 && 'bg-bar')}>
            <div>{code}</div>
            <div>{i === 0 ? t.datapath.memory.toLowerCase() : NAMES[i]}</div>
          </div>
        ))}
      </div>
      <p className="px-4 pt-2.5 pb-3.5 text-xs leading-[1.125rem] text-fan-dim">{t.datapath.codesNote}</p>
    </section>
  )
}

// Скільки останніх рядків трасування тримати в DOM.
const TRACE_TAIL = 400

function Trace() {
  const t = useT()
  const trace = dpStore.use((s) => s.trace)
  const paper = useRef<HTMLDivElement>(null)
  const visible = uiStore.use((s) => s.tab === 'datapath')

  useEffect(() => {
    if (paper.current) paper.current.scrollTop = paper.current.scrollHeight
  }, [trace, visible])

  const tail = trace.length > TRACE_TAIL ? trace.slice(-TRACE_TAIL) : trace
  return (
    <section aria-label={t.datapath.trace} className="tty min-w-0 flex-[1_1_27.5rem] rounded-[3px] bg-paper text-ink shadow-[0_3px_0_rgb(0_0_0/0.5)]">
      <PaperHeader title={t.datapath.trace}>
        <button
          type="button"
          className="h-11 rounded border border-ink px-3 text-[0.8125rem] hover:bg-key-cream disabled:opacity-45"
          disabled={trace.length === 0}
          onClick={() => exportTrace()}
        >
          {t.datapath.saveTrace}
        </button>
      </PaperHeader>
      <div className="border-t border-[#c9c2ac] px-4 pt-2 font-mono text-sm leading-6 whitespace-pre">
        <div className="font-semibold">{'  IR   OUT    IN    AC   MBR   PC   MAR'}</div>
      </div>
      <div ref={paper} role="log" className="h-[17.25rem] overflow-auto px-4 pb-3.5 font-mono text-sm leading-6 whitespace-pre">
        {tail.map((row, i) => (
          <div key={trace.length - tail.length + i} className={cn(i === tail.length - 1 && 'font-bold')}>
            {row}
          </div>
        ))}
      </div>
    </section>
  )
}

export function DataPathView() {
  const t = useT()
  const status = dpStore.use((s) => s.status)
  const program = dpStore.use((s) => s.program)
  const focusRow = dpStore.use((s) => s.snap.focusRow)
  const fileName = projectStore.use((s) => s.fileName)
  const visible = uiStore.use((s) => s.tab === 'datapath')

  return (
    <div className="flex flex-col gap-4">
      <section aria-label={t.tabs.datapath} className="machine">
        <div className="faceplate flex flex-col gap-3.5 px-5 py-4.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-condensed text-3xl font-bold tracking-[0.22em]">MARIE·16</div>
            <div className="silk text-xs font-medium tracking-[0.12em] text-dim">{t.datapath.subtitle}</div>
          </div>
          <Mimic />
          <Controls />
          <StatusLine>
            <StatusText status={status} />
          </StatusLine>
        </div>
      </section>

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[1_1_23.75rem]">
          <ProgramListing title={`${t.program.title} · ${fileName}`} program={program} focusRow={focusRow} visible={visible} />
        </div>
        <Codes />
        <Trace />
      </div>
    </div>
  )
}
