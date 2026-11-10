import { useState } from 'react'
import type { AuthStatus } from '../../../shared/api'
import { Button } from '@/components/ui/button'
import { useApi } from '@/lib/api'

export function SignInScreen({
  status,
  onSignedIn,
}: {
  status: AuthStatus
  onSignedIn: (s: AuthStatus) => void
}) {
  const api = useApi()
  const [error, setError] = useState<string | null>(null)

  const signIn = async () => {
    setError(null)
    try {
      onSignedIn(await api.auth.signIn())
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-5 p-8 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">auto-yt</h1>
      <p className="text-muted-foreground">
        Sign in with the Google account whose YouTube playlists you want to fill.
      </p>
      {status.signingIn ? (
        <>
          <p className="text-sm">Waiting for you to finish signing in in your browser…</p>
          <Button variant="outline" onClick={() => void api.auth.cancelSignIn()}>
            Cancel
          </Button>
        </>
      ) : (
        <Button onClick={() => void signIn()}>Sign in with Google</Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Google may warn that the app is unverified; it&apos;s your own OAuth client, so choose
        Advanced → Go to app.
      </p>
    </main>
  )
}
