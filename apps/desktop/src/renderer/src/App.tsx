import { useAuthStatus } from '@/hooks/useAuthStatus'
import { HomeScreen } from '@/screens/HomeScreen'
import { SetupScreen } from '@/screens/SetupScreen'
import { SignInScreen } from '@/screens/SignInScreen'

/** Routes between setup, sign-in and the main screen based on auth status. */
export function App() {
  const { status, error, update } = useAuthStatus()

  if (error) {
    return (
      <p role="alert" className="p-8 text-destructive">
        Couldn&apos;t start: {error}
      </p>
    )
  }
  if (!status) return null
  if (!status.configured) return <SetupScreen />
  if (!status.signedIn) return <SignInScreen status={status} onSignedIn={update} />
  return <HomeScreen status={status} onStatus={update} />
}
