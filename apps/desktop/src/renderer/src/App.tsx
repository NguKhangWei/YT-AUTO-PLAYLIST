// Shows setup, sign-in or the main screen depending on the sign-in state.
import type { Api, AuthStatus } from '../../shared/api'
import { useLive } from '@/hooks/useLive'
import { HomeScreen } from '@/screens/HomeScreen'
import { SetupScreen } from '@/screens/SetupScreen'
import { SignInScreen } from '@/screens/SignInScreen'

const loadStatus = (api: Api) => api.auth.getStatus()
const watchStatus = (api: Api, onChange: (s?: AuthStatus) => void) =>
  api.auth.onStatusChange(onChange)

export function App() {
  const { value: status, setValue, error } = useLive(loadStatus, watchStatus)

  if (error) {
    return (
      <p role="alert" className="p-8 text-destructive">
        Couldn&apos;t start: {error}
      </p>
    )
  }
  if (!status) return null
  if (!status.configured) return <SetupScreen />
  if (!status.signedIn) return <SignInScreen status={status} onSignedIn={setValue} />
  return <HomeScreen status={status} onStatus={setValue} />
}
