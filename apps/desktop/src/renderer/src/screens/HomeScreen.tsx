// Main screen: the scheduler list, the History tab and the scheduler editor.
import { Pause, Play, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Api, AuthStatus, SchedulerView } from '../../../shared/api'
import { AccountHeader } from '@/components/AccountHeader'
import { RunHistory } from '@/components/RunHistory'
import { SchedulerCard } from '@/components/SchedulerCard'
import { SchedulerEditor } from '@/components/SchedulerEditor'
import { Button } from '@/components/ui/button'
import { useLive } from '@/hooks/useLive'
import { useApi } from '@/lib/api'

type Editor = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; scheduler: SchedulerView }

const listSchedulers = (api: Api) => api.schedulers.list()
const listPlaylists = (api: Api) => api.youtube.listMyPlaylists()
const isPaused = (api: Api) => api.scans.isPaused()
const watchRuns = (api: Api, reload: () => void) => api.runs.onChange(() => reload())
const watchPaused = (api: Api, onChange: (paused?: boolean) => void) =>
  api.scans.onPausedChange(onChange)

export function HomeScreen({
  status,
  onStatus,
}: {
  status: AuthStatus
  onStatus: (s: AuthStatus) => void
}) {
  const api = useApi()
  const schedulers = useLive(listSchedulers, watchRuns) // scans change "last scan" and may turn one off
  const playlists = useLive(listPlaylists)
  const paused = useLive(isPaused, watchPaused)
  const [editor, setEditor] = useState<Editor>({ mode: 'closed' })
  const [tab, setTab] = useState<'schedulers' | 'history'>('schedulers')
  const [starting, setStarting] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000) // keeps "5 min ago" fresh
    return () => clearInterval(timer)
  }, [])

  const replace = (s: SchedulerView) =>
    schedulers.setValue((list) => {
      if (!list) return [s]
      return list.some((x) => x.id === s.id)
        ? list.map((x) => (x.id === s.id ? s : x))
        : [...list, s]
    })

  /** Runs a user action, showing its error message if it fails. */
  const attempt = async (action: () => Promise<unknown>) => {
    setError(null)
    try {
      await action()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const runNow = (s: SchedulerView) =>
    attempt(async () => {
      setStarting((ids) => new Set(ids).add(s.id))
      try {
        replace({ ...s, lastRun: await api.schedulers.runNow(s.id) })
        setNow(new Date())
      } finally {
        setStarting((ids) => new Set([...ids].filter((id) => id !== s.id)))
      }
    })

  const remove = (s: SchedulerView) =>
    attempt(async () => {
      const message = `Delete "${s.name}"? Its tracked channels and history are removed too. The playlist itself is not touched.`
      if (!window.confirm(message)) return
      await api.schedulers.remove(s.id)
      schedulers.setValue((list) => list?.filter((x) => x.id !== s.id) ?? [])
    })

  const openEditor = (next: Editor) => {
    void playlists.reload() // picks up playlists made on YouTube meanwhile
    setEditor(next)
  }

  const list = schedulers.value
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
            <div className="flex gap-2">
              {paused.value !== null && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void attempt(async () =>
                      paused.setValue(await api.scans.setPaused(!paused.value)),
                    )
                  }
                >
                  {paused.value ? <Play /> : <Pause />}{' '}
                  {paused.value ? 'Resume scans' : 'Pause scans'}
                </Button>
              )}
              <Button size="sm" onClick={() => openEditor({ mode: 'create' })}>
                <Plus /> New scheduler
              </Button>
            </div>
          )}
        </div>

        {paused.value && (
          <p
            role="status"
            className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          >
            Scheduled scans are paused. Run now still works. Missed scans run once when you resume.
          </p>
        )}
        {tab === 'history' && <RunHistory />}
        {tab === 'schedulers' && (
          <>
            {(error ?? schedulers.error) && (
              <p role="alert" className="mb-4 text-sm text-destructive">
                {error ?? schedulers.error}
              </p>
            )}
            {list === null && !schedulers.error && (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
            {list?.length === 0 && (
              <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No schedulers yet. Create one to start filling a playlist automatically.
              </p>
            )}
            {list && list.length > 0 && (
              <ul className="grid gap-3">
                {list.map((s) => (
                  <SchedulerCard
                    key={s.id}
                    scheduler={s}
                    now={now}
                    running={starting.has(s.id) || s.lastRun?.status === 'running'}
                    onRunNow={() => void runNow(s)}
                    onToggle={(active) =>
                      void attempt(async () =>
                        replace(await api.schedulers.setActive(s.id, active)),
                      )
                    }
                    onEdit={() => openEditor({ mode: 'edit', scheduler: s })}
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
          playlists={playlists.value}
          playlistsError={playlists.error}
          schedulers={list ?? []}
          onClose={() => setEditor({ mode: 'closed' })}
          onSaved={(saved) => {
            replace(saved)
            setEditor({ mode: 'closed' })
          }}
        />
      )}
    </div>
  )
}
