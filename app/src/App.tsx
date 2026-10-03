import { useEffect, useState } from 'react'
import { DataPathView } from './components/DataPathView'
import { AboutDialog, ConfirmHost, CoreDumpDialog, InstructionSetDialog } from './components/dialogs'
import { EditorView } from './components/EditorView'
import { Header, type DialogName, type Tab } from './components/Header'
import { NoticeBar } from './components/NoticeBar'
import { SimulatorView } from './components/SimulatorView'
import { confirmStore } from './core/confirm'
import * as datapath from './core/datapath'
import { discarding, openProject, saveProject } from './core/fileActions'
import { assembleProject, projectStore } from './core/project'
import * as simulator from './core/sim'

export default function App() {
  const [tab, setTab] = useState<Tab>('editor')
  const [dialog, setDialog] = useState<DialogName | null>(null)
  const closeDialog = (open: boolean) => !open && setDialog(null)
  useHotkeys(tab, dialog !== null, setDialog)

  return (
    <div className="flex min-h-dvh flex-col">
      <Header tab={tab} onTab={setTab} onDialog={setDialog} />
      <NoticeBar />
      <main className="mx-auto w-full max-w-360 p-5">
        {/* Редактор лишається змонтованим, щоб не втрачати історію правок і курсор;
            стан машин живе у сховищах, тож їхні екрани монтуються за потреби. */}
        <div hidden={tab !== 'editor'}>
          <EditorView />
        </div>
        {tab === 'simulator' && <SimulatorView />}
        {tab === 'datapath' && <DataPathView />}
      </main>
      <AboutDialog open={dialog === 'about'} onOpenChange={closeDialog} />
      <InstructionSetDialog open={dialog === 'isa'} onOpenChange={closeDialog} />
      <CoreDumpDialog open={dialog === 'dump'} onOpenChange={closeDialog} />
      <ConfirmHost />
    </div>
  )
}

function useHotkeys(tab: Tab, dialogOpen: boolean, setDialog: (name: DialogName) => void) {
  useEffect(() => {
    const run = () => (tab === 'datapath' ? datapath.run() : simulator.run('run'))
    const machine = tab === 'datapath' ? datapath : tab === 'simulator' ? simulator : null

    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || dialogOpen || confirmStore.get().question !== null) return

      let action: (() => void) | undefined
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase()
        if (key === 'o') action = () => discarding(openProject)
        else if (key === 's') action = () => saveProject(e.shiftKey)
      } else if (e.key === 'F1') action = () => setDialog('isa')
      else if (e.key === 'F9') action = assembleProject
      else if (e.key === 'F5' && machine) action = e.shiftKey ? machine.stop : run
      else if (e.key === 'F10' && machine) action = machine.step

      if (!action) return
      e.preventDefault()
      action()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab, dialogOpen, setDialog])

  // У браузері попереджаємо про незбережені зміни перед закриттям вкладки.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (projectStore.get().dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])
}
