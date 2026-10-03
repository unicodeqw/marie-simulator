/**
 * Доступ до файлів, що працює і в Tauri (нативні діалоги), і у звичайному
 * браузері (file input + завантаження / File System Access API).
 */

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface OpenedFile {
  name: string
  /** Повний шлях; лише в Tauri. */
  path: string | null
  bytes: Uint8Array
}

export interface SavedFile {
  name: string
  path: string | null
}

export async function openFile(filter: FileFilter): Promise<OpenedFile | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const path = await open({ multiple: false, directory: false, filters: [filter] })
    if (!path) return null
    return { name: baseName(path), path, bytes: await readFile(path) }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = filter.extensions.map((e) => `.${e}`).join(',')
    input.onchange = async () => {
      const file = input.files?.[0]
      resolve(file ? { name: file.name, path: null, bytes: new Uint8Array(await file.arrayBuffer()) } : null)
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/**
 * Зберігає текст. Із `path` (Tauri) пише без діалогу; інакше питає, куди.
 * Повертає null, якщо користувач скасував.
 */
export async function saveTextFile(
  text: string,
  suggestedName: string,
  filter: FileFilter,
  path: string | null = null,
): Promise<SavedFile | null> {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    const target = path ?? (await save({ defaultPath: suggestedName, filters: [filter] }))
    if (!target) return null
    await writeTextFile(target, text)
    return { name: baseName(target), path: target }
  }

  const picker = (window as unknown as { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle> })
    .showSaveFilePicker
  if (picker) {
    try {
      const handle = await picker({
        suggestedName,
        types: [{ description: filter.name, accept: { 'text/plain': filter.extensions.map((e) => `.${e}`) } }],
      })
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
      return { name: handle.name, path: null }
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return null
      throw e
    }
  }

  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { name: suggestedName, path: null }
}

function baseName(path: string) {
  return path.split(/[\\/]/).pop() ?? path
}
