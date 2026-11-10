import { Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { AuthStatus, Playlist, SchedulerView } from '../../../shared/api'
import { AccountHeader } from '@/components/AccountHeader'
import { RunHistory } from '@/components/RunHistory'
import { SchedulerCard } from '@/components/SchedulerCard'
import { SchedulerEditor } from '@/components/SchedulerEditor'
import { Button } from '@/components/ui/button'
import { useApi } from '@/lib/api'

type Editor = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; scheduler: SchedulerView }
type Tab = 'schedulers' | 'history'

/** Show the development-only "look back" button (Vite sets DEV for `npm run dev` and tests). */
const SHOW_DEBUG = import.meta.env.DEV

export function HomeScreen({
  status,
  onStatus,
}: {
  status: AuthStatus
  onStatus: (s: AuthStatus) => void
}) {
  const api = useApi()
  const [schedulers, setSchedulers] = useState<SchedulerView[] | null>(null)
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null)
  const [playlistsError, setPlaylistsError] = useState<string>()
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<Editor>({ mode: 'closed' })
  const [tab, setTab] = useState<Tab>('schedulers')
  /** Scans started from this window that haven't finished yet. */
  const [starting, setStarting] = useState<Set<string>>(() => new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  /** Fetch playlists; `apply` receives the result so callers decide whether it's still wanted. */
  const fetchPlaylists = useCallback(
    (apply: (playlists: Playlist[], error?: string) => void) =>
      api.youtube.listMyPlaylists().then(
        (p) => apply(p),
        (e: Error) => apply([], e.message),
      ),
    [api],
  )

  const applyPlaylists = (p: Playlist[], err?: string) => {
    setPlaylists(p)
    setPlaylistsError(err)
  }

  // Initial load. State is set in promise callbacks, and skipped after unmount.
  useEffect(() => {
    let alive = true
    api.schedulers.list().then(
      (s) => alive && setSchedulers(s),
      (e: Error) => alive && setError(e.message),
    )
    void fetchPlaylists((p, err) => {
      if (!alive) return
      setPlaylists(p)
      setPlaylistsError(err)
    })
    // Scans change "last scan" and may turn a scheduler off: reload when one starts or ends.
    const off = api.runs.onChange(() => {
      api.schedulers.list().then(
        (s) => alive && setSchedulers(s),
        () => undefined,
      )
    })
    // Keep "5 min ago" labels fresh.
    const tick = setInterval(() => alive && setNow(new Date()), 30_000)
    return () => {
      alive = false
      off()
      clearInterval(tick)
    }
  }, [api, fetchPlaylists])

  /** Re-fetch when opening the editor, so playlists made on YouTube meanwhile show up. */
  const loadPlaylists = () => void fetchPlaylists(applyPlaylists)

  const replace = (s: SchedulerView) =>
    setSchedulers((list) => list?.map((x) => (x.id === s.id ? s : x)) ?? [s])

  const run = async (action: () => Promise<void>) => {
    setError(null)
    try {
      await action()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const runNow = (s: SchedulerView) =>
    run(async () => {
      setNotice(null)
      setStarting((ids) => new Set(ids).add(s.id))
      try {
        const result = await api.schedulers.runNow(s.id)
        setSchedulers(
          (list) => list?.map((x) => (x.id === s.id ? { ...x, lastRun: result } : x)) ?? null,
        )
        setNow(new Date())
      } finally {
        setStarting((ids) => {
          const next = new Set(ids)
          next.delete(s.id)
          return next
        })
      }
    })

  const debugLookback = (s: SchedulerView) =>
    run(async () => {
      await api.debug.lookback(s.id, 7)
      setNotice(`"${s.name}" will treat uploads from the last 7 days as new. Use Run now.`)
    })

  const remove = (s: SchedulerView) =>
    run(async () => {
      if (
        !window.confirm(
          `Delete "${s.name}"? Its tracked channels and history are removed too. The playlist itself is not touched.`,
        )
      )
        return
      await api.schedulers.remove(s.id)
      setSchedulers((list) => list?.filter((x) => x.id !== s.id) ?? [])
    })

  return (
    <div className="flex min-h-screen flex-col">
      <AccountHeader
        profile={status.profile}
        onSignOut={() => void api.auth.signOut().then(onStatus)}
      />
      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div role="tablist" aria-label="Sections" className="flex gap-1 rounded-lg bg-muted p-1">
            {(['schedulers', 'history'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={
                  tab === t
                    ? 'rounded-md bg-background px-3 py-1 text-sm font-medium shadow-xs'
                    : 'rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground'
                }
              >
                {t === 'schedulers' ? 'Schedulers' : 'History'}
              </button>
            ))}
          </div>
          {tab === 'schedulers' && (
            <Button size="sm" onClick={() => setEditor({ mode: 'create' })}>
              <Plus /> New scheduler
            </Button>
          )}
        </div>

        {tab === 'history' && <RunHistory />}
        {tab === 'schedulers' && (
          <>
            {error && (
              <p role="alert" className="mb-4 text-sm text-destructive">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="mb-4 text-sm text-muted-foreground">
                {notice}
              </p>
            )}
            {schedulers === null && <p className="text-sm text-muted-foreground">Loading…</p>}
            {schedulers?.length === 0 && (
              <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No schedulers yet. Create one to start filling a playlist automatically.
              </p>
            )}
            {schedulers && schedulers.length > 0 && (
              <ul className="grid gap-3">
                {schedulers.map((s) => (
                  <SchedulerCard
                    key={s.id}
                    scheduler={s}
                    now={now}
                    running={starting.has(s.id) || s.lastRun?.status === 'running'}
                    onRunNow={() => void runNow(s)}
                    playlistMissing={
                      playlists !== null &&
                      !playlistsError &&
                      !playlists.some((p) => p.id === s.playlistId)
                    }
                    onDebugLookback={SHOW_DEBUG ? () => void debugLookback(s) : undefined}
                    onToggle={(active) =>
                      void run(async () => replace(await api.schedulers.setActive(s.id, active)))
                    }
                    onEdit={() => {
                      loadPlaylists()
                      setEditor({ mode: 'edit', scheduler: s })
                    }}
                    onDelete={() => void remove(s)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </main>

      {editor.mode !== 'closed' && (
        <SchedulerEditor
          editing={editor.mode === 'edit' ? editor.scheduler : undefined}
          playlists={playlists}
          playlistsError={playlistsError}
          schedulers={schedulers ?? []}
          onClose={() => setEditor({ mode: 'closed' })}
          onSaved={(saved) => {
            setSchedulers((list) =>
              list?.some((x) => x.id === saved.id)
                ? list.map((x) => (x.id === saved.id ? saved : x))
                : [...(list ?? []), saved],
            )
            setEditor({ mode: 'closed' })
          }}
        />
      )}
    </div>
  )
}
