// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './App'

afterEach(cleanup)

describe('App', () => {
  it('renders the app name and default time zone from core', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'auto-yt' })).toBeTruthy()
    expect(screen.getByText('Asia/Kuala_Lumpur')).toBeTruthy()
  })

  it('renders without the preload API (e.g. in tests)', () => {
    render(<App />)
    expect(screen.queryByText(/Electron/)).toBeNull()
  })
})
