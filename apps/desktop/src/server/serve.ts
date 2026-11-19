// Runs auto-yt headless: the scheduler loop plus the private web UI (for the cloud VM).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import { createGoogleAuth } from '../main/auth/google-auth'
import { createPlainFileStore } from '../main/auth/token-store'
import { createChannelService } from '../main/channels'
import { assumeShort } from '../main/core/filter'
import { createYouTubeClient, isShortVideo } from '../main/core/youtube/client'
import { openDatabase } from '../main/db/database'
import { createSqliteStorage } from '../main/db/sqlite-storage'
import { createHandlers } from '../main/ipc'
import type { NotificationText } from '../main/notifications'
import { createNtfyNotifier } from '../main/ntfy'
import { createRunner } from '../main/runner'
import { createSchedulerLoop } from '../main/scheduler-loop'
import { createSchedulerService } from '../main/schedulers'
import { createBackups } from './backups'
import type { ServerConfig } from './config'
import { createWebServer } from './http'

export const SIGN_IN_HELP =
  'The cloud server has no browser, so sign in from your laptop: run "npm run cloud:signin" ' +
  'and copy the file it writes to the server (docs/DEPLOYMENT.md, step 2.11).'

/** Starts everything; resolves once the web UI is listening. */
export async function serve(config: ServerConfig, webDir: string) {
  const now = () => new Date()
  const log = (message: string, error: unknown) => console.error(message, error)

  const auth = createGoogleAuth({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    store: createPlainFileStore(join(config.dataDir, 'auth.json')),
    openExternal: async () => {
      throw new Error(SIGN_IN_HELP)
    },
  })
  mkdirSync(config.dataDir, { recursive: true })
  const db = openDatabase(join(config.dataDir, 'auto-yt.db'))
  const storage = createSqliteStorage(db)
  storage.markInterruptedRuns(now())

  const notify: (n: NotificationText) => void = config.ntfyTopic
    ? createNtfyNotifier({ topic: config.ntfyTopic, server: config.ntfyServer, log })
    : (n) => console.log(`[notification] ${n.title}: ${n.body}`)

  // `web` is created after the services, which push through it.
  let broadcast: (channel: string, value?: unknown) => void = () => undefined
  const youtube = createYouTubeClient({ getAccessToken: auth.getAccessToken })
  const runner = createRunner({
    storage,
    youtube,
    isShort: config.shortsProbe ? isShortVideo : assumeShort,
    now,
    notify,
    onChange: () => broadcast(IPC.runsChanged),
    log,
  })
  const loop = createSchedulerLoop({
    storage,
    runner,
    now,
    isSignedIn: async () => (await auth.status()).signedIn,
    notify,
    onChange: () => {
      broadcast(IPC.scansPausedChanged, loop.isPaused())
      broadcast(IPC.runsChanged) // next-run times moved
    },
    log,
  })
  const schedulers = createSchedulerService({ storage, now, onChange: () => loop.poke() })
  const channels = createChannelService({ youtube, now })

  const handlers = {
    ...createHandlers({ auth, youtube, schedulers, channels, runner, storage, loop }),
    [IPC.authSignIn]: () => {
      throw new Error(SIGN_IN_HELP)
    },
    [IPC.authCancelSignIn]: () => undefined,
  }
  const web = createWebServer({ handlers, webDir, allowedLogin: config.allowedLogin, log })
  broadcast = web.broadcast
  auth.onStatusChange((status) => {
    broadcast(IPC.authStatusChanged, status)
    if (status.signedIn) loop.poke()
  })

  const port = await web.listen(config.port)
  loop.start() // checks right away, so scans missed while the server was down run now
  const backups = createBackups({ db, dir: join(config.dataDir, 'backups'), now, log })
  backups.start()

  return {
    port,
    db,
    loop,
    async stop() {
      backups.stop()
      loop.stop()
      await web.close()
      db.close()
    },
  }
}
