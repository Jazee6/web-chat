import { Link } from '@tanstack/react-router'
import { CompassIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

/** 地址不存在（手输或过期的链接） */
export function NotFoundPage() {
  return (
    <div className="flex h-svh flex-col">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CompassIcon />
          </EmptyMedia>
          <EmptyTitle role="heading" aria-level={1}>Page not found</EmptyTitle>
          <EmptyDescription>This link doesn’t lead anywhere. Check the address, or go back to your chats.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" nativeButton={false} render={<Link to="/" />}>
            Back to chats
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
