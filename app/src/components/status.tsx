import type { Status } from '@/core/types'
import { useT } from '@/i18n'

export function StatusText({ status }: { status: Status }) {
  const t = useT()
  return (
    <>
      {t.status[status.key]}
      {status.key === 'fault' && status.fault ? t.fault[status.fault] : null}
    </>
  )
}
