// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiContext } from '@/lib/api'
import { channel, fakeApi, run, signedIn, view } from '@/test/fakeApi'
import type { Playlist, RunView, SchedulerView } from '../../../shared/api'
import { HomeScreen } from './HomeScreen'

const playlists: Playlist[] = [
  { id: 'PL1', title: 'Gaming videos', itemCount: 3 },
  { id: 'PL2', title: 'Learning', itemCount: 0 },
]

function renderHome(
  opts: {
    schedulers?: SchedulerView[]
    playlists?: Playlist[]
    runs?: RunView[]
    tweak?: (api: ReturnType<typeof fakeApi>['api']) => void
  } = {},
) {
  const fake = fakeApi(signedIn, { playlists, ...opts })
  opts.tweak?.(fake.api)
  render(
    <ApiContext.Provider value={fake.api}>
      <HomeScreen status={signedIn} onStatus={() => undefined} />
    </ApiContext.Provider>,
  )
  return fake
}

const dialog = () => screen.getByRole('dialog')
const field = (label: string) => within(dialog()).getByLabelText(label)
const change = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } })

beforeEach(() => vi.spyOn(window, 'confirm').mockReturnValue(true))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('scheduler list', () => {
  it('shows each scheduler with its playlist, schedule and next scan in its own zone', async () => {
    renderHome({
      schedulers: [view(), view({ id: 's2', name: 'Off one', playlistId: 'PL2', active: false })],
    })
    const card = await screen.findByRole('listitem', { name: 'Gaming' })
    expect(within(card).getByText('→ Gaming videos')).toBeTruthy()
    expect(within(card).getByText('Every day at 09:00 (Asia/Kuala_Lumpur)')).toBeTruthy()
    // 2026-11-11T01:00Z is 09:00 on Wed 11 Nov in Malaysia Time.
    expect(within(card).getByText('Wed 11 Nov, 09:00')).toBeTruthy()
    expect(within(card).getByText('None yet')).toBeTruthy()
    const off = screen.getByRole('listitem', { name: 'Off one' })
    expect(within(off).getByText('Off')).toBeTruthy()
  })

  it('toggles a scheduler on and off', async () => {
    const { api } = renderHome({ schedulers: [view()] })
    fireEvent.click(await screen.findByRole('switch', { name: 'Gaming active' }))
    expect(api.schedulers.setActive).toHaveBeenCalledWith('s1', false)
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: 'Gaming active' }).getAttribute('aria-checked'),
      ).toBe('false'),
    )
  })

  it('deletes after confirmation, and not without it', async () => {
    const { api } = renderHome({ schedulers: [view()] })
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(api.schedulers.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Gaming' })).toBeNull())
    expect(api.schedulers.remove).toHaveBeenCalledWith('s1')
  })

  it('shows errors from actions', async () => {
    const { api } = renderHome({ schedulers: [view()] })
    api.schedulers.setActive.mockRejectedValueOnce(new Error('Database is locked'))
    fireEvent.click(await screen.findByRole('switch', { name: 'Gaming active' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Database is locked')
  })
})

describe('scheduler editor', () => {
  it('creates a scheduler with defaults (daily, 09:00, Malaysia Time)', async () => {
    const { api } = renderHome()
    fireEvent.click(await screen.findByRole('button', { name: 'New scheduler' }))
    expect((field('Time zone') as HTMLInputElement).value).toBe('Asia/Kuala_Lumpur')
    expect((field('At') as HTMLInputElement).value).toBe('09:00')

    change('Name', 'Learning')
    await within(dialog()).findByRole('option', { name: 'Learning' })
    change('Playlist', 'PL2')
    change('Scan', '3')
    change('At', '21:15')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('listitem', { name: 'Learning' })).toBeTruthy()
    expect(api.schedulers.create).toHaveBeenCalledWith({
      name: 'Learning',
      playlistId: 'PL2',
      playlistTitle: 'Learning',
      intervalDays: 3,
      timeOfDay: '21:15',
      timezone: 'Asia/Kuala_Lumpur',
      channels: [],
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers every interval from 1 to 30 days', async () => {
    renderHome()
    fireEvent.click(await screen.findByRole('button', { name: 'New scheduler' }))
    const options = within(field('Scan')).getAllByRole('option')
    expect(options).toHaveLength(30)
    expect(options[0]?.textContent).toBe('Every day')
    expect(options[29]?.textContent).toBe('Every 30 days')
  })

  it('disables playlists already used by another scheduler', async () => {
    renderHome({ schedulers: [view()] })
    fireEvent.click(await screen.findByRole('button', { name: 'New scheduler' }))
    const used = await within(dialog()).findByRole('option', {
      name: 'Gaming videos (used by Gaming)',
    })
    expect((used as HTMLOptionElement).disabled).toBe(true)
    expect(
      (within(dialog()).getByRole('option', { name: 'Learning' }) as HTMLOptionElement).disabled,
    ).toBe(false)
  })

  it('edits a scheduler, keeping its own playlist selectable', async () => {
    const { api } = renderHome({ schedulers: [view()] })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect((field('Name') as HTMLInputElement).value).toBe('Gaming')
    const own = await within(dialog()).findByRole('option', { name: 'Gaming videos' })
    expect((own as HTMLOptionElement).disabled).toBe(false)

    change('Name', 'Games')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('listitem', { name: 'Games' })).toBeTruthy()
    expect(api.schedulers.update).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ name: 'Games' }),
    )
    // Only input fields are sent, not the whole view.
    expect(Object.keys(api.schedulers.update.mock.calls[0]![1]).sort()).toEqual([
      'channels',
      'intervalDays',
      'name',
      'playlistId',
      'playlistTitle',
      'timeOfDay',
      'timezone',
    ])
  })

  it('shows validation errors from main and keeps the dialog open', async () => {
    renderHome({ schedulers: [view()] })
    fireEvent.click(await screen.findByRole('button', { name: 'New scheduler' }))
    change('Name', 'Dup')
    await within(dialog()).findByRole('option', { name: /Gaming videos/ })
    // Force the used playlist (the UI disables it, main still checks).
    change('Playlist', 'PL1')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Create' }))
    expect((await within(dialog()).findByRole('alert')).textContent).toContain(
      'already used by "Gaming"',
    )
  })

  it('explains an account without playlists', async () => {
    renderHome({ playlists: [] })
    fireEvent.click(await screen.findByRole('button', { name: 'New scheduler' }))
    expect(await within(dialog()).findByText(/You have no playlists/)).toBeTruthy()
  })

  it('shows playlist load errors in the editor', async () => {
    renderHome({
      tweak: (api) => api.youtube.listMyPlaylists.mockRejectedValue(new Error('Quota used up')),
    })
    fireEvent.click(await screen.findByRole('button', { name: 'New scheduler' }))
    expect(await within(dialog()).findByText(/Couldn.t load playlists: Quota used up/)).toBeTruthy()
  })
})

describe('channels in the editor', () => {
  it('adds searched channels to a new scheduler and shows them on the card', async () => {
    const { api } = renderHome()
    fireEvent.click(await screen.findByRole('button', { name: 'New scheduler' }))
    change('Name', 'Tech')
    await within(dialog()).findByRole('option', { name: 'Learning' })
    change('Playlist', 'PL2')
    change('Channels to track', 'channel')
    fireEvent.click(
      await within(dialog()).findByRole('button', { name: 'Add Channel 2' }, { timeout: 2000 }),
    )
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Create' }))

    const card = await screen.findByRole('listitem', { name: 'Tech' })
    expect(within(card).getByText('Channel 2')).toBeTruthy()
    expect(api.schedulers.create.mock.calls[0]![0].channels.map((c) => c.title)).toEqual([
      'Channel 2',
    ])
  })

  it('edits the channel list of an existing scheduler', async () => {
    const { api } = renderHome({ schedulers: [view({ channels: [channel(1), channel(2)] })] })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Remove Channel 1' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.schedulers.update).toHaveBeenCalled())
    expect(api.schedulers.update.mock.calls[0]![1].channels.map((c) => c.title)).toEqual([
      'Channel 2',
    ])
  })
})

describe('running scans', () => {
  it('runs a scheduler now and shows the outcome on its card', async () => {
    const { api } = renderHome({ schedulers: [view({ channels: [channel(1)] })] })
    const card = await screen.findByRole('listitem', { name: 'Gaming' })
    expect(within(card).getByText('Never')).toBeTruthy()

    fireEvent.click(within(card).getByRole('button', { name: 'Run now' }))
    expect(within(card).getByRole('button', { name: 'Running…' })).toBeTruthy()
    expect(await within(card).findByText('Added 2 videos')).toBeTruthy()
    expect(within(card).getByText('OK')).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Run now' })).toBeTruthy()
    expect(api.schedulers.runNow).toHaveBeenCalledWith('s1')
  })

  it('cannot run a scheduler with no channels', async () => {
    renderHome({ schedulers: [view()] })
    const button = (await screen.findByRole('button', { name: 'Run now' })) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('shows a failed last scan', async () => {
    renderHome({
      schedulers: [
        view({
          channels: [channel(1)],
          lastRun: run({
            status: 'error',
            addedCount: 0,
            error: { kind: 'quotaExceeded', message: 'Quota used up' },
          }),
        }),
      ],
    })
    expect(await screen.findByText('Failed: Quota used up')).toBeTruthy()
  })

  it('shows a scan in progress (e.g. a scheduled one) as running', async () => {
    renderHome({
      schedulers: [view({ channels: [channel(1)], lastRun: run({ status: 'running' }) })],
    })
    const button = (await screen.findByRole('button', { name: 'Running…' })) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText('Scanning…')).toBeTruthy()
  })

  it('reloads schedulers when main reports a scan started or finished', async () => {
    const fake = fakeApi(signedIn, { playlists, schedulers: [view({ channels: [channel(1)] })] })
    render(
      <ApiContext.Provider value={fake.api}>
        <HomeScreen status={signedIn} onStatus={() => undefined} />
      </ApiContext.Provider>,
    )
    await screen.findByRole('listitem', { name: 'Gaming' })
    fake.api.schedulers.list.mockResolvedValueOnce([
      view({
        channels: [channel(1)],
        active: false,
        lastRun: run({ status: 'error', details: { ...run().details!, deactivated: true } }),
      }),
    ])
    act(() => fake.emitRuns())
    expect(await screen.findByText('Off')).toBeTruthy()
  })
})

describe('history tab', () => {
  it('lists scans with their outcome and expandable details', async () => {
    renderHome({
      schedulers: [view()],
      runs: [
        run({
          id: 'r2',
          status: 'partial',
          addedCount: 1,
          error: { kind: 'quotaExceeded', message: 'Quota used up' },
        }),
        run({ id: 'r1', trigger: 'scheduled' }),
      ],
    })
    fireEvent.click(await screen.findByRole('tab', { name: 'History' }))
    const list = await screen.findByRole('list', { name: 'Scan history' })
    const items = [...list.children] as HTMLElement[] // one per run (details have their own lists)
    expect(items).toHaveLength(2)
    expect(within(items[0]!).getByText('Added 1 video, then stopped: Quota used up')).toBeTruthy()
    expect(within(items[0]!).getByText(/^Manual · /)).toBeTruthy()

    const link = within(items[1]!).getByRole('link', { name: 'First video' }) as HTMLAnchorElement
    expect(link.href).toBe('https://www.youtube.com/watch?v=v1')
    expect(within(items[1]!).getByText('Skipped: 1 Shorts')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New scheduler' })).toBeNull()
  })

  it('says when there are no scans yet', async () => {
    renderHome()
    fireEvent.click(await screen.findByRole('tab', { name: 'History' }))
    expect(await screen.findByText(/No scans yet/)).toBeTruthy()
  })
})

describe('playlist deleted on YouTube', () => {
  // The scheduler still points at the old "INFORMATIVE" (PL-old); a new one with the same
  // name exists under a different id.
  const recreated: Playlist[] = [{ id: 'PL-new', title: 'INFORMATIVE', itemCount: 0 }]
  const scheduler = view({ playlistId: 'PL-old', playlistTitle: 'INFORMATIVE' })

  it('offers only existing playlists and requires a new choice before saving', async () => {
    const { api } = renderHome({ schedulers: [scheduler], playlists: recreated })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await within(dialog()).findByRole('option', { name: 'INFORMATIVE' })
    expect(within(dialog()).getAllByRole('option', { name: 'INFORMATIVE' })).toHaveLength(1)
    expect((field('Playlist') as HTMLSelectElement).value).toBe('')

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))
    expect((await within(dialog()).findByRole('alert')).textContent).toBe('Choose a playlist.')
    expect(api.schedulers.update).not.toHaveBeenCalled()

    change('Playlist', 'PL-new')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.schedulers.update).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({ playlistId: 'PL-new', playlistTitle: 'INFORMATIVE' }),
      ),
    )
  })

  it('keeps the current playlist when the list could not be loaded', async () => {
    renderHome({
      schedulers: [scheduler],
      tweak: (api) => api.youtube.listMyPlaylists.mockRejectedValue(new Error('Offline')),
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await within(dialog()).findByText(/Couldn.t load playlists/)
    expect((field('Playlist') as HTMLSelectElement).value).toBe('PL-old')
    expect(within(dialog()).queryByRole('alert')).toBeNull()
  })
})

describe('pausing scheduled scans', () => {
  it('pauses and resumes, with a banner while paused', async () => {
    const { api } = renderHome({ schedulers: [view()] })
    fireEvent.click(await screen.findByRole('button', { name: 'Pause scans' }))
    expect(await screen.findByText(/Scheduled scans are paused/)).toBeTruthy()
    expect(api.scans.setPaused).toHaveBeenCalledWith(true)

    fireEvent.click(screen.getByRole('button', { name: 'Resume scans' }))
    await waitFor(() => expect(screen.queryByText(/Scheduled scans are paused/)).toBeNull())
    expect(api.scans.setPaused).toHaveBeenLastCalledWith(false)
  })

  it('follows a pause made from the tray', async () => {
    const fake = fakeApi(signedIn, { playlists, schedulers: [view()] })
    render(
      <ApiContext.Provider value={fake.api}>
        <HomeScreen status={signedIn} onStatus={() => undefined} />
      </ApiContext.Provider>,
    )
    await screen.findByRole('button', { name: 'Pause scans' })
    act(() => fake.emitPaused(true))
    expect(await screen.findByText(/Scheduled scans are paused/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resume scans' })).toBeTruthy()
  })
})
