import { hex, type AsmSymbol, type ProgramLine } from '@/core/types'
import { useT } from '@/i18n'
import { useState, type ReactNode } from 'react'
import { cn, useRowInView } from './styles'

const paperButton = 'h-11 border border-fan-ink px-3 text-[0.8125rem]'

export function PaperHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 py-2.5">
      <div className="font-mono text-[0.8125rem] font-semibold tracking-wide uppercase">{title}</div>
      {children}
    </div>
  )
}

export function PaperButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={cn(paperButton, 'rounded hover:bg-bar disabled:opacity-45')}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

const columnHead = 'silk flex h-7 items-center border-y border-fan-rule tracking-widest text-fan-dim'

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
      <div className="max-h-[22.5rem] overflow-y-auto font-mono">
        {symbols.map((s, i) => (
          <div key={s.name} className={cn(grid, 'min-h-[1.875rem]', i % 2 === 1 && 'bg-bar')}>
            <div className="truncate">{s.name}</div>
            <div>{s.address}</div>
            <div>{s.references.join(', ')}</div>
          </div>
        ))}
      </div>
      <div className="h-3.5" />
    </>
  )
}

interface Props {
  title: string
  program: ProgramLine[]
  /** Рядок команди, що виконується. */
  focusRow: number | null
  /** Із точками зупинки зліва з'являється колонка «перфорації». */
  breakpoints?: boolean[]
  onToggle?: (row: number) => void
  onClear?: () => void
  symbols?: AsmSymbol[] | null
  /** Розділ із лістингом зараз на екрані. */
  visible: boolean
}

/** Монітор програми на перфопапері: адреса, мітка, команда, операнд, код. */
export function ProgramListing({ title, program, focusRow, breakpoints, onToggle, onClear, symbols, visible }: Props) {
  const t = useT()
  const [view, setView] = useState<'listing' | 'symbols'>('listing')
  const rows = useRowInView(focusRow, visible)
  const marks = breakpoints !== undefined
  const grid = cn(
    'grid items-center',
    marks
      ? 'grid-cols-[2.75rem_3.25rem_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_3.5rem]'
      : 'grid-cols-[3.25rem_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_3.5rem] px-4',
  )

  return (
    <section aria-label={t.program.title} className="fanfold min-w-0">
      <PaperHeader title={title}>
        {symbols !== undefined && (
          <div role="group" className="flex">
            {(['listing', 'symbols'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                className={cn(
                  paperButton,
                  v === 'listing' ? 'rounded-l' : 'rounded-r border-l-0',
                  view === v ? 'bg-fan-ink text-fanfold' : 'hover:bg-bar',
                )}
                onClick={() => setView(v)}
              >
                {t.program[v]}
              </button>
            ))}
          </div>
        )}
      </PaperHeader>

      {view === 'symbols' ? (
        <SymbolTable symbols={symbols ?? null} />
      ) : (
        <>
          <div className={cn(columnHead, grid)}>
            {marks && <div />}
            <div>{t.program.address}</div>
            <div>{t.program.label}</div>
            <div>{t.program.opcode}</div>
            <div>{t.program.operand}</div>
            <div>{t.program.code}</div>
          </div>
          {program.length === 0 ? (
            <p className="px-4 py-4 text-fan-dim">{t.program.empty}</p>
          ) : (
            <div ref={rows} className="max-h-[22.5rem] overflow-y-auto font-mono">
              {program.map((line, i) => {
                const address = hex(line.address, 3)
                return (
                  <div
                    key={i}
                    className={cn(
                      grid,
                      marks ? 'h-9' : 'h-[1.875rem]',
                      i === focusRow ? 'bg-cursor-row font-bold' : i % 2 === 1 && 'bg-bar',
                    )}
                  >
                    {marks && (
                      <button
                        type="button"
                        aria-pressed={breakpoints[i]}
                        aria-label={t.program.breakpoint(address)}
                        title={t.program.breakpoint(address)}
                        className="flex h-9 w-11 items-center justify-center border-0 bg-transparent p-0"
                        onClick={() => onToggle?.(i)}
                      >
                        <span
                          className={cn(
                            'size-3.5 rounded-full border-2',
                            breakpoints[i] ? 'border-bp bg-bp' : 'border-bp-ring',
                          )}
                        />
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
          <div className="flex min-h-3.5 justify-end px-4 py-1">
            {marks && breakpoints.some(Boolean) && <PaperButton onClick={() => onClear?.()}>{t.program.clearBreakpoints}</PaperButton>}
          </div>
        </>
      )}
    </section>
  )
}
