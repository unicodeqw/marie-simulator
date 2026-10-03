import { discarding, exportListing, exportMap, newFile, openProject, saveProject } from '@/core/fileActions'
import { baseName } from '@/core/format'
import { assembleProject, projectStore, setSource } from '@/core/project'
import { isa } from '@/core/wasm'
import { useT } from '@/i18n'
import { insertTab } from '@codemirror/commands'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView as CodeMirror, keymap, placeholder } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { basicSetup } from 'codemirror'
import { useEffect, useRef } from 'react'
import { PaperButton, PaperHeader, SymbolTable } from './ProgramListing'
import { cn } from './styles'

// Підсвітка за тими самими правилами, що й асемблер: коментар від «/»,
// мітка — токен із комою, адресний літерал починається з цифри.
function marieLanguage() {
  const words = new Set([...isa.instructions.map((i) => i.name.toUpperCase()), ...isa.directives])
  return StreamLanguage.define({
    token(stream) {
      if (stream.eatSpace()) return null
      if (stream.peek() === '/') {
        stream.skipToEnd()
        return 'comment'
      }
      if (!stream.match(/^[^\s/]+/)) stream.next()
      const word = stream.current()
      if (word.includes(',')) return 'labelName'
      if (words.has(word.toUpperCase())) return 'keyword'
      if (/^[+-]?\d[\da-f]*$/i.test(word)) return 'number'
      return null
    },
  })
}

// Екран монохромний: числа лишаються звичайним текстом.
const highlight = HighlightStyle.define([
  { tag: tags.comment, class: 'tok-comment' },
  { tag: tags.keyword, class: 'tok-mnemonic' },
  { tag: tags.labelName, class: 'tok-label' },
])

function CodeEditor() {
  const t = useT()
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<CodeMirror | null>(null)
  const hint = useRef(new Compartment())
  const source = projectStore.use((s) => s.source)
  const report = projectStore.use((s) => s.report)

  useEffect(() => {
    const editor = new CodeMirror({
      parent: host.current!,
      state: EditorState.create({
        doc: projectStore.get().source,
        extensions: [
          basicSetup,
          keymap.of([{ key: 'Tab', run: insertTab }]),
          EditorState.tabSize.of(8),
          marieLanguage(),
          syntaxHighlighting(highlight),
          lintGutter(),
          hint.current.of([]),
          CodeMirror.updateListener.of((update) => {
            if (update.docChanged) setSource(update.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = editor
    return () => editor.destroy()
  }, [])

  useEffect(() => {
    view.current?.dispatch({ effects: hint.current.reconfigure(placeholder(t.editor.untitledHint)) })
  }, [t])

  // Текст замінено ззовні: новий файл, відкриття, приклад.
  useEffect(() => {
    const editor = view.current
    if (!editor || editor.state.doc.toString() === source) return
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: source } })
  }, [source])

  // Помилки асемблера — позначками на відповідних рядках.
  useEffect(() => {
    const editor = view.current
    if (!editor) return
    const { doc } = editor.state
    const diagnostics: Diagnostic[] = []
    report?.lines.forEach((line, i) => {
      if (line.errors.length === 0 || i >= doc.lines) return
      const { from, to } = doc.line(i + 1)
      diagnostics.push({ from, to, severity: 'error', message: line.errors.map((e) => t.asm[e]).join(' ') })
    })
    editor.dispatch(setDiagnostics(editor.state, diagnostics))
  }, [report, t])

  return <div ref={host} className="min-h-110 flex-1 overflow-hidden" />
}

/** Рядок стану внизу екрана; після асемблювання — інверсним відео. */
function Result() {
  const t = useT()
  const report = projectStore.use((s) => s.report)
  const stale = projectStore.use((s) => s.stale)
  const bar = 'flex flex-wrap justify-between gap-x-4 gap-y-1 px-5.5 py-1 font-mono text-code font-semibold'
  if (!report) {
    return (
      <div role="status" className={cn(bar, 'font-normal text-phosphor-dim')}>
        {t.noListing}
      </div>
    )
  }
  const ok = report.errorCount === 0
  return (
    <div role="status" className={cn(bar, 'crt-inverse')} data-tone={ok ? undefined : 'error'}>
      <span>{ok ? t.editor.assembled : t.editor.failed(report.errorCount)}</span>
      <span>
        {stale && `${t.editor.stale} · `}
        {t.editor.words(report.program?.lines.length ?? 0)} · {t.editor.symbols(report.symbols.length)}
      </span>
    </div>
  )
}

function Listing() {
  const t = useT()
  const report = projectStore.use((s) => s.report)
  const fileName = projectStore.use((s) => s.fileName)
  return (
    <section aria-label={t.editor.listing} className="fanfold">
      <PaperHeader title={`${t.editor.listing} · ${baseName(fileName)}.lst`}>
        <PaperButton disabled={!report} onClick={() => exportListing()}>
          {t.menu.exportListing}
        </PaperButton>
      </PaperHeader>
      {report ? (
        <div className="max-h-104 overflow-auto border-t border-fan-rule font-mono text-listing leading-6">
          <div className="min-w-max">
            {report.listing.split('\n').map((line, i) => (
              <div
                key={i}
                className={cn('h-6 px-4 whitespace-pre', i % 2 === 1 && 'bg-bar', line.startsWith('   ****') && 'font-semibold text-bp')}
              >
                {line || ' '}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="border-t border-fan-rule px-4 py-4 text-fan-dim">{t.noListing}</p>
      )}
      <div className="h-3" />
    </section>
  )
}

function Symbols() {
  const t = useT()
  const report = projectStore.use((s) => s.report)
  return (
    <section aria-label={t.editor.symbolTable} className="fanfold">
      <PaperHeader title={t.editor.symbolTable}>
        <PaperButton disabled={!report?.map} onClick={() => exportMap()}>
          {t.menu.exportMap}
        </PaperButton>
      </PaperHeader>
      <SymbolTable symbols={report?.symbols ?? null} />
    </section>
  )
}

export function EditorView() {
  const t = useT()
  const fileName = projectStore.use((s) => s.fileName)
  const dirty = projectStore.use((s) => s.dirty)
  const tool = 'btn-cream px-3.5'

  return (
    <div className="flex flex-wrap items-start gap-7">
      {/* Термінал: екран із кодом, під ним — наклейка з назвою файлу та клавіші. */}
      <section aria-label={t.tabs.editor} className="putty flex min-w-0 flex-[999_1_38.75rem] flex-col rounded-[1.375rem] px-5 pt-5 pb-4">
        <div className="crt-bezel rounded-[30px/26px] p-4">
          <div className="crt flex flex-col rounded-[20px/18px] pt-3.5 pb-3">
            <CodeEditor />
            <Result />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-1 pt-4 pb-1">
          <div className="dymo mr-1 px-2.5 py-1 font-mono text-code font-semibold tracking-[0.12em]">
            {fileName}
            {dirty && <span className="ml-2 font-normal">({t.editor.modified})</span>}
          </div>
          <button type="button" className={tool} onClick={() => discarding(newFile)}>
            {t.menu.new}
          </button>
          <button type="button" className={tool} onClick={() => discarding(openProject)}>
            {t.menu.open}
          </button>
          <button type="button" className={tool} onClick={() => saveProject()}>
            {t.menu.save}
          </button>
          <button
            type="button"
            title={`${t.editor.assemble} (F9)`}
            className="btn-ochre ml-auto h-11.5 px-5.5 font-semibold"
            onClick={assembleProject}
          >
            {t.editor.assemble}
          </button>
        </div>
      </section>

      <div className="flex min-w-0 flex-[1_1_30rem] flex-col gap-7.5">
        <Listing />
        <Symbols />
      </div>
    </div>
  )
}
