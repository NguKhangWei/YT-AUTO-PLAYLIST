import { DEFAULT_TIMEZONE } from '@auto-yt/core'
import { Button } from '@/components/ui/button'

export function App() {
  const versions = window.api?.versions

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-foreground">
      <h1 className="text-3xl font-semibold tracking-tight">auto-yt</h1>
      <p className="text-muted-foreground">
        Scaffold ready. Default time zone: <span className="font-mono">{DEFAULT_TIMEZONE}</span>
      </p>
      <Button disabled>Sign in with Google (coming in M5)</Button>
      {versions && (
        <p className="text-xs text-muted-foreground">
          Electron {versions.electron} · Chrome {versions.chrome} · Node {versions.node}
        </p>
      )}
    </main>
  )
}
