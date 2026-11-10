import type { Channel } from '../../../shared/api'
import { cn } from '@/lib/utils'

/** Channel picture, or its first letter when YouTube has none. */
export function ChannelAvatar({ channel, className }: { channel: Channel; className?: string }) {
  return channel.thumbnailUrl ? (
    <img
      src={channel.thumbnailUrl}
      alt=""
      referrerPolicy="no-referrer"
      className={cn('size-8 shrink-0 rounded-full object-cover', className)}
    />
  ) : (
    <span
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium',
        className,
      )}
    >
      {channel.title.charAt(0).toUpperCase()}
    </span>
  )
}
