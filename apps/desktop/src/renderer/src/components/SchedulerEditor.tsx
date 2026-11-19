// Dialog for creating or editing a scheduler.
import { useId, useMemo, useState, type FormEvent } from 'react'
import type { Playlist, SchedulerInput, SchedulerView } from '../../../shared/api'
import { MAX_NAME_LENGTH, SCANS_PER_DAY } from '../../../shared/constants'
import { plural } from '../../../shared/format'
import { ChannelPicker } from '@/components/ChannelPicker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input, Label, NativeSelect } from '@/components/ui/input'
import { useApi } from '@/lib/api'

const blank = (): SchedulerInput => ({
  name: '',
  playlistId: '',
  playlistTitle: '',
  minuteOfHour: 0,
  channels: [],
})

export interface SchedulerEditorProps {
  editing?: SchedulerView // undefined when creating
  playlists: Playlist[] | null // null while loading
  playlistsError?: string | null
  schedulers: SchedulerView[] // to show which playlists are taken
  onClose: () => void
  onSaved: (s: SchedulerView) => void
}

/** Rendered only while open, so the form starts fresh each time. */
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
          minuteOfHour: editing.minuteOfHour,
          channels: editing.channels,
        }
      : blank(),
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const takenBy = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of schedulers) if (s.id !== editing?.id) m.set(s.playlistId, s.name)
    return m
  }, [schedulers, editing])

  const current = editing && { id: editing.playlistId, title: editing.playlistTitle, itemCount: 0 }
  const options = playlists && !props.playlistsError ? playlists : current ? [current] : [] // keep the saved one until the list loads
  const selectedExists = options.some((p) => p.id === form.playlistId)

  const set = <K extends keyof SchedulerInput>(key: K, value: SchedulerInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedExists) {
      setError('Choose a playlist.') // e.g. the saved one was deleted on YouTube
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
              maxLength={MAX_NAME_LENGTH}
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
              <option value="">
                {playlists || props.playlistsError ? 'Choose a playlist…' : 'Loading playlists…'}
              </option>
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

          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-minute`}>Scan every hour at minute</Label>
            <Input
              id={`${ids}-minute`}
              type="number"
              min={0}
              max={59}
              step={1}
              className="w-24"
              value={Number.isNaN(form.minuteOfHour) ? '' : form.minuteOfHour}
              onChange={(e) => set('minuteOfHour', e.target.valueAsNumber)}
            />
            <p className="text-xs text-muted-foreground">
              About {plural(form.channels.length * SCANS_PER_DAY, 'quota unit')} a day when nothing
              is new (1 per channel per scan), plus 50 for each video added.
            </p>
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
