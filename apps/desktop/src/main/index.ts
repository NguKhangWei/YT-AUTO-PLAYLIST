import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron'
import { createGoogleAuth } from './auth/google-auth'
import { createEncryptedFileStore } from './auth/token-store'
import { openDatabase } from './db/database'
import { createSqliteStorage } from './db/sqlite-storage'
import { registerIpc } from './ipc'
import { createSchedulerService } from './schedulers'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    title: 'auto-yt',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Never navigate the app window away; open external links in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  const auth = createGoogleAuth({
    clientId: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID,
    clientSecret: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET,
    store: createEncryptedFileStore(join(app.getPath('userData'), 'auth.bin'), safeStorage),
    openExternal: (url) => shell.openExternal(url),
  })
  const storage = createSqliteStorage(openDatabase(join(app.getPath('userData'), 'auto-yt.db')))
  const schedulers = createSchedulerService({ storage, now: () => new Date() })
  registerIpc({ ipcMain, auth, schedulers, getWindows: () => BrowserWindow.getAllWindows() })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
