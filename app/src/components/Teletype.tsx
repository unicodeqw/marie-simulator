import { clearOutput, provideInput, setInputRadix, setLinefeed, setOutputRadix, simStore } from '@/core/sim'
import { hex } from '@/core/format'
import { useT } from '@/i18n'
import { useEffect, useRef } from 'react'
import { MachineInput, RadixSegments, Switch } from './hardware'

// Декоративна клавіатура в розкладці ASR-33.
const KEY_ROWS = ['1 2 3 4 5 6 7 8 9 0 -', 'Q W E R T Y U I O P', 'A S D F G H J K L ;', 'Z X C V B N M , . /']

/** Зсув кожного наступного літерного ряду, px. */
const KEY_STAGGER = 14

const LABEL = 'silk embossed w-12.5 text-xs font-bold tracking-widest'

function Register({ name, value }: { name: string; value: number }) {
  return (
    <div className="readout led ml-auto flex h-8.5 items-center gap-2 px-2.5 text-[1.1875rem]">
      <span className="silk text-dim [text-shadow:none]">{name}</span>
      {hex(value, 4)}
    </div>
  )
}

/** Телетайп: рулон паперу з виводом машини й поле вводу для команди Input. */
export function Teletype() {
  const t = useT()
  const output = simStore.use((s) => s.output)
  const outputRadix = simStore.use((s) => s.outputRadix)
  const inputRadix = simStore.use((s) => s.inputRadix)
  const linefeed = simStore.use((s) => s.linefeed)
  const out = simStore.use((s) => s.snap.output)
  const input = simStore.use((s) => s.snap.input)
  const waiting = simStore.use((s) => s.snap.state === 'blockedOnInput')
  const paper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (paper.current) paper.current.scrollTop = paper.current.scrollHeight
  }, [output])

  return (
    <section aria-label={t.teletype.title} className="flex min-w-0 flex-[1_1_25rem] flex-col">
      <div className="torn-shadow mx-9.5">
        <div
          ref={paper}
          role="log"
          aria-label={t.teletype.output}
          className="torn flex h-56 flex-col overflow-y-auto px-6 pt-6 pb-4 font-mono text-print leading-normal font-medium break-all whitespace-pre-wrap"
        >
          {/* Свіжий рядок — унизу, біля валика; mt-auto лишає прокручування вгору робочим. */}
          <div className="mt-auto">{output}</div>
        </div>
      </div>
      <div className="putty rounded-t-xl rounded-b-[1.25rem]">
        <div className="tty-slot" aria-hidden />
        <div className="flex flex-col gap-3.5 px-5 pt-3.5 pb-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="tty-plate py-0.5 pr-1.5 pl-3 font-condensed text-body leading-5.5 font-bold tracking-[0.18em] uppercase">
              {t.teletype.title}
            </div>
            <div className="silk embossed tracking-widest text-tty-dim">{t.teletype.subtitle}</div>
          </div>

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
            <span className={LABEL}>{t.teletype.output}</span>
            <RadixSegments label={t.teletype.outputRadix} radix={outputRadix} onChange={setOutputRadix} />
            <Register name="OUT" value={out} />
          </div>

          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
            <Switch variant="tty" checked={linefeed} onChange={setLinefeed}>
              {t.teletype.linefeed}
            </Switch>
            <button type="button" className="btn-cream ml-auto px-3.5 text-code" onClick={clearOutput}>
              {t.teletype.clear}
            </button>
          </div>

          <div className="h-0.5 bg-[linear-gradient(180deg,rgb(0_0_0/0.28)_50%,rgb(255_255_255/0.6)_50%)]" aria-hidden />

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
            <label htmlFor="tty-in" className={LABEL}>
              {t.teletype.input}
            </label>
            <MachineInput
              id="tty-in"
              waiting={waiting}
              placeholder={waiting ? t.teletype.waiting : t.teletype.idle}
              formClassName="min-w-0 flex-[1_1_7.5rem] p-1.5"
              className="paper-field h-11 w-full px-3 font-mono text-body placeholder:text-tty-hint"
              onSubmit={provideInput}
            />
            <RadixSegments label={t.teletype.inputRadix} radix={inputRadix} onChange={setInputRadix} />
            <Register name="IN" value={input} />
          </div>

          <div className="keys-tray flex flex-col items-center gap-2.5 px-2.5 pt-3.5 pb-4" aria-hidden>
            {KEY_ROWS.map((row, i) => (
              <div key={row} className="flex gap-1.5" style={{ paddingLeft: KEY_STAGGER * Math.max(0, i - 1) }}>
                {row.split(' ').map((k) => (
                  <span key={k} className="round-key flex size-6.75 items-center justify-center font-condensed text-silk font-semibold">
                    {k}
                  </span>
                ))}
              </div>
            ))}
            <span className="spacebar mt-0.5 h-4.5 w-47.5" />
          </div>
        </div>
      </div>
    </section>
  )
}
