import { hex, parseAddress } from '@/core/format'
import { simStore } from '@/core/sim'
import { useT } from '@/i18n'
import { memo, useEffect, useRef, useState } from 'react'
import { Lamp } from './hardware'
import { cn } from './styles'

const ROWS = Array.from({ length: 256 }, (_, i) => i)
const COLUMNS = Array.from({ length: 16 }, (_, i) => i)
const grid = 'grid grid-cols-[3.25rem_repeat(16,minmax(0,1fr))] items-center text-center'

// Пам'ять приходить новим масивом після кожної команди; рядок перемальовується,
// лише якщо змінилися його 16 слів або підсвітка.
const Row = memo(
  function Row({ row, memory, focusColumn }: { row: number; memory: Uint16Array; focusColumn: number }) {
    return (
      <div className={cn(grid, 'h-7.5')}>
        <div className="text-left font-bold text-phosphor-hi">{hex(row * 16, 3)}</div>
        {COLUMNS.map((c) => {
          const word = memory[row * 16 + c]
          return (
            <div
              key={c}
              className={cn('rounded-xs leading-6', c === focusColumn ? 'crt-inverse font-bold' : word === 0 && 'text-phosphor-dim')}
            >
              {hex(word, 4)}
            </div>
          )
        })}
      </div>
    )
  },
  (a, b) => {
    if (a.focusColumn !== b.focusColumn) return false
    const base = a.row * 16
    for (let i = base; i < base + 16; i++) if (a.memory[i] !== b.memory[i]) return false
    return true
  },
)

/** Уся пам'ять на екрані монітора: 256 рядків по 16 слів; комірку операнда останньої команди показано інверсією. */
export function MemoryPanel() {
  const t = useT()
  const memory = simStore.use((s) => s.memory)
  const focus = simStore.use((s) => s.snap.focusCell)
  const start = simStore.use((s) => s.program[0]?.address ?? null)
  const [goto, setGoto] = useState('')
  const box = useRef<HTMLDivElement>(null)

  // `always` прокручує, навіть якщо рядок уже видно (перехід за адресою).
  const scrollTo = (address: number, always: boolean) => {
    const el = box.current
    const row = el?.children[address >> 4] as HTMLElement | undefined
    if (!el || !row) return
    const top = row.offsetTop - el.offsetTop
    if (always || top < el.scrollTop || top + row.offsetHeight > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - row.offsetHeight * 2)
    }
  }

  // Як в оригіналі: таблиця сама прокручується до комірки, з якою працює команда;
  // одразу після завантаження показує початок програми.
  useEffect(() => {
    if (focus !== null) scrollTo(focus, false)
    else if (start !== null) scrollTo(start, true)
  }, [focus, start])

  return (
    <section aria-label={t.memory.title} className="machine min-w-0 flex-[999_1_44rem] rounded-[1.125rem] px-4.5 pt-4.5 pb-3.5 text-legend">
      <div className="crt-bezel">
        <div className="crt px-5 pt-4 pb-4.5 font-mono text-code">
          <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2.5">
            <div className="text-body font-bold tracking-[0.12em] text-phosphor-hi uppercase">{t.memory.title}</div>
            <div className="tracking-wider uppercase">{t.memory.subtitle}</div>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-190">
              <div className={cn(grid, 'h-6.5 border-b border-led/45')} aria-hidden>
                <div />
                {COLUMNS.map((c) => (
                  <div key={c}>+{hex(c, 1)}</div>
                ))}
              </div>
              <div ref={box} className="h-82.5 overflow-y-auto">
                {ROWS.map((row) => (
                  <Row key={row} row={row} memory={memory} focusColumn={focus !== null && focus >> 4 === row ? focus & 15 : -1} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 px-1.5 pt-3.5">
        <Lamp on />
        <span className="silk tracking-widest text-dim">{t.memory.power}</span>
        <form
          className="ml-auto flex items-center gap-2.5"
          onSubmit={(e) => {
            e.preventDefault()
            const address = parseAddress(goto)
            if (address !== null) scrollTo(address, true)
          }}
        >
          <label htmlFor="mem-goto" className="silk tracking-widest">
            {t.memory.goto}
          </label>
          <input
            id="mem-goto"
            type="text"
            maxLength={3}
            autoComplete="off"
            spellCheck={false}
            className="readout led h-11 w-18 px-2.5 text-xl uppercase placeholder:text-phosphor-dim"
            value={goto}
            placeholder="000"
            onChange={(e) => setGoto(e.target.value)}
          />
        </form>
      </div>
    </section>
  )
}
