import { join } from 'node:path'
import { createYouTubeClient, isShortVideo } from '@auto-yt/core'
import { app, BrowserWindow, ipcMain, Notification, safeStorage, shell } from 'electron'
import { IPC } from '../shared/ipc'
import { createGoogleAuth } from './auth/google-auth'
import { createEncryptedFileStore } from './auth/token-store'
import { openDatabase } from './db/database'
import { createSqliteStorage } from './db/sqlite-storage'
import { createChannelService } from './channels'
import { registerIpc } from './ipc'
import { createQuotaTracker } from './quota'
import { createRunner } from './runner'
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

// Windows shows this as the notification sender (instead of "electron.app.Electron").
app.setAppUserModelId('com.auto-yt.app')

function focusWindow(): void {
  const [win] = BrowserWindow.getAllWindows()
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

void app.whenReady().then(() => {
  const auth = createGoogleAuth({
    clientId: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID,
    clientSecret: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET,
    store: createEncryptedFileStore(join(app.getPath('userData'), 'auth.bin'), safeStorage),
    openExternal: (url) => shell.openExternal(url),
  })
  const storage = createSqliteStorage(openDatabase(join(app.getPath('userData'), 'auto-yt.db')))
  const now = () => new Date()
  const getWindows = () => BrowserWindow.getAllWindows()
  const quota = createQuotaTracker({
    storage,
    now,
    onChange: (status) => getWindows().forEach((w) => w.webContents.send(IPC.quotaChanged, status)),
  })
  // One client for the whole app, so every API call is counted in the quota meter.
  const youtube = createYouTubeClient({
    getAccessToken: auth.getAccessToken,
    onQuota: (units) => quota.record(units),
  })
  const schedulers = createSchedulerService({ storage, now })
  const channels = createChannelService({ storage, youtube, now })
  storage.markInterruptedRuns(now())
  const runner = createRunner({
    storage,
    youtube,
    isShort: (id) => isShortVideo(id),
    quotaRemaining: quota.remaining,
    now,
    notify: ({ title, body }) => {
      if (!Notification.isSupported()) return
      const n = new Notification({ title, body })
      n.on('click', focusWindow)
      n.show()
    },
    onChange: () => getWindows().forEach((w) => w.webContents.send(IPC.runsChanged)),
    log: (message, error) => console.error(message, error),
  })
  registerIpc({
    ipcMain,
    auth,
    youtube,
    schedulers,
    channels,
    quota,
    runner,
    storage,
    isDev: !app.isPackaged,
    now,
    getWindows,
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
