import type { Radix } from '@/core/types'
import { useT } from '@/i18n'
import { memo, type ReactNode } from 'react'
import { cn } from './styles'

export function Lamp({ on, className }: { on: boolean; className?: string }) {
  return <span className={cn('lamp block size-3', className)} data-on={on} />
}

/**
 * Ряд із 16 ламп на кольорових смугах по тетрадах. Для 12-бітних регістрів
 * старша тетрада порожня.
 */
export const LampRow = memo(function LampRow({ value, width }: { value: number; width: 12 | 16 }) {
  return (
    <div className="flex" aria-hidden>
      {Array.from({ length: 16 }, (_, i) => {
        const bit = 15 - i
        if (bit >= width) return <span key={bit} className="h-[2.875rem] w-[1.875rem]" />
        const rust = (bit >> 2) % 2 === 1
        return (
          <span
            key={bit}
            className={cn(
              'flex h-[2.875rem] w-[1.875rem] items-center justify-center',
              rust ? 'bg-band-rust' : 'bg-band-ochre',
            )}
          >
            <Lamp on={((value >> bit) & 1) === 1} className="size-3.5" />
          </span>
        )
      })}
    </div>
  )
})

const TONES = { ochre: 'bg-key-ochre', rust: 'bg-key-rust', cream: 'bg-key-cream' }

/** Клавіша-лопатка з підписом над нею. */
export function PaddleKey({
  label,
  tone,
  title,
  disabled,
  onClick,
}: {
  label: string
  tone: keyof typeof TONES
  title?: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <div className="flex w-16 flex-col items-center gap-1.5">
      <span className="silk flex min-h-[1.75rem] items-end text-center leading-tight" aria-hidden>
        {label}
      </span>
      <button
        type="button"
        className={cn('paddle', TONES[tone])}
        aria-label={label}
        title={title ?? label}
        disabled={disabled}
        onClick={onClick}
      />
    </div>
  )
}

const RADIX_ORDER: Radix[] = ['hex', 'dec', 'ascii']
const RADIX_LABEL: Record<Radix, string> = { hex: 'HEX', dec: 'DEC', ascii: 'ASCII' }

/** Кнопка на панелі, що по колу перемикає систему числення. */
export function RadixButton({ name, radix, onChange }: { name: string; radix: Radix; onChange: (r: Radix) => void }) {
  const t = useT()
  return (
    <button
      type="button"
      className="silk h-11 w-12 rounded-[3px] border border-edge bg-transparent text-legend hover:bg-white/5"
      aria-label={t.registers.radix(name, t.radix[radix])}
      title={t.registers.radix(name, t.radix[radix])}
      onClick={() => onChange(RADIX_ORDER[(RADIX_ORDER.indexOf(radix) + 1) % RADIX_ORDER.length])}
    >
      {radix === 'ascii' ? 'ASC' : RADIX_LABEL[radix]}
    </button>
  )
}

/** Трипозиційний перемикач HEX / DEC / ASCII на корпусі телетайпа. */
export function RadixSegments({ label, radix, onChange }: { label: string; radix: Radix; onChange: (r: Radix) => void }) {
  return (
    <div role="group" aria-label={label} className="flex">
      {RADIX_ORDER.map((r, i) => (
        <button
          key={r}
          type="button"
          aria-pressed={r === radix}
          className={cn(
            'silk h-11 border border-ink px-3 text-xs',
            i > 0 && 'border-l-0',
            i === 0 && 'rounded-l',
            i === RADIX_ORDER.length - 1 && 'rounded-r',
            r === radix ? 'bg-ink text-paper' : 'bg-key-cream text-ink hover:bg-paper',
          )}
          onClick={() => onChange(r)}
        >
          {RADIX_LABEL[r]}
        </button>
      ))}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  children,
  variant,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  children: ReactNode
  variant: 'panel' | 'tty'
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn(
        'flex h-11 items-center gap-2.5 border-0 bg-transparent p-0',
        variant === 'panel' ? 'silk text-legend' : 'text-[0.8125rem] text-ink',
      )}
      onClick={() => onChange(!checked)}
    >
      <span
        className={cn(
          'flex h-5 w-[2.375rem] rounded-full p-0.5',
          checked ? 'justify-end' : 'justify-start',
          variant === 'panel' ? 'border border-edge bg-well' : 'bg-ink',
        )}
      >
        <span className={cn('size-4 rounded-full', checked ? 'bg-key-ochre' : 'bg-dim')} />
      </span>
      {children}
    </button>
  )
}

/** Рядок стану на панелі машини. */
export function StatusLine({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="readout min-h-[2.625rem] px-3.5 py-2.5 text-sm">
      {children}
    </div>
  )
}
