// Checks that a cloud VM can reach everything auto-yt needs, over IPv6 (milestone C0).
// No secrets, no quota, no npm install: run it with plain Node on the VM.
//
//   node cloud-probe.mjs [ntfy-topic] [--any-family]
//
// --any-family lets each connection use IPv4 or IPv6 (default: IPv6 only, like the VM).
// With a topic, sends one test push to https://ntfy.sh/<topic>.
import { promises as dns } from 'node:dns'
import { request } from 'node:https'
import { hostname } from 'node:os'

const args = process.argv.slice(2)
const anyFamily = args.includes('--any-family')
const topic = args.find((a) => !a.startsWith('--'))
const family = anyFamily ? 0 : 6
const TIMEOUT_MS = 10_000

// Known from your own scan history: two Shorts and two regular videos.
const SHORTS = ['GYfPPZMJ6do', 'N5qaKUaqYQk']
const REGULAR = ['xVoFS4Qv5jA', 'nB0R8yMlZcQ']

/** One HTTPS request; resolves with status, headers and the start of the body, or an error. */
function send(host, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const req = request(
      { host, path, method, headers, family, timeout: TIMEOUT_MS, autoSelectFamily: anyFamily },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          if (text.length < 2000) text += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }))
      },
    )
    req.on('timeout', () => req.destroy(new Error(`timed out after ${TIMEOUT_MS / 1000} s`)))
    req.on('error', (error) => resolve({ error: error.code ?? error.message }))
    req.end(body)
  })
}

const results = []
const report = (level, name, detail) => {
  results.push({ level, name })
  console.log(`${level.padEnd(4)}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const describe = (r) =>
  r.error === 'ENOENT' && !anyFamily
    ? 'ENOENT: this machine has no IPv6 connection (on a laptop, try --any-family)'
    : r.error
      ? r.error
      : `HTTP ${r.status}`

console.log(`auto-yt cloud probe on ${hostname()}, ${anyFamily ? 'IPv4 or IPv6' : 'IPv6 only'}\n`)

// Runtime: auto-yt needs Node 24 with the built-in SQLite.
const major = Number(process.versions.node.split('.')[0])
try {
  await import('node:sqlite')
  report(
    major >= 24 ? 'PASS' : 'FAIL',
    'Node.js',
    `v${process.versions.node}, node:sqlite available`,
  )
} catch {
  report('FAIL', 'Node.js', `v${process.versions.node}, node:sqlite missing (need 24+)`)
}

// DNS: which hosts have IPv6 addresses at all.
const HOSTS = {
  required: ['oauth2.googleapis.com', 'www.googleapis.com', 'www.youtube.com', 'ntfy.sh'],
  setup: [
    'deb.debian.org',
    'security.debian.org',
    'nodejs.org',
    'tailscale.com', // install.sh
    'pkgs.tailscale.com',
    'controlplane.tailscale.com',
  ],
  info: ['github.com'], // known IPv4-only: why the VM never pulls from GitHub
}
// Falls back to public resolvers (IPv6 ones first, for the VM) if the system's fails.
const publicDns = new dns.Resolver({ timeout: 3000, tries: 1 })
publicDns.setServers(['2001:4860:4860::8888', '2606:4700:4700::1111', '8.8.8.8', '1.1.1.1'])
const resolve6 = (host) => dns.resolve6(host).catch(() => publicDns.resolve6(host).catch(() => []))

console.log('\nIPv6 addresses (AAAA records)')
for (const [group, hosts] of Object.entries(HOSTS)) {
  for (const host of hosts) {
    const aaaa = await resolve6(host)
    const level = aaaa.length > 0 ? 'PASS' : group === 'required' && !anyFamily ? 'FAIL' : 'WARN'
    report(level, `${host} (${group})`, aaaa.length > 0 ? aaaa[0] : 'no IPv6 address')
  }
}

// Google sign-in: a deliberately invalid token request. A JSON error means it's reachable.
console.log('\nGoogle and YouTube')
const token = await send('oauth2.googleapis.com', '/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=refresh_token&refresh_token=probe&client_id=probe',
})
report(
  token.status && token.text.includes('"error"') ? 'PASS' : 'FAIL',
  'Google token endpoint',
  `${describe(token)} (an "invalid_client" error is expected)`,
)

// YouTube Data API without a key: a JSON error means it's reachable. Costs no quota.
const api = await send('www.googleapis.com', '/youtube/v3/videos?part=id&id=probe')
report(
  api.status && api.text.includes('"error"') ? 'PASS' : 'FAIL',
  'YouTube Data API',
  `${describe(api)} (an error about a missing key or sign-in is expected)`,
)

// The app's Shorts check: HEAD /shorts/{id} without following redirects.
// A Short answers 200; a regular video redirects to /watch.
let shortsOk = true
for (const [ids, expectShort] of [
  [SHORTS, true],
  [REGULAR, false],
]) {
  for (const id of ids) {
    const r = await send('www.youtube.com', `/shorts/${id}`, { method: 'HEAD' })
    const location = String(r.headers?.location ?? '')
    const right = expectShort
      ? r.status === 200
      : r.status >= 300 && r.status < 400 && location.includes('/watch')
    if (!right) shortsOk = false
    const hint = location.includes('consent.') ? ', sent to a consent page' : ''
    const where = location ? ` → ${location.slice(0, 60)}` : ''
    report(
      right ? 'PASS' : 'FAIL',
      `Shorts check, ${expectShort ? 'Short' : 'regular'} ${id}`,
      `${describe(r)}${where}${hint}`,
    )
  }
}

// ntfy: one test push, if a topic was given.
console.log('\nNotifications')
if (topic) {
  const push = await send('ntfy.sh', `/${encodeURIComponent(topic)}`, {
    method: 'POST',
    headers: { title: 'auto-yt probe', 'content-type': 'text/plain' },
    body: `auto-yt can reach ntfy from ${hostname()}.`,
  })
  report(push.status === 200 ? 'PASS' : 'FAIL', 'ntfy push', `${describe(push)}; check your phone`)
} else {
  const r = await send('ntfy.sh', '/', { method: 'HEAD' })
  report(
    r.status ? 'PASS' : 'FAIL',
    'ntfy reachable',
    `${describe(r)} (pass a topic to send a push)`,
  )
}

// Verdict.
const failed = results.filter((r) => r.level === 'FAIL').map((r) => r.name)
const blocking = failed.filter((n) => !n.startsWith('Shorts check'))
console.log('\nResult')
console.log(
  shortsOk
    ? '  SHORTS_PROBE=on   (the Shorts check works from here)'
    : '  SHORTS_PROBE=off  (the Shorts check is unreliable here: videos of 3 minutes or less count as Shorts)',
)
console.log(
  blocking.length === 0
    ? '  Everything auto-yt needs is reachable.'
    : `  Not reachable: ${blocking.join(', ')}. Stop and decide before deploying.`,
)
process.exitCode = blocking.length === 0 ? 0 : 1
