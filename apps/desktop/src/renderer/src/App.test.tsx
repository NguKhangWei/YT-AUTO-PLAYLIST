// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Api } from '../../shared/api'
import { App } from './App'
import { ApiContext } from './lib/api'
import { fakeApi, signedIn, signedOut } from './test/fakeApi'

afterEach(cleanup)

const renderWithApi = (api: Api) =>
  render(
    <ApiContext.Provider value={api}>
      <App />
    </ApiContext.Provider>,
  )

describe('App routing', () => {
  it('shows setup instructions when the OAuth client is not configured', async () => {
    const { api } = fakeApi({ configured: false, signedIn: false, signingIn: false })
    renderWithApi(api)
    expect(await screen.findByRole('heading', { name: 'Set up Google access' })).toBeTruthy()
    expect(screen.getByText(/README → Setup/)).toBeTruthy()
  })

  it('signs in from the sign-in screen and shows the account and schedulers', async () => {
    const { api } = fakeApi(signedOut)
    renderWithApi(api)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }))
    expect(api.auth.signIn).toHaveBeenCalledOnce()
    expect(await screen.findByRole('tab', { name: 'Schedulers' })).toBeTruthy()
    expect(screen.getByText('Khang Wei')).toBeTruthy()
    expect(await screen.findByText(/No schedulers yet/)).toBeTruthy()
  })

  it('shows sign-in errors', async () => {
    const { api } = fakeApi(signedOut)
    api.auth.signIn.mockRejectedValueOnce(new Error('Sign-in was cancelled in the browser.'))
    renderWithApi(api)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Sign-in was cancelled in the browser.',
    )
  })

  it('offers Cancel while the browser sign-in is in progress', async () => {
    const { api } = fakeApi({ ...signedOut, signingIn: true })
    renderWithApi(api)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(api.auth.cancelSignIn).toHaveBeenCalledOnce()
  })

  it('signs out from the header', async () => {
    const { api } = fakeApi(signedIn)
    renderWithApi(api)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeTruthy()
  })

  it('returns to sign-in when main reports the session ended (revoked token)', async () => {
    const { api, emit } = fakeApi(signedIn)
    renderWithApi(api)
    await screen.findByRole('tab', { name: 'Schedulers' })
    act(() => emit(signedOut))
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeTruthy()
  })
})
