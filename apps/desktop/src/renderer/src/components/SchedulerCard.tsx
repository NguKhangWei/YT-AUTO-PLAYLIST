import { Pencil, Trash2 } from 'lucide-react'
import type { SchedulerView } from '../../../shared/api'
import { ChannelAvatar } from '@/components/ChannelAvatar'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { formatInZone, intervalLabel } from '@/lib/format'

export function SchedulerCard({
  scheduler: s,
  onToggle,
  onEdit,
  onDelete,
}: {
  scheduler: SchedulerView
  onToggle: (active: boolean) => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <li className="rounded-lg border p-4" aria-label={s.name}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{s.name}</h3>
          <p className="truncate text-sm text-muted-foreground">→ {s.playlistTitle}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          {s.active ? 'Active' : 'Off'}
          <Switch checked={s.active} onCheckedChange={onToggle} aria-label={`${s.name} active`} />
        </label>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Schedule</dt>
        <dd>
          {intervalLabel(s.intervalDays)} at {s.timeOfDay} ({s.timezone})
        </dd>
        <dt className="text-muted-foreground">Next scan</dt>
        <dd>{s.active ? formatInZone(s.nextRunAt, s.timezone) : '—'}</dd>
        <dt className="text-muted-foreground">Channels</dt>
        <dd>
          {s.channels.length === 0 ? (
            'None yet'
          ) : (
            <ul aria-label={`${s.name} channels`} className="flex flex-wrap gap-x-3 gap-y-1">
              {s.channels.map((c) => (
                <li key={c.id} className="flex items-center gap-1.5">
                  <ChannelAvatar channel={c} className="size-5" />
                  <span>{c.title}</span>
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>

      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil /> Edit
        </Button>
        <Button variant="outline" size="sm" onClick={onDelete}>
          <Trash2 /> Delete
        </Button>
      </div>
    </li>
  )
}
