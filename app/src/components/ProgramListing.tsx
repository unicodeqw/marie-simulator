import { hex } from '@/core/format'
import type { AsmSymbol, ProgramLine } from '@/core/types'
import { useT } from '@/i18n'
import type { ReactNode } from 'react'
import { cn } from './styles'
import { useRowInView } from './useRowInView'

export function PaperHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 py-2.5">
      <div className="font-mono text-code font-semibold tracking-wide uppercase">{title}</div>
      {children}
    </div>
  )
}

/** Кнопка на перфопапері; `pressed` робить її половинкою перемикача. */
export function PaperButton({
  children,
  onClick,
  disabled,
  pressed,
  className,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        'h-11 rounded border border-fan-ink px-3 text-code disabled:opacity-45',
        pressed ? 'bg-fan-ink text-fanfold' : 'hover:bg-bar',
        className,
      )}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

const columnHead = 'silk flex h-7 items-center border-y border-fan-rule tracking-widest text-fan-dim'
const SCROLL = 'max-h-90 overflow-y-auto font-mono'

export function SymbolTable({ symbols }: { symbols: AsmSymbol[] | null }) {
  const t = useT()
  if (!symbols) return <p className="px-4 pb-4 text-fan-dim">{t.noSymbols}</p>
  const grid = 'grid grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1.4fr)] items-center px-4'
  return (
    <>
      <div className={cn(columnHead, grid)}>
        <div>{t.editor.symbol}</div>
        <div>{t.editor.address}</div>
        <div>{t.editor.references}</div>
      </div>
      <div className={SCROLL}>
        {symbols.map((s, i) => (
          <div key={s.name} className={cn(grid, 'min-h-7.5', i % 2 === 1 && 'bg-bar')}>
            <div className="truncate">{s.name}</div>
            <div>{hex(s.address, 3)}</div>
            <div>{s.references.map((r) => hex(r, 3)).join(', ')}</div>
          </div>
        ))}
      </div>
      <div className="h-3.5" />
    </>
  )
}

interface Breakpoints {
  marks: boolean[]
  onToggle: (row: number) => void
}

/**
 * Таблиця програми: адреса, мітка, команда, операнд, код. Із `breakpoints`
 * зліва з'являється колонка «перфорації» з точками зупинки.
 */
export function ProgramTable({
  program,
  focusRow,
  breakpoints,
}: {
  program: ProgramLine[]
  /** Рядок команди, що виконується. */
  focusRow: number | null
  breakpoints?: Breakpoints
}) {
  const t = useT()
  const rows = useRowInView(focusRow)
  const grid = cn(
    'grid items-center',
    breakpoints
      ? 'grid-cols-[2.75rem_3.25rem_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_3.5rem]'
      : 'grid-cols-[3.25rem_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_3.5rem] px-4',
  )

  return (
    <>
      <div className={cn(columnHead, grid)}>
        {breakpoints && <div />}
        <div>{t.program.address}</div>
        <div>{t.program.label}</div>
        <div>{t.program.opcode}</div>
        <div>{t.program.operand}</div>
        <div>{t.program.code}</div>
      </div>
      {program.length === 0 ? (
        <p className="px-4 py-4 text-fan-dim">{t.program.empty}</p>
      ) : (
        <div ref={rows} className={SCROLL}>
          {program.map((line, i) => {
            const address = hex(line.address, 3)
            const marked = breakpoints?.marks[i] ?? false
            return (
              <div
                key={i}
                className={cn(grid, breakpoints ? 'h-9' : 'h-7.5', i === focusRow ? 'bg-cursor-row font-bold' : i % 2 === 1 && 'bg-bar')}
              >
                {breakpoints && (
                  <button
                    type="button"
                    aria-pressed={marked}
                    aria-label={t.program.breakpoint(address)}
                    title={t.program.breakpoint(address)}
                    className="flex h-9 w-11 items-center justify-center border-0 bg-transparent p-0"
                    onClick={() => breakpoints.onToggle(i)}
                  >
                    <span className={cn('size-3.5 rounded-full border-2', marked ? 'border-bp bg-bp' : 'border-bp-ring')} />
                  </button>
                )}
                <div>{address}</div>
                <div className="truncate">{line.label}</div>
                <div>{line.mnemonic}</div>
                <div className="truncate">{line.operand}</div>
                <div>{hex(line.word, 4)}</div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
