// Runs electron-vite without ELECTRON_RUN_AS_NODE, which VS Code terminals set and which breaks Electron.
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
