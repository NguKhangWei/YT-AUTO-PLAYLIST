// Runs electron-vite with ELECTRON_RUN_AS_NODE removed from the environment.
// Shells spawned by VS Code extensions (and some other Electron hosts) set it,
// which makes Electron start as plain Node, so `require('electron')` returns a
// path string and the app crashes on `app.whenReady`.
import { spawn } from 'node:child_process'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn('electron-vite', process.argv.slice(2), {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
