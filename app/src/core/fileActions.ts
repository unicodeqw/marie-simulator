import { openFile, saveTextFile } from '@/platform/files'
import type { FileFilter } from '@/platform/files'
import { ask } from './confirm'
import { dpStore } from './datapath'
import type { Example } from './examples'
import { UNTITLED, baseName, loadProgram, markSaved, notify, openSource, projectStore } from './project'
import { coreDump } from './sim'
import { readMex } from './wasm'

const SOURCE: FileFilter = { name: 'MARIE Source', extensions: ['mas'] }
const SOURCE_OR_MEX: FileFilter = { name: 'MARIE Source / Executable', extensions: ['mas', 'mex'] }
const LISTING: FileFilter = { name: 'Assembly Listing', extensions: ['lst'] }
const MAP: FileFilter = { name: 'Symbol Table', extensions: ['map'] }
const DUMP: FileFilter = { name: 'Core Dump', extensions: ['dmp'] }
const TEXT: FileFilter = { name: 'Text', extensions: ['txt'] }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

// Старі .mas із Windows бувають у Windows-1251; UTF-8 пробуємо першим.
function decode(bytes: Uint8Array) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1251').decode(bytes)
  }
}

/** Виконує дію, що замінює текст програми, якщо немає незбережених змін або користувач погодився. */
export async function discarding(action: () => void) {
  if (projectStore.get().dirty && !(await ask('unsaved'))) return
  action()
}

export function newFile() {
  openSource(UNTITLED, '')
}

export function loadExample(example: Example) {
  openSource(example.fileName, example.source)
}

/** Відкриває `.mas` або оригінальний `.mex` (із нього відновлюється й вихідний текст). */
export async function openProject() {
  try {
    const file = await openFile(SOURCE_OR_MEX)
    if (!file) return
    if (file.name.toLowerCase().endsWith('.mex')) {
      const mex = readMex(file.bytes)
      openSource(`${baseName(file.name)}.mas`, mex.source)
      loadProgram(mex.program)
      notify('info', 'mexImported', file.name)
    } else {
      openSource(file.name, decode(file.bytes), file.path)
    }
  } catch (e) {
    notify('error', 'mexFailed', message(e))
  }
}

async function save(text: string, name: string, filter: FileFilter, path: string | null = null) {
  try {
    const saved = await saveTextFile(text, name, filter, path)
    if (saved) notify('info', 'saved', saved.name)
    return saved
  } catch (e) {
    notify('error', 'fileFailed', message(e))
    return null
  }
}

export async function saveProject(saveAs = false) {
  const { source, fileName, filePath } = projectStore.get()
  const saved = await save(source, fileName, SOURCE, saveAs ? null : filePath)
  if (saved) markSaved(saved.name, saved.path)
}

export function exportListing() {
  const { report, fileName } = projectStore.get()
  if (report) return save(report.listing, `${baseName(fileName)}.lst`, LISTING)
}

export function exportMap() {
  const { report, fileName } = projectStore.get()
  if (report?.map) return save(report.map, `${baseName(fileName)}.map`, MAP)
}

export function exportDump(start: number, end: number) {
  const { fileName } = projectStore.get()
  return save(coreDump(fileName, start, end), `${baseName(fileName)}.dmp`, DUMP)
}

export function exportTrace() {
  const { fileName } = projectStore.get()
  const header = '  IR   OUT    IN    AC   MBR   PC   MAR'
  return save([header, ...dpStore.get().trace, ''].join('\n'), `${baseName(fileName)}-trace.txt`, TEXT)
}
