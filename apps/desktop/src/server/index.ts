// Command line for the auto-yt server bundle (out-server/server.mjs).
//
//   node server.mjs            run the server (settings from the environment)
//   node server.mjs --local    run it on this PC for testing (separate data folder)
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config'
import { serve } from './serve'

const here = dirname(fileURLToPath(import.meta.url))

async function main(argv: string[]): Promise<void> {
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

main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
