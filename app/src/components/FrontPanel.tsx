import { ask } from '@/core/confirm'
import {
  DELAY_MAX,
  DELAY_MIN,
  reload,
  reset,
  restart,
  run,
  setDelay,
  setRegisterRadix,
  simStore,
  step,
  stop,
} from '@/core/sim'
import type { RegisterName } from '@/core/types'
import { formatWord, isa } from '@/core/wasm'
import { useT } from '@/i18n'
import { DelaySlider, Lamp, LampRow, Nameplate, PaddleKey, RadixButton, Screws, StatusLine } from './hardware'
import { cn } from './styles'

const REGISTERS: { name: RegisterName; width: 12 | 16 }[] = [
  { name: 'pc', width: 12 },
  { name: 'mar', width: 12 },
  { name: 'mbr', width: 16 },
  { name: 'ac', width: 16 },
  { name: 'ir', width: 16 },
]

// Ширина колонки з підписами ліворуч від ламп.
const LEGEND = 'w-44 flex-none'

function RegisterRow({ name, width }: { name: RegisterName; width: 12 | 16 }) {
  const t = useT()
  const value = simStore.use((s) => s.snap[name])
  const radix = simStore.use((s) => s.registerRadix[name])
  const label = name.toUpperCase()
  const text = formatWord(value, radix, width === 12)
  return (
    <div className="flex items-center border-t border-hair">
      <div className={cn(LEGEND, 'flex items-baseline gap-2')}>
        <span className="w-9.5 font-condensed text-lg font-bold tracking-wider">{label}</span>
        <span className="silk font-medium text-dim">{t.registers[name]}</span>
      </div>
      <LampRow value={value} width={width} />
      <div className="readout led ml-4.5 flex h-9.5 w-23 items-center justify-end px-2.5 text-[1.375rem]" aria-label={`${label} ${text}`}>
        {text}
      </div>
      <div className="ml-2.5">
        <RadixButton name={label} radix={radix} onChange={(r) => setRegisterRadix(name, r)} />
      </div>
    </div>
  )
}

interface StripLamp {
  label: string
  on: boolean
  tone?: 'red'
}

function LampStrip({ title, width, lamps }: { title: string; width: string; lamps: StripLamp[] }) {
  return (
    <div className="flex items-center pt-4">
      <div className={cn(LEGEND, 'silk text-xs tracking-[0.12em] text-dim')}>{title}</div>
      <div className="flex">
        {lamps.map((l) => (
          <div key={l.label} className={cn('flex flex-col items-center gap-2', width)}>
            <Lamp on={l.on} tone={l.tone} />
            <span className="silk text-2xs tracking-wide">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Lamps() {
  const t = useT()
  const state = simStore.use((s) => s.snap.state)
  const running = simStore.use((s) => s.running)
  // Лампа команди світиться лише після першої вибірки.
  const opcode = simStore.use((s) => (s.snap.executed > 0 || s.snap.state === 'fault' ? s.snap.ir >> 12 : -1))
  return (
    <>
      <LampStrip
        title={t.panel.instruction}
        width="w-12"
        lamps={isa.instructions.map((instruction, i) => ({ label: instruction.name, on: i === opcode }))}
      />
      <LampStrip
        title={t.panel.state}
        width="w-20.5"
        lamps={[
          { label: t.panel.lamps.running, on: running !== null && state === 'ready' },
          { label: t.panel.lamps.paused, on: state === 'paused' },
          { label: t.panel.lamps.input, on: state === 'blockedOnInput' },
          { label: t.panel.lamps.halted, on: state === 'halted' },
          { label: t.panel.lamps.fault, on: state === 'fault', tone: 'red' },
        ]}
      />
    </>
  )
}

function Controls() {
  const t = useT()
  const loaded = simStore.use((s) => s.snap.state !== 'noProgram')
  const running = simStore.use((s) => s.running !== null)
  const delay = simStore.use((s) => s.delay)
  return (
    <div className="keyrail flex flex-wrap items-end gap-x-3 gap-y-4 px-3.5 pt-3.5 pb-4">
      <PaddleKey label={t.panel.run} tone="ochre" title={`${t.panel.run} (F5)`} disabled={!loaded} onClick={() => run('run')} />
      <PaddleKey label={t.panel.stop} tone="rust" title={`${t.panel.stop} (Shift+F5)`} disabled={!running} onClick={stop} />
      <PaddleKey label={t.panel.step} tone="ochre" title={`${t.panel.step} (F10)`} disabled={!loaded} onClick={step} />
      <PaddleKey label={t.panel.runToBreakpoint} tone="rust" disabled={!loaded} onClick={() => run('breakpoints')} />
      <PaddleKey label={t.panel.restart} tone="ochre" title={t.panel.restartHint} disabled={!loaded} onClick={restart} />
      <PaddleKey label={t.panel.reload} tone="rust" title={t.panel.reloadHint} disabled={!loaded} onClick={reload} />
      <PaddleKey
        label={t.panel.reset}
        tone="cream"
        title={t.panel.resetHint}
        onClick={async () => {
          if (await ask('reset')) reset()
        }}
      />
      <DelaySlider id="sim-delay" label={t.panel.delay} value={delay} min={DELAY_MIN} max={DELAY_MAX} step={10} onChange={setDelay} />
    </div>
  )
}

export function FrontPanel() {
  const t = useT()
  const status = simStore.use((s) => s.status)
  return (
    <section aria-label="MARIE·16" className="machine min-w-0 flex-[999_1_51rem]">
      <Screws />
      <div className="faceplate flex flex-col gap-4 px-5.5 pt-5 pb-5.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <Nameplate />
          <div className="silk text-xs font-medium tracking-[0.12em] text-dim">{t.panel.subtitle}</div>
        </div>

        <div className="overflow-x-auto">
          <div className="flex min-w-215 flex-col">
            <div className="flex items-center" aria-hidden>
              <div className={LEGEND} />
              {Array.from({ length: 16 }, (_, i) => (
                <span key={i} className="flex h-5.5 w-8 items-center justify-center font-mono text-2xs font-medium text-dim">
                  {15 - i}
                </span>
              ))}
            </div>
            {REGISTERS.map((r) => (
              <RegisterRow key={r.name} {...r} />
            ))}
            <div className="border-t border-hair" />
            <Lamps />
          </div>
        </div>

        <Controls />
        <StatusLine status={status} />
      </div>
    </section>
  )
}
