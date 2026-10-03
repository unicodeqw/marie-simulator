import { clsx, type ClassValue } from 'clsx'
import { useEffect, useRef } from 'react'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

/** Прокручує лише сам контейнер (а не сторінку), щоб рядок `index` було видно; у прихованому розділі чекає показу. */
export function useRowInView(index: number | null, visible: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = ref.current
    const row = index === null ? null : (box?.children[index] as HTMLElement | undefined)
    if (!box || !row) return
    const top = row.offsetTop - box.offsetTop
    if (top < box.scrollTop) box.scrollTop = top
    else if (top + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + row.offsetHeight - box.clientHeight
  }, [index, visible])
  return ref
}

interface DelayWords {
  panel: { noDelay: string; ms: (n: number) => string; seconds: (n: number) => string }
}

/** Затримка для підпису повзунка: «без затримки», мілісекунди або секунди. */
export function formatDelay(ms: number, t: DelayWords) {
  if (ms === 0) return t.panel.noDelay
  return ms < 1000 ? t.panel.ms(ms) : t.panel.seconds(ms / 1000)
}
