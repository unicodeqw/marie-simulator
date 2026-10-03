import { clearOutput, provideInput, setInputRadix, setLinefeed, setOutputRadix, simStore } from '@/core/sim'
import { hex } from '@/core/types'
import { uiStore } from '@/core/ui'
import { useT } from '@/i18n'
import { useEffect, useRef, useState } from 'react'
import { RadixSegments, Switch } from './hardware'
import { cn } from './styles'

const KEY_ROWS = ['1 2 3 4 5 6 7 8 9 0 -', 'Q W E R T Y U I O P', 'A S D F G H J K L ;', 'Z X C V B N M , . /']

function Register({ name, value }: { name: string; value: number }) {
  return (
    <div className="readout ml-auto flex h-8 items-center gap-2 border-0 px-2.5 text-[0.9375rem]">
      <span className="text-[0.6875rem] text-dim">{name}</span>
      {hex(value, 4)}
    </div>
  )
}

function InputField() {
  const t = useT()
  const waiting = simStore.use((s) => s.snap.state === 'blockedOnInput')
  const [text, setText] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (waiting) ref.current?.focus()
  }, [waiting])

  return (
    <form
      className="min-w-0 flex-[1_1_7.5rem]"
      onSubmit={(e) => {
        e.preventDefault()
        provideInput(text)
        setText('')
      }}
    >
      <input
        ref={ref}
        id="tty-in"
        type="text"
        autoComplete="off"
        spellCheck={false}
        disabled={!waiting}
        value={text}
        placeholder={waiting ? t.teletype.waiting : t.teletype.idle}
        className={cn(
          'h-11 w-full rounded border border-ink bg-paper px-3 font-mono text-[0.9375rem] text-ink placeholder:text-[#5c564a] disabled:bg-tty',
          waiting && 'ring-3 ring-key-ochre',
        )}
        onChange={(e) => setText(e.target.value)}
      />
    </form>
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
  const paper = useRef<HTMLDivElement>(null)
  const visible = uiStore.use((s) => s.tab === 'simulator')

  useEffect(() => {
    if (paper.current) paper.current.scrollTop = paper.current.scrollHeight
  }, [output, visible])

  return (
    <section aria-label={t.teletype.title} className="tty flex min-w-0 flex-[1_1_25rem] flex-col">
      <div
        ref={paper}
        role="log"
        aria-label={t.teletype.output}
        className="mx-7 flex h-56 flex-col overflow-y-auto rounded-t-sm bg-paper px-5 pt-4 pb-3 font-mono text-[1.0625rem] leading-normal font-medium break-all whitespace-pre-wrap text-ink"
      >
        {/* Свіжий рядок — унизу, біля валика; mt-auto лишає прокручування вгору робочим. */}
        <div className="mt-auto">{output}</div>
      </div>
      <div className="rounded-[10px] bg-tty text-ink shadow-[0_3px_0_#000]">
        <div className="h-3.5 rounded-t-[10px] bg-tty-slot" />
        <div className="flex flex-col gap-3.5 px-4.5 pt-3.5 pb-4.5">
          <div className="flex items-baseline justify-between">
            <div className="font-condensed text-base font-bold tracking-[0.16em] uppercase">{t.teletype.title}</div>
            <div className="silk font-medium tracking-widest text-[#4a453b]">{t.teletype.subtitle}</div>
          </div>

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
            <span className="silk w-13 text-xs tracking-widest">{t.teletype.output}</span>
            <RadixSegments label={t.teletype.outputRadix} radix={outputRadix} onChange={setOutputRadix} />
            <Register name="OUT" value={out} />
          </div>

          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
            <Switch variant="tty" checked={linefeed} onChange={setLinefeed}>
              {t.teletype.linefeed}
            </Switch>
            <button
              type="button"
              className="ml-auto h-11 rounded border border-ink bg-key-cream px-3.5 text-[0.8125rem] hover:bg-paper"
              onClick={clearOutput}
            >
              {t.teletype.clear}
            </button>
          </div>

          <div className="h-px bg-tty-rule" />

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
            <label htmlFor="tty-in" className="silk w-13 text-xs tracking-widest">
              {t.teletype.input}
            </label>
            <InputField />
            <RadixSegments label={t.teletype.inputRadix} radix={inputRadix} onChange={setInputRadix} />
            <Register name="IN" value={input} />
          </div>

          <div className="flex flex-col items-center gap-1.5 pt-1.5" aria-hidden>
            {KEY_ROWS.map((row) => (
              <div key={row} className="flex gap-1.5">
                {row.split(' ').map((k) => (
                  <span
                    key={k}
                    className="flex size-[1.625rem] items-center justify-center rounded-full bg-tty-key font-condensed text-[0.6875rem] font-semibold text-legend shadow-[0_2px_0_#1e211c]"
                  >
                    {k}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
