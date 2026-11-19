// `npm run cloud:signin`: signs in on this computer and writes the token file for the server.
import { spawn } from 'node:child_process'
import { createGoogleAuth } from '../main/auth/google-auth'
import { createPlainFileStore } from '../main/auth/token-store'
import type { Profile } from '../shared/api'

/** The command that opens `url` in the default browser, without a shell parsing the URL. */
export function browserCommand(platform: NodeJS.Platform, url: string): [string, string[]] {
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]]
  if (platform === 'darwin') return ['open', [url]]
  return ['xdg-open', [url]]
}

async function openBrowser(url: string): Promise<void> {
  console.log(`\nIf the browser doesn't open, visit:\n${url}\n`)
  const [cmd, args] = browserCommand(process.platform, url)
  spawn(cmd, args, { stdio: 'ignore', detached: true })
    .on('error', () => undefined) // the printed link still works
    .unref()
}

/** Runs the browser sign-in (same client as the server) and saves the sign-in to `outFile`. */
export async function signInToFile(opts: {
  clientId: string
  clientSecret: string
  outFile: string
}): Promise<Profile | undefined> {
  const auth = createGoogleAuth({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    store: createPlainFileStore(opts.outFile),
    openExternal: openBrowser,
  })
  const status = await auth.signIn()
  return status.profile
}
