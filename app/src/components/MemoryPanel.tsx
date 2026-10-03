import { simStore } from '@/core/sim'
import { hex } from '@/core/types'
import { uiStore } from '@/core/ui'
import { useT } from '@/i18n'
import { memo, useEffect, useRef, useState } from 'react'
import { cn } from './styles'

const ROWS = Array.from({ length: 256 }, (_, i) => i)
const COLUMNS = Array.from({ length: 16 }, (_, i) => i)
const grid = 'grid grid-cols-[3.25rem_repeat(16,minmax(0,1fr))] items-center text-center'

// Пам'ять приходить новим масивом після кожної команди; рядок перемальовується,
// лише якщо змінилися його 16 слів або підсвітка.
const Row = memo(
  function Row({ row, memory, focusColumn }: { row: number; memory: Uint16Array; focusColumn: number }) {
    return (
      <div className={cn(grid, 'h-[1.875rem]')}>
        <div className="text-left font-semibold text-[#d9a441]">{hex(row * 16, 3)}</div>
        {COLUMNS.map((c) => {
          const word = memory[row * 16 + c]
          return (
            <div
              key={c}
              className={cn(
                'rounded-[2px] leading-6',
                c === focusColumn ? 'bg-amber font-bold text-[#1a1612]' : word === 0 ? 'text-[#8d867a]' : 'text-[#ede6d4]',
              )}
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

/** Уся пам'ять: 256 рядків по 16 слів; підсвічено комірку операнда останньої команди. */
export function MemoryPanel() {
  const t = useT()
  const memory = simStore.use((s) => s.memory)
  const focus = simStore.use((s) => s.snap.focusCell)
  const visible = uiStore.use((s) => s.tab === 'simulator')
  const [goto, setGoto] = useState('')
  const box = useRef<HTMLDivElement>(null)

  const scrollTo = (address: number, force: boolean) => {
    const el = box.current
    const row = el?.children[address >> 4] as HTMLElement | undefined
    if (!el || !row) return
    const top = row.offsetTop - el.offsetTop
    if (force || top < el.scrollTop || top + row.offsetHeight > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - row.offsetHeight * 2)
    }
  }

  // Як в оригіналі: таблиця сама прокручується до комірки, з якою працює команда;
  // одразу після завантаження показує початок програми.
  const start = simStore.use((s) => s.program[0]?.address ?? null)
  useEffect(() => {
    if (!visible) return
    if (focus !== null) scrollTo(focus, false)
    else if (start !== null) scrollTo(start, true)
  }, [focus, start, visible])

  return (
    <section aria-label={t.memory.title} className="machine min-w-0 flex-[999_1_44rem]">
      <div className="faceplate flex flex-col gap-3 px-4.5 pt-3.5 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <div className="font-condensed text-base font-bold tracking-[0.16em] uppercase">{t.memory.title}</div>
            <div className="silk font-medium tracking-widest text-dim">{t.memory.subtitle}</div>
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const address = Number.parseInt(goto, 16)
              if (!Number.isNaN(address)) scrollTo(Math.min(0xfff, Math.max(0, address)), true)
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
              className="readout h-11 w-16 px-2.5 text-[0.9375rem] uppercase"
              value={goto}
              placeholder="000"
              onChange={(e) => setGoto(e.target.value)}
            />
          </form>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[47.5rem] font-mono text-[0.8125rem]">
            <div className={cn(grid, 'h-[1.625rem] border-b border-hair text-dim')} aria-hidden>
              <div />
              {COLUMNS.map((c) => (
                <div key={c}>+{hex(c, 1)}</div>
              ))}
            </div>
            <div ref={box} className="h-[20.625rem] overflow-y-auto">
              {ROWS.map((row) => (
                <Row key={row} row={row} memory={memory} focusColumn={focus !== null && focus >> 4 === row ? focus & 15 : -1} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
