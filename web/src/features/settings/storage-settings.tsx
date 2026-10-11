import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import {
  CACHE_LIMITS,
  clearMediaCache,
  mediaCacheLimit,
  mediaCacheUsage,
  setMediaCacheLimit,
  type CacheLimit,
} from '@/features/media/cache'
import { formatBytes } from '@/lib/format'
import { FieldSkeleton } from './field-skeleton'

/** Select 的值只能是字符串：字节数，或 none 表示不限 */
const LIMIT_ITEMS = CACHE_LIMITS.map((limit) => ({
  value: limit === null ? 'none' : String(limit),
  label: limit === null ? 'No limit' : formatBytes(limit).replace('.0', ''),
}))
const toLimit = (value: string): CacheLimit => (value === 'none' ? null : (Number(value) as CacheLimit))

/** 存储：本机的媒体缓存上限与用量（本机设置，不同步），即时生效 */
export function StorageSettings() {
  const [state, setState] = useState<{ usage: number; limit: CacheLimit } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => Promise.all([mediaCacheUsage(), mediaCacheLimit()]).then(([usage, limit]) => setState({ usage, limit }))

  useEffect(() => {
    load().catch(() => setState({ usage: 0, limit: null }))
  }, [])

  const run = async (action: () => Promise<void>, error: string) => {
    setBusy(true)
    try {
      await action()
      await load()
    } catch {
      toast.add({ type: 'error', title: error })
    } finally {
      setBusy(false)
    }
  }

  if (!state) {
    return (
      <div className="px-4 pb-4 md:p-0">
        <FieldGroup>
          <FieldSkeleton lines={2}>
            <Skeleton variant="control" className="h-9 w-20" />
          </FieldSkeleton>
          <FieldSkeleton lines={1}>
            <Skeleton variant="control" className="h-9 w-16" />
          </FieldSkeleton>
        </FieldGroup>
      </div>
    )
  }

  return (
    <div className="px-4 pb-4 md:p-0">
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="cache-limit">Media cache limit</FieldLabel>
            <FieldDescription>
              Photos you’ve viewed are kept on this device so they open instantly, even offline. The oldest are removed
              first.
            </FieldDescription>
          </FieldContent>
          <Select
            items={LIMIT_ITEMS}
            value={state.limit === null ? 'none' : String(state.limit)}
            disabled={busy}
            onValueChange={(value) => {
              if (value !== null) void run(() => setMediaCacheLimit(toLimit(value)), "Couldn't change the limit")
            }}
          >
            <SelectTrigger id="cache-limit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIMIT_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>Cached media</FieldTitle>
            <FieldDescription>{formatBytes(state.usage)} on this device.</FieldDescription>
          </FieldContent>
          <Button
            variant="outline"
            disabled={busy || state.usage === 0}
            onClick={() => void run(clearMediaCache, "Couldn't clear the cache")}
          >
            {busy && <Spinner data-icon="inline-start" />}
            Clear
          </Button>
        </Field>
      </FieldGroup>
    </div>
  )
}
