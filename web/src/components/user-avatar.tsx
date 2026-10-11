import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initials } from '@/lib/format'

export function UserAvatar({
  name,
  image,
  size,
  online = false,
}: {
  name: string | null
  image: string | null
  size?: 'default' | 'sm' | 'lg' | 'xl'
  online?: boolean
}) {
  return (
    <Avatar size={size}>
      {image && <AvatarImage src={image} alt="" />}
      {/* 名字总在旁边显示，首字母不再读一遍 */}
      <AvatarFallback aria-hidden>{name ? initials(name) : null}</AvatarFallback>
      {online && <AvatarBadge variant="success" aria-label="Online" />}
    </Avatar>
  )
}
