// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiContext, ApiError } from '@/lib/api'
import { fakeApi, signedIn, view } from '@/test/fakeApi'
import type { Playlist, SchedulerView } from '../../../shared/api'
import { HomeScreen } from './HomeScreen'

const playlists: Playlist[] = [
  { id: 'PL1', title: 'Gaming videos', itemCount: 3 },
  { id: 'PL2', title: 'Learning', itemCount: 0 },
]

function renderHome(
  opts: {
    schedulers?: SchedulerView[]
    playlists?: Playlist[]
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
    api.schedulers.setActive.mockRejectedValueOnce(new ApiError('error', 'Database is locked'))
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

  it('rejects an unknown time zone before saving', async () => {
    const { api } = renderHome()
    fireEvent.click(await screen.findByRole('button', { name: 'New scheduler' }))
    change('Time zone', 'Mars/Base')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Create' }))
    expect((await within(dialog()).findByRole('alert')).textContent).toContain('Unknown time zone')
    expect(api.schedulers.create).not.toHaveBeenCalled()
  })

  it('explains an account without playlists', async () => {
    renderHome({ playlists: [] })
    fireEvent.click(await screen.findByRole('button', { name: 'New scheduler' }))
    expect(await within(dialog()).findByText(/You have no playlists/)).toBeTruthy()
  })

  it('shows playlist load errors in the editor', async () => {
    renderHome({
      tweak: (api) =>
        api.youtube.listMyPlaylists.mockRejectedValue(
          new ApiError('quotaExceeded', 'Quota used up'),
        ),
    })
    fireEvent.click(await screen.findByRole('button', { name: 'New scheduler' }))
    expect(await within(dialog()).findByText(/Couldn.t load playlists: Quota used up/)).toBeTruthy()
  })
})
