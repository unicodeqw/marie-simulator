import { useEffect, useRef } from 'react'

/** Прокручує лише сам контейнер (а не сторінку), щоб його дочірній рядок `index` було видно. */
export function useRowInView(index: number | null) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = ref.current
    const row = index === null ? null : (box?.children[index] as HTMLElement | undefined)
    if (!box || !row) return
    const top = row.offsetTop - box.offsetTop
    if (top < box.scrollTop) box.scrollTop = top
    else if (top + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + row.offsetHeight - box.clientHeight
  }, [index])
  return ref
}
