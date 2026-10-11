import { SkeletonText } from '@/components/skeleton-text'
import { FieldDescription, FieldLegend, FieldSet } from '@/components/ui/field'
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/user-avatar'
import { BlockButton } from './profile-page'
import { useBlockedUsers } from './queries'

/** 隐私设置里的黑名单：解除拉黑直接生效；拉黑在资料页操作 */
export function BlockedUsers() {
  const blocked = useBlockedUsers()

  return (
    <FieldSet>
      <FieldLegend>Blocked users</FieldLegend>
      <FieldDescription>
        {blocked?.length === 0
          ? 'You haven’t blocked anyone. To block someone, open their profile.'
          : 'They can’t message you, add you to groups, or see when you’re online.'}
      </FieldDescription>
      {blocked === undefined ? (
        // 与下面的一行同样大小
        <ItemGroup>
          <Item variant="outline" size="sm">
            <ItemMedia>
              <Skeleton variant="avatar" className="size-6" />
            </ItemMedia>
            <ItemContent>
              <SkeletonText className="w-32 text-sm/snug" />
            </ItemContent>
            <ItemActions>
              <Skeleton variant="control" className="h-9 w-24" />
            </ItemActions>
          </Item>
        </ItemGroup>
      ) : (
        blocked.length > 0 && (
          <ItemGroup>
            {blocked.map((user) => (
              <Item key={user.id} variant="outline" size="sm">
                <ItemMedia>
                  <UserAvatar name={user.name} image={user.image} size="sm" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{user.name ?? '…'}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <BlockButton userId={user.id} name={user.name ?? ''} blocked />
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )
      )}
    </FieldSet>
  )
}
