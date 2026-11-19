// Command line for the auto-yt server bundle (out-server/server.mjs).
//
//   node server.mjs                       run the server (settings from the environment)
//   node server.mjs --local               run it on this PC for testing (separate data folder)
//   node server.mjs signin [--out FILE]   sign in here and write the server's token file
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { googleClient, loadConfig } from './config'
import { serve } from './serve'
import { signInToFile } from './signin'

const here = dirname(fileURLToPath(import.meta.url))

async function signIn(argv: string[]): Promise<void> {
  const { clientId, clientSecret } = googleClient(process.env)
  if (!clientId || !clientSecret) {
    throw new Error(
      'Set the Google client first: MAIN_VITE_GOOGLE_CLIENT_ID and MAIN_VITE_GOOGLE_CLIENT_SECRET in the repo .env.',
    )
  }
  const i = argv.indexOf('--out')
  const outFile = resolve(
    i >= 0 && argv[i + 1] ? argv[i + 1]! : join(tmpdir(), 'auto-yt-auth.json'),
  )
  console.log('Opening Google sign-in in your browser…')
  const profile = await signInToFile({ clientId, clientSecret, outFile })
  console.log(
    `\nSigned in as ${profile?.name ?? 'your Google account'}. Token file: ${outFile}\n` +
      'It holds a Google refresh token: copy it to the server (docs/DEPLOYMENT.md, step 2.11), ' +
      'then delete it here. Never commit or share it.',
  )
}

async function run(argv: string[]): Promise<void> {
  const local = argv.includes('--local')
  const config = loadConfig(process.env, { local })
  const server = await serve(config, join(here, 'web'))
  console.log(
    `auto-yt server on http://127.0.0.1:${server.port} | data ${config.dataDir} | ` +
      `notifications ${config.ntfyTopic ? 'ntfy' : 'off (no NTFY_TOPIC)'} | ` +
      `Shorts check ${config.shortsProbe ? 'on' : 'off (3 minutes or less = Short)'}` +
      (config.allowedLogin === '*' ? ' | open to anyone on this computer (local mode)' : ''),
  )
  const shutdown = () => {
    void server.stop().finally(() => process.exit(0))
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}

const argv = process.argv.slice(2)
const command = argv[0] === 'signin' ? signIn(argv.slice(1)) : run(argv)
command
  .then(() => {
    if (argv[0] === 'signin') process.exit(0) // the sign-in's loopback server is closed; don't linger
  })
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
