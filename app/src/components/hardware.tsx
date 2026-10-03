import type { Radix, Status } from '@/core/types'
import { useT } from '@/i18n'
import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
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
        if (bit >= width) return <span key={bit} className="h-11.5 w-7.5" />
        const rust = (bit >> 2) % 2 === 1
        return (
          <span key={bit} className={cn('flex h-11.5 w-7.5 items-center justify-center', rust ? 'bg-band-rust' : 'bg-band-ochre')}>
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
      <span className="silk flex min-h-7 items-end text-center leading-tight" aria-hidden>
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

const RADIXES: Radix[] = ['hex', 'dec', 'ascii']
const RADIX_LABEL: Record<Radix, string> = { hex: 'HEX', dec: 'DEC', ascii: 'ASCII' }
// На панелі кнопка вужча, тому ASCII скорочено.
const RADIX_SHORT: Record<Radix, string> = { ...RADIX_LABEL, ascii: 'ASC' }

/** Кнопка на панелі, що по колу перемикає систему числення. */
export function RadixButton({ name, radix, onChange }: { name: string; radix: Radix; onChange: (r: Radix) => void }) {
  const t = useT()
  const hint = t.registers.radix(name, t.radix[radix])
  return (
    <button
      type="button"
      className="silk h-11 w-12 rounded-plate border border-edge bg-transparent text-legend hover:bg-white/5"
      aria-label={hint}
      title={hint}
      onClick={() => onChange(RADIXES[(RADIXES.indexOf(radix) + 1) % RADIXES.length])}
    >
      {RADIX_SHORT[radix]}
    </button>
  )
}

/** Трипозиційний перемикач HEX / DEC / ASCII на корпусі телетайпа. */
export function RadixSegments({ label, radix, onChange }: { label: string; radix: Radix; onChange: (r: Radix) => void }) {
  return (
    <div role="group" aria-label={label} className="flex">
      {RADIXES.map((r) => (
        <button
          key={r}
          type="button"
          aria-pressed={r === radix}
          className={cn(
            'silk h-11 border border-ink px-3 text-xs not-first:border-l-0 first:rounded-l last:rounded-r',
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
        variant === 'panel' ? 'silk text-legend' : 'text-code text-ink',
      )}
      onClick={() => onChange(!checked)}
    >
      <span
        className={cn(
          'flex h-5 w-9.5 rounded-full p-0.5',
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

/** Повзунок затримки з підписом, поточним значенням і межами шкали. */
export function DelaySlider({
  id,
  label,
  value,
  min,
  max,
  step,
  minLabel,
  onChange,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  /** Підпис лівого краю шкали, якщо він не збігається з `min`. */
  minLabel?: string
  onChange: (value: number) => void
}) {
  const t = useT()
  return (
    <div className="ml-auto flex min-w-56 flex-col gap-1.5">
      <label htmlFor={id} className="silk flex justify-between gap-3">
        <span>{label}</span>
        <span className="font-mono tracking-normal text-amber normal-case">{t.panel.delayValue(value)}</span>
      </label>
      <input
        id={id}
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="flex justify-between font-mono text-2xs text-dim" aria-hidden>
        <span>{minLabel ?? min}</span>
        <span>{t.panel.delayValue(max)}</span>
      </div>
    </div>
  )
}

/**
 * Поле для команди Input: активне, лише поки машина чекає вводу, і саме
 * бере фокус. Значення надсилається клавішею Enter.
 */
export function MachineInput({
  id,
  waiting,
  placeholder,
  className,
  formClassName,
  onSubmit,
}: {
  id: string
  waiting: boolean
  placeholder: string
  className: string
  formClassName?: string
  onSubmit: (text: string) => void
}) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (waiting) ref.current?.focus()
  }, [waiting])

  return (
    <form
      className={formClassName}
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(text)
        setText('')
      }}
    >
      <input
        ref={ref}
        id={id}
        type="text"
        autoComplete="off"
        spellCheck={false}
        disabled={!waiting}
        value={text}
        placeholder={placeholder}
        className={cn(className, waiting && 'ring-3 ring-key-ochre')}
        onChange={(e) => setText(e.target.value)}
      />
    </form>
  )
}

/** Рядок стану на панелі машини. */
export function StatusLine({ status }: { status: Status }) {
  const t = useT()
  return (
    <div role="status" className="readout min-h-10.5 px-3.5 py-2.5 text-sm">
      {t.status[status.key]}
      {status.key === 'fault' && status.fault ? t.fault[status.fault] : null}
    </div>
  )
}
