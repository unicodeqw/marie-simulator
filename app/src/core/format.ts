export function hex(value: number, digits: number) {
  return value.toString(16).toUpperCase().padStart(digits, '0')
}

/** Адреса пам'яті з шістнадцяткового тексту; null, якщо це не число. Значення поза 000..FFF притискається до меж. */
export function parseAddress(text: string): number | null {
  const value = Number.parseInt(text, 16)
  return Number.isNaN(value) ? null : Math.min(0xfff, Math.max(0, value))
}

/** Місцевий час для заголовків лістингу й дампа: `2026-10-03 21:40:12`. */
export function timestamp(date = new Date()) {
  const two = (n: number) => String(n).padStart(2, '0')
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
  return `${day} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
}

/** Ім'я файлу без розширення. */
export function baseName(fileName: string) {
  return fileName.replace(/\.[^.]*$/, '')
}
