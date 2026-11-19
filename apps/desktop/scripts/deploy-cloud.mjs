// Copies the built server to the VM over Tailscale SSH and restarts it (milestone C4).
//
//   npm run deploy:cloud -- User@auto-yt              build, copy, switch, restart
//   npm run deploy:cloud -- User@auto-yt --rollback   switch back to the previous version
//
// On the VM: /opt/auto-yt/app is live, app.prev the version before, app.new the upload.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const target = args.find((a) => !a.startsWith('--'))
const rollback = args.includes('--rollback')
const built = join(dirname(fileURLToPath(import.meta.url)), '..', 'out-server')

if (!target || !/^[\w.-]+@[\w.-]+$/.test(target)) {
  console.error(
    'Usage: npm run deploy:cloud -- <vm-user>@<vm-host> [--rollback]  (e.g. User@auto-yt)',
  )
  process.exit(2)
}

/** Runs a command with its output shown; stops the deploy if it fails. */
function run(cmd, cmdArgs, what) {
  console.log(`\n> ${what}`)
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit' })
  if (r.error) {
    console.error(`Could not run ${cmd}: ${r.error.message}`)
    process.exit(1)
  }
  if (r.status !== 0) {
    console.error(`Failed (exit ${r.status}): ${what}`)
    process.exit(r.status ?? 1)
  }
}
const remote = (script, what) => run('ssh', [target, script], what)

const restart =
  'sudo systemctl restart auto-yt && sleep 3 && systemctl is-active auto-yt && ' +
  'journalctl -u auto-yt -n 5 --no-pager -o cat'

if (rollback) {
  remote(
    'set -e; cd /opt/auto-yt; test -d app.prev || { echo "No previous version to go back to."; exit 1; }; ' +
      'rm -rf app.bad; mv app app.bad; mv app.prev app; ' +
      restart,
    'Switching back to the previous version and restarting',
  )
  console.log('\nRolled back. The version you left is in /opt/auto-yt/app.bad.')
  process.exit(0)
}

if (!existsSync(join(built, 'server.mjs')) || !existsSync(join(built, 'web', 'index.html'))) {
  console.error('No build found: run "npm run build:server" first (deploy:cloud does it for you).')
  process.exit(1)
}
remote('rm -rf /opt/auto-yt/app.new', 'Preparing /opt/auto-yt/app.new on the VM')
run('scp', ['-r', '-q', built, `${target}:/opt/auto-yt/app.new`], 'Copying the build to the VM')
remote(
  'set -e; cd /opt/auto-yt; rm -rf app.prev; if [ -d app ]; then mv app app.prev; fi; mv app.new app; ' +
    restart,
  'Switching to the new version and restarting',
)
console.log('\nDeployed. If something is wrong: npm run deploy:cloud -- ' + target + ' --rollback')
