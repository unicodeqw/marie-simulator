import { useEffect, useState } from 'react'
import { DataPathView } from './components/DataPathView'
import { AboutDialog, ConfirmHost, CoreDumpDialog, InstructionSetDialog } from './components/dialogs'
import { EditorView } from './components/EditorView'
import { Header, NoticeBar, type DialogName } from './components/Header'
import { SimulatorView } from './components/SimulatorView'
import * as datapath from './core/datapath'
import { discarding, openProject, saveProject } from './core/fileActions'
import { assembleProject, projectStore } from './core/project'
import * as simulator from './core/sim'
import { uiStore, type Tab } from './core/ui'

export default function App() {
  const tab = uiStore.use((s) => s.tab)
  const setTab = (tab: Tab) => uiStore.set({ tab })
  const [dialog, setDialog] = useState<DialogName | null>(null)
  const closeDialog = (open: boolean) => !open && setDialog(null)
  useHotkeys(tab, dialog !== null, setDialog)

  return (
    <div className="flex min-h-dvh flex-col">
      <Header tab={tab} onTab={setTab} onDialog={setDialog} />
      <NoticeBar />
      {/* Усі розділи змонтовано постійно, щоб редактор і машини не втрачали стан. */}
      <main className="mx-auto w-full max-w-[90rem] p-5">
        <div hidden={tab !== 'editor'}>
          <EditorView />
        </div>
        <div hidden={tab !== 'simulator'}>
          <SimulatorView />
        </div>
        <div hidden={tab !== 'datapath'}>
          <DataPathView />
        </div>
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
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || dialogOpen || document.querySelector('[role="menu"], [role="alertdialog"]')) return
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key

      if (e.ctrlKey || e.metaKey) {
        if (key === 'o') discarding(openProject)
        else if (key === 's') saveProject(e.shiftKey)
        else return
        e.preventDefault()
        return
      }

      const machine = tab === 'datapath' ? datapath : tab === 'simulator' ? simulator : null
      const handlers: Record<string, (() => void) | undefined> = {
        F1: () => setDialog('isa'),
        F9: assembleProject,
        F5: machine ? (e.shiftKey ? machine.stop : () => (tab === 'datapath' ? datapath.run() : simulator.run('run'))) : undefined,
        F10: machine?.step,
      }
      const handler = handlers[key]
      if (!handler) return
      e.preventDefault()
      handler()
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
