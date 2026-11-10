// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Api } from '../../shared/api'
import { App } from './App'
import { ApiContext, ApiError } from './lib/api'
import { fakeApi, signedIn, signedOut } from './test/fakeApi'

afterEach(cleanup)

const renderApp = (api: Api) =>
  render(
    <ApiContext.Provider value={api}>
      <App />
    </ApiContext.Provider>,
  )

const playlists = [
  { id: 'PL1', title: 'Gaming', itemCount: 12, thumbnailUrl: 'https://i.ytimg.com/vi/x/mq.jpg' },
  { id: 'PL2', title: 'Learning', itemCount: 1 },
]

describe('App', () => {
  it('shows setup instructions when the OAuth client is not configured', async () => {
    const { api } = fakeApi({ configured: false, signedIn: false, signingIn: false })
    renderApp(api)
    expect(await screen.findByRole('heading', { name: 'Set up Google access' })).toBeTruthy()
    expect(screen.getByText(/README → Setup/)).toBeTruthy()
  })

  it('signs in from the sign-in screen and then lists playlists', async () => {
    const { api } = fakeApi(signedOut, playlists)
    renderApp(api)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }))
    expect(api.auth.signIn).toHaveBeenCalledOnce()

    expect(await screen.findByText('Gaming')).toBeTruthy()
    expect(screen.getByText('12 videos')).toBeTruthy()
    expect(screen.getByText('1 video')).toBeTruthy()
    expect(screen.getByText('Khang Wei')).toBeTruthy()
  })

  it('shows sign-in errors', async () => {
    const { api } = fakeApi(signedOut)
    api.auth.signIn.mockRejectedValueOnce(new Error('Sign-in was cancelled in the browser.'))
    renderApp(api)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Sign-in was cancelled in the browser.',
    )
  })

  it('offers Cancel while the browser sign-in is in progress', async () => {
    const { api } = fakeApi({ ...signedOut, signingIn: true })
    renderApp(api)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(api.auth.cancelSignIn).toHaveBeenCalledOnce()
  })

  it('signs out from the header', async () => {
    const { api } = fakeApi(signedIn, playlists)
    renderApp(api)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeTruthy()
  })

  it('returns to sign-in when main reports the session ended (revoked token)', async () => {
    const { api, emit } = fakeApi(signedIn, playlists)
    renderApp(api)
    await screen.findByText('Gaming')
    act(() => emit(signedOut))
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeTruthy()
  })

  it('shows playlist load errors and an empty state, and refreshes', async () => {
    const { api } = fakeApi(signedIn, [])
    api.youtube.listMyPlaylists.mockRejectedValueOnce(
      new ApiError('quotaExceeded', 'Quota used up'),
    )
    renderApp(api)
    expect((await screen.findByRole('alert')).textContent).toContain('Quota used up')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText(/No playlists yet/)).toBeTruthy()
  })
})
