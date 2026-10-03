import type { Radix, Status } from '@/core/types'
import { useT } from '@/i18n'
import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cn } from './styles'

export function Lamp({ on, tone, className }: { on: boolean; tone?: 'red'; className?: string }) {
  return <span className={cn('lamp block size-3', className)} data-on={on} data-tone={tone} />
}

// Кут шліца в кожного гвинта свій, як після викрутки.
const SCREWS = [
  { at: 'top-1.5 left-1.5', slot: '35deg' },
  { at: 'top-1.5 right-1.5', slot: '120deg' },
  { at: 'bottom-1.5 left-1.5', slot: '80deg' },
  { at: 'right-1.5 bottom-1.5', slot: '160deg' },
]

/** Чотири гвинти по кутах найближчого позиціонованого предка. */
export function Screws() {
  return (
    <>
      {SCREWS.map((s) => (
        <span key={s.at} className={cn('screw', s.at)} style={{ '--slot': s.slot } as CSSProperties} aria-hidden />
      ))}
    </>
  )
}

/** Шильдик машини. */
export function Nameplate() {
  return (
    <div className="brushed rounded-xs py-1 pr-2 pl-4 font-condensed text-[1.625rem] leading-8.5 font-bold tracking-[0.22em]">
      MARIE·16
    </div>
  )
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
        if (bit >= width) return <span key={bit} className="h-12.5 w-8" />
        const rust = (bit >> 2) % 2 === 1
        return (
          <span key={bit} className={cn('flex h-12.5 w-8 items-center justify-center', rust ? 'bg-band-rust' : 'bg-band-ochre')}>
            <Lamp on={((value >> bit) & 1) === 1} className="size-[0.9375rem]" />
          </span>
        )
      })}
    </div>
  )
})

const TONES = { ochre: 'paddle-ochre', rust: 'paddle-rust', cream: 'paddle-cream' }

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
    <div className="flex w-16.5 flex-col items-center gap-1.5">
      <span className="silk flex min-h-7 items-end text-center leading-tight" aria-hidden>
        {label}
      </span>
      <div className="paddle-slot">
        <button
          type="button"
          className={cn('paddle', TONES[tone])}
          aria-label={label}
          title={title ?? label}
          disabled={disabled}
          onClick={onClick}
        />
      </div>
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
      className="panel-key silk h-11 w-12.5"
      aria-label={hint}
      title={hint}
      onClick={() => onChange(RADIXES[(RADIXES.indexOf(radix) + 1) % RADIXES.length])}
    >
      {RADIX_SHORT[radix]}
    </button>
  )
}

/** Три клавіші з фіксацією HEX / DEC / ASCII на корпусі телетайпа. */
export function RadixSegments({ label, radix, onChange }: { label: string; radix: Radix; onChange: (r: Radix) => void }) {
  return (
    <div role="group" aria-label={label} className="seg-group">
      {RADIXES.map((r) => (
        <button key={r} type="button" aria-pressed={r === radix} className="seg silk text-xs font-bold" onClick={() => onChange(r)}>
          {RADIX_LABEL[r]}
        </button>
      ))}
    </div>
  )
}

/** Тумблер: важілець угору — увімкнено. */
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
        'flex min-h-12.5 items-center gap-3 border-0 bg-transparent p-0 pl-1 text-left',
        variant === 'panel' ? 'silk text-legend' : 'text-code text-ink',
      )}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle" aria-hidden />
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
        <span className="font-mono tracking-normal text-amber normal-case [text-shadow:0_0_6px_rgb(255_150_40/0.6)]">
          {t.panel.delayValue(value)}
        </span>
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
      <div className="slider-ticks" aria-hidden />
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
        className={cn(className, waiting && 'outline-3 outline-offset-6 outline-key-ochre')}
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
