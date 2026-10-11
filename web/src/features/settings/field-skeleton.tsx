import type { ReactNode } from 'react'

import { SkeletonText } from '@/components/skeleton-text'
import { Field, FieldContent } from '@/components/ui/field'

/**
 * 横排设置项的占位：与 FieldLabel 同高的标题、lines 行与 FieldDescription 同行高的说明，右边是 children（控件的占位）。
 * 说明的行数取桌面宽度下真实文字的行数
 */
export function FieldSkeleton({ lines, children }: { lines: 1 | 2; children?: ReactNode }) {
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <SkeletonText className="w-40 text-sm/snug" />
        <div>
          <SkeletonText className={lines === 2 ? 'w-full text-sm/normal' : 'w-3/4 text-sm/normal'} />
          {lines === 2 && <SkeletonText className="w-1/2 text-sm/normal" />}
        </div>
      </FieldContent>
      {children}
    </Field>
  )
}
