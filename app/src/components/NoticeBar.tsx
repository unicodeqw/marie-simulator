import { dismissNotice, projectStore } from '@/core/project'
import { useT } from '@/i18n'
import { X } from 'lucide-react'
import { useEffect } from 'react'
import { cn } from './styles'

const INFO_TIMEOUT_MS = 4000

/** Сповіщення про асемблювання та файлові дії; інформаційні зникають самі. */
export function NoticeBar() {
  const t = useT()
  const notice = projectStore.use((s) => s.notice)

  useEffect(() => {
    if (notice?.kind !== 'info') return
    const timer = setTimeout(dismissNotice, INFO_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [notice])

  if (!notice) return null
  return (
    <div
      role={notice.kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'relative z-1 flex items-center justify-between gap-4 border-b border-line bg-chrome px-6 py-1 font-medium',
        notice.kind === 'error' ? 'text-ed-err' : 'text-ed-ok',
      )}
    >
      {notice.text(t)}
      <button
        type="button"
        className="flex size-11 items-center justify-center rounded-md text-chrome-fg hover:bg-line/30"
        aria-label={t.close}
        onClick={dismissNotice}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
