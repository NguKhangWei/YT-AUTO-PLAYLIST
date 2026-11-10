import { join } from 'node:path'
import { createYouTubeClient, isShortVideo } from '@auto-yt/core'
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  safeStorage,
  shell,
  Tray,
} from 'electron'
// asarUnpack: Windows toasts and the tray need real files, not paths inside app.asar.
import appIconPath from '../../resources/icon.png?asset&asarUnpack'
import trayIconPath from '../../resources/tray.png?asset&asarUnpack'
import { IPC } from '../shared/ipc'
import { createGoogleAuth } from './auth/google-auth'
import { createEncryptedFileStore } from './auth/token-store'
import { createChannelService } from './channels'
import { openDatabase } from './db/database'
import { createSqliteStorage } from './db/sqlite-storage'
import { registerIpc } from './ipc'
import { migrateLegacyData } from './legacy-data'
import type { NotificationText } from './notifications'
import { createQuotaTracker } from './quota'
import { createRunner } from './runner'
import { createSchedulerLoop } from './scheduler-loop'
import { createSchedulerService } from './schedulers'
import { trayMenu, trayTooltip } from './tray'

/** Passed by the login item: start in the tray without showing the window. */
const HIDDEN_ARG = '--hidden'
const TRAY_HINT_KEY = 'trayHintShown'
const LOGIN_ITEM_KEY = 'loginItemInitialized'

let mainWindow: BrowserWindow | null = null
let quitting = false
/** Set up in main(): what closing a window does (hide to tray). */
let onWindowClose: (e: Electron.Event, win: BrowserWindow) => void = () => undefined

// Only one copy may run: a second launch just shows the first one's window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Windows shows this as the notification sender (instead of "electron.app.Electron").
  app.setAppUserModelId('com.auto-yt.app')
  void app.whenReady().then(main)
}

function notify({ title, body }: NotificationText): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, icon: appIconPath })
  n.on('click', showWindow)
  n.show()
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    title: 'auto-yt',
    icon: appIconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  win.on('close', (e) => onWindowClose(e, win))

  // Never navigate the app window away; open external links in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

/** Show the window (creating it if needed), e.g. from the tray or a notification. */
function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    mainWindow.once('ready-to-show', () => mainWindow?.show())
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function main(): void {
  const userData = app.getPath('userData')
  // Builds before M10 kept data under "@auto-yt/desktop"; bring it over once.
  if (!app.commandLine.hasSwitch('user-data-dir')) {
    const copied = migrateLegacyData(join(app.getPath('appData'), '@auto-yt', 'desktop'), userData)
    if (copied.length > 0) console.log(`Moved ${copied.join(', ')} to ${userData}`)
  }
  const now = () => new Date()
  const send = (channel: string, ...args: unknown[]) =>
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, ...args))

  const auth = createGoogleAuth({
    clientId: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID,
    clientSecret: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET,
    store: createEncryptedFileStore(join(userData, 'auth.bin'), safeStorage),
    openExternal: (url) => shell.openExternal(url),
  })
  const storage = createSqliteStorage(openDatabase(join(userData, 'auto-yt.db')))
  const quota = createQuotaTracker({
    storage,
    now,
    onChange: (status) => send(IPC.quotaChanged, status),
  })
  // One client for the whole app, so every API call is counted in the quota meter.
  const youtube = createYouTubeClient({
    getAccessToken: auth.getAccessToken,
    onQuota: (units) => quota.record(units),
  })
  const schedulers = createSchedulerService({ storage, now })
  const channels = createChannelService({ storage, youtube, now })
  storage.markInterruptedRuns(now())
  const log = (message: string, error: unknown) => console.error(message, error)
  const runner = createRunner({
    storage,
    youtube,
    isShort: (id) => isShortVideo(id),
    quotaRemaining: quota.remaining,
    now,
    notify,
    onChange: () => send(IPC.runsChanged),
    log,
  })

  // --- Scheduled scans ---
  const loop = createSchedulerLoop({
    storage,
    runner,
    now,
    isSignedIn: async () => (await auth.status()).signedIn,
    notify,
    onChange: () => {
      refreshTray()
      send(IPC.appStateChanged, { paused: loop.isPaused() })
      send(IPC.runsChanged) // next-run times moved
    },
    log,
  })

  // --- Tray ---
  const canOpenAtLogin = app.isPackaged // the dev build would register electron.exe
  const tray = new Tray(nativeImage.createFromPath(trayIconPath))
  tray.on('click', showWindow)
  function refreshTray(): void {
    const paused = loop.isPaused()
    tray.setToolTip(trayTooltip(storage.listSchedulers(), paused))
    tray.setContextMenu(
      Menu.buildFromTemplate(
        trayMenu(
          {
            paused,
            openAtLogin: canOpenAtLogin && app.getLoginItemSettings().openAtLogin,
            canOpenAtLogin,
          },
          {
            open: showWindow,
            setPaused: (p) => loop.setPaused(p),
            setOpenAtLogin: (enabled) => {
              app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_ARG] })
              refreshTray()
            },
            quit: () => {
              quitting = true
              app.quit()
            },
          },
        ),
      ),
    )
  }

  registerIpc({
    ipcMain,
    auth,
    youtube,
    schedulers,
    channels,
    quota,
    runner,
    storage,
    loop,
    isDev: !app.isPackaged,
    now,
    getWindows: () => BrowserWindow.getAllWindows(),
    onSchedulersChanged: () => {
      loop.poke()
      refreshTray()
    },
  })

  // Sign-in releases scans that were waiting; waking from sleep catches up missed ones.
  auth.onStatusChange((s) => {
    if (s.signedIn) loop.poke()
  })
  powerMonitor.on('resume', () => loop.poke())
  powerMonitor.on('unlock-screen', () => loop.poke())

  // Start at login by default for the installed app (once; the tray menu can turn it off).
  if (canOpenAtLogin && !storage.getSetting(LOGIN_ITEM_KEY, false)) {
    app.setLoginItemSettings({ openAtLogin: true, args: [HIDDEN_ARG] })
    storage.setSetting(LOGIN_ITEM_KEY, true)
  }

  // Closing the window keeps the app running in the tray (explained once).
  onWindowClose = (e, win) => {
    if (quitting) return
    e.preventDefault()
    win.hide()
    if (!storage.getSetting(TRAY_HINT_KEY, false)) {
      storage.setSetting(TRAY_HINT_KEY, true)
      notify({
        title: 'auto-yt is still running',
        body: 'Scheduled scans keep running in the background. Use the tray icon to open or quit.',
      })
    }
  }

  app.on('second-instance', showWindow)
  app.on('activate', showWindow)
  app.on('before-quit', () => {
    quitting = true
    loop.stop()
  })
  // Keep running in the tray when every window is closed.
  app.on('window-all-closed', () => undefined)

  refreshTray()
  loop.start() // checks right away, so scans missed while the app was closed run now

  mainWindow = createWindow()
  if (!process.argv.includes(HIDDEN_ARG)) {
    mainWindow.once('ready-to-show', () => mainWindow?.show())
  }
}
