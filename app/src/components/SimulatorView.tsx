import { projectStore } from '@/core/project'
import { clearBreakpoints, simStore, toggleBreakpoint } from '@/core/sim'
import { useT } from '@/i18n'
import { useState } from 'react'
import { FrontPanel } from './FrontPanel'
import { MemoryPanel } from './MemoryPanel'
import { PaperButton, PaperHeader, ProgramTable, SymbolTable } from './ProgramListing'
import { Teletype } from './Teletype'

/** Програма на перфопапері: лістинг із точками зупинки або таблиця символів. */
function ProgramPaper() {
  const t = useT()
  const [view, setView] = useState<'listing' | 'symbols'>('listing')
  const program = simStore.use((s) => s.program)
  const focusRow = simStore.use((s) => s.snap.focusRow)
  const marks = simStore.use((s) => s.snap.breakpoints)
  const fileName = projectStore.use((s) => s.fileName)
  const symbols = projectStore.use((s) => s.report?.symbols ?? null)

  return (
    <section aria-label={t.program.title} className="fanfold min-w-0 flex-[1_1_28.75rem]">
      <PaperHeader title={`${t.program.title} · ${fileName}`}>
        <div role="group" className="flex">
          <PaperButton pressed={view === 'listing'} className="rounded-r-none" onClick={() => setView('listing')}>
            {t.program.listing}
          </PaperButton>
          <PaperButton pressed={view === 'symbols'} className="rounded-l-none border-l-0" onClick={() => setView('symbols')}>
            {t.program.symbols}
          </PaperButton>
        </div>
      </PaperHeader>
      {view === 'symbols' ? (
        <SymbolTable symbols={symbols} />
      ) : (
        <>
          <ProgramTable program={program} focusRow={focusRow} breakpoints={{ marks, onToggle: toggleBreakpoint }} />
          <div className="flex min-h-3.5 justify-end px-4 py-1">
            {marks.some(Boolean) && <PaperButton onClick={clearBreakpoints}>{t.program.clearBreakpoints}</PaperButton>}
          </div>
        </>
      )}
    </section>
  )
}

export function SimulatorView() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end gap-7">
        <FrontPanel />
        <Teletype />
      </div>
      <div className="flex flex-wrap items-start gap-7">
        <ProgramPaper />
        <MemoryPanel />
      </div>
    </div>
  )
}
