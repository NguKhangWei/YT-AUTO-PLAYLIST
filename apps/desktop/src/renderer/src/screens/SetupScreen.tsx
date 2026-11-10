/** Shown when the Google OAuth client isn't configured in .env yet. */
export function SetupScreen() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Set up Google access</h1>
      <p className="text-muted-foreground">
        auto-yt uses your own Google Cloud OAuth client. It isn&apos;t configured yet.
      </p>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>
          Follow <strong>README → Setup</strong> to create a Google Cloud project, enable the
          YouTube Data API v3 and create a <strong>Desktop app</strong> OAuth client.
        </li>
        <li>
          Copy <code className="rounded bg-muted px-1">.env.example</code> to{' '}
          <code className="rounded bg-muted px-1">.env</code> in the repo root and fill in the
          client ID and secret.
        </li>
        <li>Restart the app.</li>
      </ol>
    </main>
  )
}
