import { discarding, exportListing, exportMap, newFile, openProject, saveProject } from '@/core/fileActions'
import { assembleProject, projectStore, setSource } from '@/core/project'
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

const WORDS = new Set(
  'JNS LOAD STORE ADD SUBT INPUT OUTPUT HALT SKIPCOND JUMP CLEAR ADDI JUMPI DEC OCT HEX ORG END'.split(' '),
)

// Підсвітка за тими самими правилами, що й асемблер: коментар від «/»,
// мітка — токен із комою, адресний літерал починається з цифри.
const marie = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.peek() === '/') {
      stream.skipToEnd()
      return 'comment'
    }
    if (!stream.match(/^[^\s/]+/)) stream.next()
    const word = stream.current()
    if (word.includes(',')) return 'labelName'
    if (WORDS.has(word.toUpperCase())) return 'keyword'
    if (/^[+-]?\d[\da-f]*$/i.test(word)) return 'number'
    return null
  },
})

const highlight = HighlightStyle.define([
  { tag: tags.comment, class: 'tok-comment' },
  { tag: tags.keyword, class: 'tok-mnemonic' },
  { tag: tags.labelName, class: 'tok-label' },
  { tag: tags.number, class: 'tok-number' },
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
          marie,
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

  return <div ref={host} className="min-h-[27.5rem] flex-1 overflow-hidden" />
}

function Result() {
  const t = useT()
  const report = projectStore.use((s) => s.report)
  const stale = projectStore.use((s) => s.stale)
  if (!report) return <span className="text-ed-dim">{t.noListing}</span>
  const ok = report.errorCount === 0
  return (
    <>
      <span className={cn('font-semibold', ok ? 'text-ed-ok' : 'text-ed-err')}>
        {ok ? t.notice.assembled('') : t.notice.assemblyErrors(String(report.errorCount))}
      </span>
      <span className="text-ed-dim">
        {stale && `${t.editor.stale} · `}
        {t.editor.words(report.program?.lines.length ?? 0)} · {t.editor.symbols(report.symbols.length)}
      </span>
    </>
  )
}

function Listing() {
  const t = useT()
  const report = projectStore.use((s) => s.report)
  const fileName = projectStore.use((s) => s.fileName)
  return (
    <section aria-label={t.editor.listing} className="fanfold">
      <PaperHeader title={`${t.editor.listing} · ${fileName.replace(/\.[^.]*$/, '')}.lst`}>
        <PaperButton disabled={!report} onClick={() => exportListing()}>
          {t.menu.exportListing}
        </PaperButton>
      </PaperHeader>
      {report ? (
        <div className="max-h-[26rem] overflow-auto border-t border-fan-rule font-mono text-[0.78125rem] leading-6">
          <div className="min-w-max">
            {report.listing.split('\n').map((line, i) => (
              <div
                key={i}
                className={cn(
                  'h-6 px-4 whitespace-pre',
                  i % 2 === 1 && 'bg-bar',
                  line.startsWith('   ****') && 'font-semibold text-bp',
                )}
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
  const tool = 'h-11 rounded-md border border-line px-3.5 hover:bg-line/30'

  return (
    <div className="flex flex-wrap items-start gap-4">
      <section
        aria-label={t.tabs.editor}
        className="flex min-w-0 flex-[999_1_38.75rem] flex-col overflow-hidden rounded-lg border border-line bg-ed text-ed-fg"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5">
          <div className="mr-2 font-mono text-sm font-semibold">
            {fileName}
            {dirty && <span className="ml-2 font-normal text-ed-dim">({t.editor.modified})</span>}
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
            className="ml-auto h-11 rounded-md bg-key-ochre px-5 font-semibold text-[#1a1612] shadow-[inset_0_-4px_0_rgb(0_0_0/0.2)] hover:brightness-110"
            onClick={assembleProject}
          >
            {t.editor.assemble}
          </button>
        </div>
        <CodeEditor />
        <div role="status" className="flex flex-wrap justify-between gap-2 border-t border-line px-3.5 py-2.5 font-mono text-[0.8125rem]">
          <Result />
        </div>
      </section>

      <div className="flex min-w-0 flex-[1_1_30rem] flex-col gap-4">
        <Listing />
        <Symbols />
      </div>
    </div>
  )
}
