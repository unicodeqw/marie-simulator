import { answer, confirmStore } from '@/core/confirm'
import { saveDump } from '@/core/fileActions'
import { hex, parseAddress } from '@/core/format'
import { projectStore } from '@/core/project'
import { coreDump, simStore } from '@/core/sim'
import { isa } from '@/core/wasm'
import { useT } from '@/i18n'
import { X } from 'lucide-react'
import { AlertDialog, Dialog } from 'radix-ui'
import { useMemo, useState, type ReactNode } from 'react'

const overlay = 'fixed inset-0 z-40 bg-black/55'
const sheet =
  'fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[min(46rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line bg-chrome p-6 text-chrome-fg shadow-[0_16px_48px_rgb(0_0_0/0.4)]'
const button = 'h-11 rounded-md border border-line px-4 hover:bg-line/30'
const primary = 'h-11 rounded-md bg-key-ochre px-5 font-semibold text-on-lit hover:brightness-110'

function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  children: ReactNode
}) {
  const t = useT()
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content className={sheet} aria-describedby={undefined}>
          <div className="mb-4 flex items-start justify-between gap-4">
            <Dialog.Title className="font-condensed text-xl font-bold tracking-wider">{title}</Dialog.Title>
            <Dialog.Close className="flex size-11 items-center justify-center rounded-md hover:bg-line/30" aria-label={t.close}>
              <X className="size-5" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Єдиний на застосунок діалог підтвердження; питання ставить `ask()`. */
export function ConfirmHost() {
  const t = useT()
  const question = confirmStore.use((s) => s.question)
  return (
    <AlertDialog.Root open={question !== null} onOpenChange={(open) => !open && answer(false)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={overlay} />
        <AlertDialog.Content className={`${sheet} w-[min(28rem,calc(100vw-2rem))]`}>
          <AlertDialog.Title className="sr-only">{t.appName}</AlertDialog.Title>
          <AlertDialog.Description className="text-base">
            {question === 'reset' ? t.panel.resetConfirm : t.unsaved}
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Cancel className={button}>{t.cancel}</AlertDialog.Cancel>
            <AlertDialog.Action className={primary} onClick={() => answer(true)}>
              {t.confirm}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

export function AboutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useT()
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="MARIE·16">
      <div className="flex flex-col gap-3 text-base">
        <p>{t.about.text}</p>
        <p>{t.about.original}</p>
        <p className="font-mono text-sm text-ed-dim">{t.about.version(__APP_VERSION__)}</p>
      </div>
    </Sheet>
  )
}

export function InstructionSetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useT()
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t.isa.title}>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line font-condensed text-xs tracking-wider uppercase">
            <th className="py-2 pr-4 font-semibold">{t.isa.mnemonic}</th>
            <th className="py-2 pr-4 font-semibold">{t.isa.hex}</th>
            <th className="py-2 font-semibold">{t.isa.action}</th>
          </tr>
        </thead>
        <tbody>
          {isa.instructions.map((instruction, opcode) => (
            <tr key={instruction.name} className="border-b border-line/50">
              <td className="py-1.5 pr-4 font-mono font-semibold whitespace-nowrap">
                {instruction.name}
                {instruction.takesOperand && ' X'}
              </td>
              <td className="py-1.5 pr-4 font-mono">{hex(opcode, 1)}</td>
              <td className="py-1.5">{t.isa.rows[opcode]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex flex-col gap-2">
        <p>{t.isa.skipcond}</p>
        <p>{t.isa.directives}</p>
        <p>{t.isa.operands}</p>
        <p className="text-ed-dim">{t.isa.keys}</p>
      </div>
    </Sheet>
  )
}

export function CoreDumpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={useT().dump.title}>
      {open && <CoreDump />}
    </Sheet>
  )
}

function CoreDump() {
  const t = useT()
  const program = simStore.use((s) => s.program)
  const fileName = projectStore.use((s) => s.fileName)
  // Діапазон типово охоплює програму, як в оригіналі.
  const [from, setFrom] = useState(() => hex(program[0]?.address ?? 0, 3))
  const [to, setTo] = useState(() => hex(program.at(-1)?.address ?? 0xff, 3))
  const start = parseAddress(from) ?? 0
  const end = parseAddress(to) ?? 0
  // Дамп — знімок машини на момент відкриття діалогу чи зміни діапазону;
  // у файл іде саме показаний текст.
  const text = useMemo(() => coreDump(fileName, start, end), [fileName, start, end])
  const field = 'h-11 w-20 rounded-md border border-line bg-ed px-3 font-mono uppercase text-ed-fg'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          {t.dump.from}
          <input className={field} value={from} maxLength={3} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.dump.to}
          <input className={field} value={to} maxLength={3} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" className={`${primary} ml-auto`} onClick={() => saveDump(text)}>
          {t.dump.save}
        </button>
      </div>
      <pre className="max-h-[50dvh] overflow-auto rounded-md border border-line bg-ed p-4 font-mono text-code leading-5 text-ed-fg">
        {text}
      </pre>
    </div>
  )
}
