import { ask } from '@/core/confirm'
import {
  DP_DELAY_MAX,
  DP_DELAY_MIN,
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
import { hex } from '@/core/format'
import { projectStore } from '@/core/project'
import { Part, type DataPathSnapshot, type Frame } from '@/core/types'
import { useT } from '@/i18n'
import { useEffect, useRef, type CSSProperties } from 'react'
import { DelaySlider, MachineInput, PaddleKey, RadixButton, StatusLine, Switch } from './hardware'
import { PaperHeader, ProgramTable } from './ProgramListing'
import { cn } from './styles'

// ---- Геометрія мнемосхеми, px ---------------------------------------------
// Регістри стоять в один ряд; шина даних іде над ними, джгут ліній запису —
// між шиною й регістрами, джгут ліній читання — під регістрами.

const STAGE = { width: 1240, height: 424 }
const UNIT = { left: 24, top: 60, width: 132, height: 290 }
const MEMORY = { left: 1096, top: 24, width: 120, height: 320 }
const REGISTER = { top: 150, width: 96, height: 64 }
const ALU = { left: 624, top: 236, width: 88, height: 56 }
const BUS = { top: 35, size: 10 }
const LINE = 3
const WRITE_TOP = 95
const READ_TOP = 319
/** Зсув відводів запису й читання від лівого краю регістра. */
const TAP = { write: 20, read: 76 }
/** Висота прямих зв'язків відносно верху регістра: AC–MBR, MAR–пам'ять, до ALU. */
const LINK = { direct: 19, memory: 31, alu: 47 }
/** Зсув входу й виходу ALU від його лівого краю. */
const ALU_PIN = { in: 21, out: 65 }
const LAMP = 11
const READOUT = { width: 400, height: 44 }

type RegisterKey = keyof DataPathSnapshot & ('ir' | 'output' | 'input' | 'ac' | 'mbr' | 'pc' | 'mar')

const REGISTERS: { part: number; name: string; key: RegisterKey; left: number; digits: number }[] = [
  { part: Part.ir, name: 'IR', key: 'ir', left: 176, digits: 4 },
  { part: Part.out, name: 'OUT', key: 'output', left: 288, digits: 4 },
  { part: Part.in, name: 'IN', key: 'input', left: 400, digits: 4 },
  { part: Part.ac, name: 'AC', key: 'ac', left: 512, digits: 4 },
  { part: Part.mbr, name: 'MBR', key: 'mbr', left: 728, digits: 4 },
  { part: Part.pc, name: 'PC', key: 'pc', left: 840, digits: 3 },
  { part: Part.mar, name: 'MAR', key: 'mar', left: 952, digits: 3 },
]
/** Назви вузлів за кодом на лініях вибору; пам'ять (код 0) підписує словник. */
const PART_NAMES = ['', 'MAR', 'PC', 'MBR', 'AC', 'IN', 'OUT', 'IR']

const registerLeft = (name: string) => REGISTERS.find((r) => r.name === name)!.left
const REGISTER_BOTTOM = REGISTER.top + REGISTER.height
const UNIT_RIGHT = UNIT.left + UNIT.width
const BUS_LEFT = REGISTERS[0].left + (REGISTER.width - BUS.size) / 2
const BUS_BOTTOM = BUS.top + BUS.size
const AC_RIGHT = registerLeft('AC') + REGISTER.width
const MBR_LEFT = registerLeft('MBR')
const MAR_RIGHT = registerLeft('MAR') + REGISTER.width
const READOUT_LEFT = (STAGE.width - READOUT.width) / 2
const READOUT_TOP = STAGE.height - READOUT.height - 8

const box = (left: number, top: number, width: number, height: number): CSSProperties => ({ left, top, width, height })
const isActive = (frame: Frame, part: number) => ((frame.active >> part) & 1) === 1
const binary = (code: number) => code.toString(2).padStart(3, '0')

// ---------------------------------------------------------------------------

function Wire({ on, kind, style }: { on: boolean; kind: 'bus' | 'ctl'; style: CSSProperties }) {
  const color =
    kind === 'bus' ? (on ? 'bg-bus shadow-[0_0_10px_rgb(123_224_138/0.6)]' : 'bg-bus-off') : on ? 'bg-ctl' : 'bg-ctl-off'
  return <div className={cn('absolute', color)} style={style} />
}

function TapLamp({ on, left, top }: { on: boolean; left: number; top: number }) {
  return <span className="lamp absolute" data-on={on} style={box(left, top, LAMP, LAMP)} />
}

/** Код на джгуті ліній і назва обраного вузла. */
function SelectCode({
  label,
  code,
  target,
  top,
  className,
}: {
  label: string
  code: number | null
  target: string
  top: number
  className: string
}) {
  return (
    <div
      className={cn(
        'absolute flex flex-col items-center justify-center rounded-plate bg-panel font-mono text-code leading-4.5 font-semibold',
        className,
      )}
      style={box(UNIT.left + 10, top, UNIT.width - 20, 44)}
    >
      <span className="uppercase">
        {label} {code === null ? '– – –' : binary(code)}
      </span>
      <span>{code === null ? ' ' : `→ ${target}`}</span>
    </div>
  )
}

const node = 'absolute flex items-center justify-center rounded text-center'
const nodeOn = 'border border-lamp bg-amber font-semibold text-on-lit shadow-[0_0_14px_rgb(255_198_92/0.6)]'
const nodeOff = 'border border-edge bg-node text-legend'

function Mimic() {
  const t = useT()
  const snap = dpStore.use((s) => s.snap)
  const marWord = dpStore.use((s) => s.marWord)
  const program = dpStore.use((s) => s.program)
  const { frame } = snap
  const writing = frame.write !== null
  const reading = frame.read !== null
  const memoryName = t.datapath.memory.toLowerCase()
  const target = (code: number | null) => (code === 0 ? memoryName : PART_NAMES[code ?? 0])
  const line = snap.focusRow === null ? undefined : program[snap.focusRow]
  const linkTop = (offset: number) => REGISTER.top + offset
  const aluLinkHeight = ALU.top - linkTop(LINK.alu)

  return (
    <div className="overflow-x-auto">
      <div className="relative mx-auto" style={STAGE}>
        {/* Шина даних і відводи до регістрів. */}
        <Wire kind="bus" on={frame.bus} style={box(BUS_LEFT, BUS.top, MEMORY.left - BUS_LEFT, BUS.size)} />
        {REGISTERS.map((r) => (
          <Wire
            key={r.name}
            kind="bus"
            on={frame.bus}
            style={box(r.left + (REGISTER.width - BUS.size) / 2, BUS_BOTTOM, BUS.size, REGISTER.top - BUS_BOTTOM)}
          />
        ))}

        {/* Джгут запису: зверху до кожного регістра й до пам'яті. */}
        <Wire kind="ctl" on={writing} style={box(UNIT_RIGHT, WRITE_TOP, MEMORY.left - UNIT_RIGHT, LINE)} />
        {REGISTERS.map((r) => (
          <Wire
            key={r.name}
            kind="ctl"
            on={writing}
            style={box(r.left + TAP.write - 1, WRITE_TOP + LINE, LINE, REGISTER.top - WRITE_TOP - LINE)}
          />
        ))}

        {/* Джгут читання: знизу. */}
        <Wire kind="ctl" on={reading} style={box(UNIT_RIGHT, READ_TOP, MEMORY.left - UNIT_RIGHT, LINE)} />
        {REGISTERS.map((r) => (
          <Wire
            key={r.name}
            kind="ctl"
            on={reading}
            style={box(r.left + TAP.read - 1, REGISTER_BOTTOM, LINE, READ_TOP - REGISTER_BOTTOM)}
          />
        ))}

        {/* Прямі зв'язки (лінії 6..9): AC–MBR, MAR–пам'ять, AC–ALU, ALU–MBR. */}
        <Wire kind="ctl" on={frame.aux[0]} style={box(AC_RIGHT, linkTop(LINK.direct), MBR_LEFT - AC_RIGHT, LINE)} />
        <Wire kind="ctl" on={frame.aux[1]} style={box(MAR_RIGHT, linkTop(LINK.memory), MEMORY.left - MAR_RIGHT, LINE)} />
        <Wire
          kind="ctl"
          on={frame.aux[2]}
          style={box(AC_RIGHT, linkTop(LINK.alu), ALU.left + ALU_PIN.in + LINE - AC_RIGHT, LINE)}
        />
        <Wire kind="ctl" on={frame.aux[2]} style={box(ALU.left + ALU_PIN.in, linkTop(LINK.alu), LINE, aluLinkHeight)} />
        <Wire kind="ctl" on={frame.aux[3]} style={box(ALU.left + ALU_PIN.out, linkTop(LINK.alu), LINE, aluLinkHeight)} />
        <Wire
          kind="ctl"
          on={frame.aux[3]}
          style={box(ALU.left + ALU_PIN.out, linkTop(LINK.alu), MBR_LEFT - ALU.left - ALU_PIN.out, LINE)}
        />

        <div
          className={cn(
            node,
            'font-condensed text-sm leading-5 font-bold tracking-widest uppercase',
            frame.control ? 'bg-cu text-on-lit shadow-[0_0_14px_rgb(242_184_166/0.5)]' : 'bg-cu-off text-legend',
          )}
          style={UNIT}
        >
          {t.datapath.controlUnit}
        </div>

        {REGISTERS.map((r) => (
          <div
            key={r.name}
            className={cn(node, 'flex-col font-mono text-lg leading-6', isActive(frame, r.part) ? nodeOn : nodeOff)}
            style={{ left: r.left, ...REGISTER }}
          >
            <b className="font-condensed text-sm tracking-widest">{r.name}</b>
            {hex(snap[r.key], r.digits)}
          </div>
        ))}

        <div
          className={cn(
            node,
            'pt-4.5 font-condensed text-sm font-bold tracking-widest [clip-path:polygon(0_0,38%_0,50%_30%,62%_0,100%_0,82%_100%,18%_100%)]',
            frame.alu ? 'bg-amber text-on-lit' : 'bg-alu-off text-legend',
          )}
          style={ALU}
        >
          ALU
        </div>

        <div
          className={cn(
            node,
            'flex-col gap-2 px-2 font-condensed text-sm leading-5 font-bold tracking-widest uppercase',
            isActive(frame, Part.memory) ? nodeOn : nodeOff,
          )}
          style={MEMORY}
        >
          {t.datapath.memory}
          <span className="font-mono text-code font-semibold tracking-normal normal-case">
            M[{hex(snap.mar, 3)}]
            <br />= {hex(marWord, 4)}
          </span>
        </div>

        {/* Лампи на відводах показують обраний приймач і джерело. */}
        {REGISTERS.map((r) => (
          <TapLamp
            key={`w${r.name}`}
            on={frame.write === r.part}
            left={r.left + TAP.write - 5}
            top={REGISTER.top - LAMP - 3}
          />
        ))}
        <TapLamp on={frame.write === Part.memory} left={MEMORY.left - LAMP - 4} top={WRITE_TOP - 4} />
        {REGISTERS.map((r) => (
          <TapLamp key={`r${r.name}`} on={frame.read === r.part} left={r.left + TAP.read - 5} top={REGISTER_BOTTOM + 4} />
        ))}
        <TapLamp on={frame.read === Part.memory} left={MEMORY.left - LAMP - 4} top={READ_TOP - 4} />

        <SelectCode
          label={t.datapath.write}
          code={frame.write}
          target={target(frame.write)}
          top={WRITE_TOP + 9}
          className="text-write-code"
        />
        <SelectCode
          label={t.datapath.read}
          code={frame.read}
          target={target(frame.read)}
          top={READ_TOP - 53}
          className="text-read-code"
        />

        <div
          className="silk absolute text-center text-xs tracking-[0.14em] text-bus"
          style={box(BUS_LEFT, 8, MEMORY.left - BUS_LEFT, 16)}
        >
          {t.datapath.bus}
        </div>
        {/* Позначка «три дроти в джгуті», як на принципових схемах. */}
        <div
          className="absolute font-mono text-xs text-write-code"
          style={{ left: UNIT_RIGHT + 8, top: WRITE_TOP - 23 }}
          aria-hidden
        >
          /3
        </div>
        <div
          className="absolute font-mono text-xs text-read-code"
          style={{ left: UNIT_RIGHT + 8, top: READ_TOP + 9 }}
          aria-hidden
        >
          /3
        </div>

        <div
          className="silk absolute flex items-center text-code tracking-widest text-dim"
          style={box(REGISTERS[0].left, READOUT_TOP, READOUT_LEFT - REGISTERS[0].left - 12, READOUT.height)}
        >
          {t.datapath.phase[frame.phase]}
          {frame.phase !== 'idle' && line ? ` · ${line.mnemonic} ${line.operand}` : ''}
        </div>
        <div
          className="readout absolute flex items-center justify-center text-xl font-semibold tracking-wide"
          style={box(READOUT_LEFT, READOUT_TOP, READOUT.width, READOUT.height)}
          role="status"
        >
          {frame.rtl || '—'}
        </div>
      </div>
    </div>
  )
}

function Controls() {
  const t = useT()
  const loaded = dpStore.use((s) => s.snap.state !== 'noProgram')
  const waiting = dpStore.use((s) => s.snap.state === 'blockedOnInput')
  const running = dpStore.use((s) => s.running !== null)
  const delay = dpStore.use((s) => s.delay)
  const fastFetch = dpStore.use((s) => s.fastFetch)
  const inputRadix = dpStore.use((s) => s.inputRadix)
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
      <div className="ml-3 flex h-15 items-center">
        <Switch variant="panel" checked={fastFetch} onChange={setFastFetch}>
          {t.datapath.fastFetch}
        </Switch>
      </div>
      <div className="ml-3 flex h-15 items-center gap-2">
        <label htmlFor="dp-in" className="silk">
          {t.teletype.input}
        </label>
        <MachineInput
          id="dp-in"
          waiting={waiting}
          placeholder={waiting ? 'Enter ↵' : t.datapath.notExpected}
          className="readout h-11 w-36 px-2.5 text-sm placeholder:text-dim"
          onSubmit={provideInput}
        />
        <RadixButton name={t.teletype.input} radix={inputRadix} onChange={setInputRadix} />
      </div>
      <DelaySlider
        id="dp-delay"
        label={t.datapath.microDelay}
        value={delay}
        min={0}
        max={DP_DELAY_MAX}
        step={100}
        minLabel={t.panel.delayValue(DP_DELAY_MIN)}
        onChange={setDelay}
      />
    </div>
  )
}

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
        {PART_NAMES.map((name, code) => (
          <div key={code} className={cn(grid, 'h-7.5', code % 2 === 1 && 'bg-bar')}>
            <div>{binary(code)}</div>
            <div>{name || t.datapath.memory.toLowerCase()}</div>
          </div>
        ))}
      </div>
      <p className="px-4 pt-2.5 pb-3.5 text-xs leading-4.5 text-fan-dim">{t.datapath.codesNote}</p>
    </section>
  )
}

function Trace() {
  const t = useT()
  const trace = dpStore.use((s) => s.trace)
  const total = dpStore.use((s) => s.snap.traceLen)
  const paper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (paper.current) paper.current.scrollTop = paper.current.scrollHeight
  }, [trace])

  const first = total - trace.length
  return (
    <section
      aria-label={t.datapath.trace}
      className="tty min-w-0 flex-[1_1_27.5rem] rounded-plate bg-paper text-ink shadow-[0_3px_0_rgb(0_0_0/0.5)]"
    >
      <PaperHeader title={t.datapath.trace}>
        <button
          type="button"
          className="h-11 rounded border border-ink px-3 text-code hover:bg-key-cream disabled:opacity-45"
          disabled={total === 0}
          onClick={() => exportTrace()}
        >
          {t.datapath.saveTrace}
        </button>
      </PaperHeader>
      <div className="border-t border-paper-rule px-4 pt-2 font-mono text-sm leading-6 font-semibold whitespace-pre">
        {'  IR   OUT    IN    AC   MBR   PC   MAR'}
      </div>
      <div ref={paper} role="log" className="h-69 overflow-auto px-4 pb-3.5 font-mono text-sm leading-6 whitespace-pre">
        {trace.map((row, i) => (
          <div key={first + i} className={cn(i === trace.length - 1 && 'font-bold')}>
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
          <StatusLine status={status} />
        </div>
      </section>

      <div className="flex flex-wrap items-start gap-4">
        <section aria-label={t.program.title} className="fanfold min-w-0 flex-[1_1_23.75rem]">
          <PaperHeader title={`${t.program.title} · ${fileName}`} />
          <ProgramTable program={program} focusRow={focusRow} />
          <div className="h-3.5" />
        </section>
        <Codes />
        <Trace />
      </div>
    </div>
  )
}
