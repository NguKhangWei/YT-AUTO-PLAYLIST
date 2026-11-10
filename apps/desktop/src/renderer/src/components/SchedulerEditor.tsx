import { DEFAULT_TIMEZONE, MAX_INTERVAL_DAYS, MIN_INTERVAL_DAYS } from '@auto-yt/core'
import { useId, useMemo, useState, type FormEvent } from 'react'
import type { Playlist, SchedulerInput, SchedulerView } from '../../../shared/api'
import { ChannelPicker } from '@/components/ChannelPicker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input, Label, NativeSelect } from '@/components/ui/input'
import { useApi } from '@/lib/api'
import { intervalLabel, timeZones } from '@/lib/format'

const INTERVALS = Array.from(
  { length: MAX_INTERVAL_DAYS - MIN_INTERVAL_DAYS + 1 },
  (_, i) => i + MIN_INTERVAL_DAYS,
)

const blank = (): SchedulerInput => ({
  name: '',
  playlistId: '',
  playlistTitle: '',
  intervalDays: 1,
  timeOfDay: '09:00',
  timezone: DEFAULT_TIMEZONE,
  channels: [],
})

export interface SchedulerEditorProps {
  /** The scheduler being edited, or undefined to create one. */
  editing?: SchedulerView
  playlists: Playlist[] | null
  playlistsError?: string
  /** All schedulers, to show which playlists are taken. */
  schedulers: SchedulerView[]
  onClose: () => void
  onSaved: (s: SchedulerView) => void
}

/** Create/edit dialog. Rendered only while open, so its form state resets each time. */
export function SchedulerEditor(props: SchedulerEditorProps) {
  const { editing, playlists, schedulers } = props
  const api = useApi()
  const ids = useId()
  const [form, setForm] = useState<SchedulerInput>(() =>
    editing
      ? {
          name: editing.name,
          playlistId: editing.playlistId,
          playlistTitle: editing.playlistTitle,
          intervalDays: editing.intervalDays,
          timeOfDay: editing.timeOfDay,
          timezone: editing.timezone,
          channels: editing.channels,
        }
      : blank(),
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const zones = useMemo(() => timeZones(DEFAULT_TIMEZONE), [])

  const takenBy = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of schedulers) if (s.id !== editing?.id) m.set(s.playlistId, s.name)
    return m
  }, [schedulers, editing])

  // The playlist list is authoritative once it has loaded: a playlist deleted on
  // YouTube is not offered. Only while it is loading (or failed to load) is the
  // current choice kept as an option, so the form doesn't lose it.
  const listKnown = playlists !== null && !props.playlistsError
  const options = useMemo(() => {
    const list = playlists ?? []
    if (!listKnown && form.playlistId && !list.some((p) => p.id === form.playlistId)) {
      return [{ id: form.playlistId, title: form.playlistTitle, itemCount: 0 }, ...list]
    }
    return list
  }, [playlists, listKnown, form.playlistId, form.playlistTitle])
  const selectedExists = options.some((p) => p.id === form.playlistId)
  /** Set when the scheduler's saved playlist was deleted on YouTube and is still selected. */
  const gone =
    editing &&
    listKnown &&
    form.playlistId === editing.playlistId &&
    !(playlists ?? []).some((p) => p.id === editing.playlistId)
      ? editing
      : undefined

  const set = <K extends keyof SchedulerInput>(key: K, value: SchedulerInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const problems: string[] = []
    if (!selectedExists) {
      problems.push(
        gone
          ? `"${gone.playlistTitle}" no longer exists on YouTube. Choose another playlist.`
          : 'Choose a playlist.',
      )
    }
    if (!zones.includes(form.timezone)) {
      problems.push(`Unknown time zone "${form.timezone}". Pick one from the list.`)
    }
    if (problems.length > 0) {
      setError(problems.join(' '))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = editing
        ? await api.schedulers.update(editing.id, form)
        : await api.schedulers.create(form)
      props.onSaved(saved)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent>
        <DialogTitle>{editing ? 'Edit scheduler' : 'New scheduler'}</DialogTitle>
        <DialogDescription>
          Scans the tracked channels on this schedule and adds new uploads to the playlist.
        </DialogDescription>

        <form onSubmit={(e) => void submit(e)} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-name`}>Name</Label>
            <Input
              id={`${ids}-name`}
              value={form.name}
              maxLength={80}
              placeholder="e.g. Gaming"
              onChange={(e) => set('name', e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-playlist`}>Playlist</Label>
            <NativeSelect
              id={`${ids}-playlist`}
              value={selectedExists ? form.playlistId : ''}
              onChange={(e) => {
                const p = options.find((x) => x.id === e.target.value)
                setForm((f) => ({
                  ...f,
                  playlistId: e.target.value,
                  playlistTitle: p?.title ?? '',
                }))
              }}
            >
              <option value="">{playlists ? 'Choose a playlist…' : 'Loading playlists…'}</option>
              {options.map((p) => {
                const owner = takenBy.get(p.id)
                return (
                  <option key={p.id} value={p.id} disabled={!!owner}>
                    {p.title}
                    {owner ? ` (used by ${owner})` : ''}
                  </option>
                )
              })}
            </NativeSelect>
            {gone && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                &quot;{gone.playlistTitle}&quot; no longer exists on YouTube. Choose another
                playlist.
              </p>
            )}
            {props.playlistsError && (
              <p className="text-xs text-destructive">
                Couldn&apos;t load playlists: {props.playlistsError}
              </p>
            )}
            {playlists?.length === 0 && (
              <p className="text-xs text-muted-foreground">
                You have no playlists. Create one on YouTube first.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor={`${ids}-interval`}>Scan</Label>
              <NativeSelect
                id={`${ids}-interval`}
                value={form.intervalDays}
                onChange={(e) => set('intervalDays', Number(e.target.value))}
              >
                {INTERVALS.map((d) => (
                  <option key={d} value={d}>
                    {intervalLabel(d)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${ids}-time`}>At</Label>
              <Input
                id={`${ids}-time`}
                type="time"
                value={form.timeOfDay}
                onChange={(e) => set('timeOfDay', e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-tz`}>Time zone</Label>
            <Input
              id={`${ids}-tz`}
              list={`${ids}-zones`}
              value={form.timezone}
              onChange={(e) => set('timezone', e.target.value)}
            />
            <datalist id={`${ids}-zones`}>
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </div>

          <ChannelPicker
            selected={form.channels}
            onChange={(channels) => set('channels', channels)}
          />

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {editing ? 'Save' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
