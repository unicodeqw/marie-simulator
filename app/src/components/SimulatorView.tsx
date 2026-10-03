import { projectStore } from '@/core/project'
import { clearBreakpoints, simStore, toggleBreakpoint } from '@/core/sim'
import { uiStore } from '@/core/ui'
import { useT } from '@/i18n'
import { FrontPanel } from './FrontPanel'
import { MemoryPanel } from './MemoryPanel'
import { ProgramListing } from './ProgramListing'
import { Teletype } from './Teletype'

export function SimulatorView() {
  const t = useT()
  const program = simStore.use((s) => s.program)
  const focusRow = simStore.use((s) => s.snap.focusRow)
  const breakpoints = simStore.use((s) => s.snap.breakpoints)
  const fileName = projectStore.use((s) => s.fileName)
  const symbols = projectStore.use((s) => s.report?.symbols ?? null)
  const visible = uiStore.use((s) => s.tab === 'simulator')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <FrontPanel />
        <Teletype />
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[1_1_28.75rem]">
          <ProgramListing
            title={`${t.program.title} · ${fileName}`}
            program={program}
            focusRow={focusRow}
            breakpoints={breakpoints}
            onToggle={toggleBreakpoint}
            onClear={clearBreakpoints}
            symbols={symbols}
            visible={visible}
          />
        </div>
        <MemoryPanel />
      </div>
    </div>
  )
}
