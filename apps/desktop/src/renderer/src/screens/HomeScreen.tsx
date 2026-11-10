import { useCallback, useEffect, useState } from 'react'
import type { AuthStatus, Playlist } from '../../../shared/api'
import { AccountHeader } from '@/components/AccountHeader'
import { Button } from '@/components/ui/button'
import { useApi } from '@/lib/api'

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'done'; playlists: Playlist[] }

export function HomeScreen({
  status,
  onStatus,
}: {
  status: AuthStatus
  onStatus: (s: AuthStatus) => void
}) {
  const api = useApi()
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  const refresh = useCallback(async () => {
    setLoad({ state: 'loading' })
    try {
      setLoad({ state: 'done', playlists: await api.youtube.listMyPlaylists() })
    } catch (e) {
      setLoad({ state: 'error', message: (e as Error).message })
    }
  }, [api])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    void refresh()
  }, [refresh])

  return (
    <div className="flex min-h-screen flex-col">
      <AccountHeader
        profile={status.profile}
        onSignOut={() => void api.auth.signOut().then(onStatus)}
      />
      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Your playlists</h2>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            Refresh
          </Button>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Schedulers will add new uploads to one of these (coming in the next milestones).
        </p>
        {load.state === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}
        {load.state === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            Couldn&apos;t load playlists: {load.message}
          </p>
        )}
        {load.state === 'done' && load.playlists.length === 0 && (
          <p className="text-sm">No playlists yet. Create one on YouTube, then press Refresh.</p>
        )}
        {load.state === 'done' && load.playlists.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {load.playlists.map((p) => (
              <li key={p.id} className="flex items-center gap-3 p-3">
                {p.thumbnailUrl ? (
                  <img src={p.thumbnailUrl} alt="" className="h-12 w-20 rounded object-cover" />
                ) : (
                  <span className="h-12 w-20 rounded bg-muted" />
                )}
                <span className="flex-1 font-medium">{p.title}</span>
                <span className="text-sm text-muted-foreground">
                  {p.itemCount} {p.itemCount === 1 ? 'video' : 'videos'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
