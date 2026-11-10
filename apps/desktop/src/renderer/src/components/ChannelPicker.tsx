// Channel search box with results, and the chosen channels as removable chips.
import { Check, Plus, X } from 'lucide-react'
import { useId, useState } from 'react'
import type { Channel } from '../../../shared/api'
import { ChannelAvatar } from '@/components/ChannelAvatar'
import { Input, Label } from '@/components/ui/input'
import { MIN_SEARCH_LENGTH } from '../../../shared/constants'
import { useChannelSearch } from '@/hooks/useChannelSearch'
import { formatSubscribers } from '@/lib/format'

export function ChannelPicker({
  selected,
  onChange,
}: {
  selected: Channel[]
  onChange: (channels: Channel[]) => void
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const search = useChannelSearch(query)
  const chosen = new Set(selected.map((c) => c.id))

  const add = (c: Channel) => {
    if (!chosen.has(c.id)) onChange([...selected, c])
  }
  const remove = (channelId: string) => onChange(selected.filter((c) => c.id !== channelId))

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={`${id}-search`}>Channels to track</Label>
      <Input
        id={`${id}-search`}
        type="search"
        value={query}
        placeholder="Search by name, or paste a channel URL or @handle"
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        Each new search uses 100 of your 10,000 daily API units. Pasting a URL or @handle uses 1.
      </p>

      {search.status === 'searching' && (
        <p className="text-sm text-muted-foreground" role="status">
          Searching…
        </p>
      )}
      {search.status === 'error' && (
        <p className="text-sm text-destructive" role="alert">
          Search failed: {search.message}
        </p>
      )}
      {search.status === 'done' && search.channels.length === 0 && (
        <p className="text-sm text-muted-foreground" role="status">
          No channels found.
        </p>
      )}
      {search.status === 'done' && search.channels.length > 0 && (
        <ul aria-label="Search results" className="divide-y rounded-md border">
          {search.channels.map((c) => {
            const isChosen = chosen.has(c.id)
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={isChosen}
                  onClick={() => add(c)}
                  className="flex w-full items-center gap-3 p-2 text-left hover:bg-accent disabled:cursor-default disabled:opacity-60"
                  aria-label={`${isChosen ? 'Added' : 'Add'} ${c.title}`}
                >
                  <ChannelAvatar channel={c} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[c.handle, formatSubscribers(c.subscriberCount)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {isChosen ? <Check className="size-4" /> : <Plus className="size-4" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {search.status === 'idle' && query.trim().length > 0 && (
        <p className="text-xs text-muted-foreground">
          Type at least {MIN_SEARCH_LENGTH} characters.
        </p>
      )}

      {selected.length > 0 ? (
        <ul aria-label="Tracked channels" className="mt-1 flex flex-wrap gap-2">
          {selected.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-1.5 rounded-full border py-0.5 pr-1 pl-0.5 text-sm"
            >
              <ChannelAvatar channel={c} className="size-6" />
              <span className="max-w-40 truncate">{c.title}</span>
              <button
                type="button"
                onClick={() => remove(c.id)}
                aria-label={`Remove ${c.title}`}
                className="rounded-full p-0.5 hover:bg-accent"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No channels yet.</p>
      )}
    </div>
  )
}
