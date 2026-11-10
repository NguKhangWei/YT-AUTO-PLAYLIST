// App entry: wires services together and manages the window, tray and app lifecycle.
import { join } from 'node:path'
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
// asarUnpack: the tray and Windows toasts need real files, not paths inside app.asar
import appIconPath from '../../resources/icon.png?asset&asarUnpack'
import trayIconPath from '../../resources/tray.png?asset&asarUnpack'
import { IPC } from '../shared/ipc'
import { createGoogleAuth } from './auth/google-auth'
import { createEncryptedFileStore } from './auth/token-store'
import { createChannelService } from './channels'
import { createYouTubeClient, isShortVideo } from './core/youtube/client'
import { openDatabase } from './db/database'
import { createSqliteStorage } from './db/sqlite-storage'
import { registerIpc } from './ipc'
import { migrateLegacyData } from './legacy-data'
import type { NotificationText } from './notifications'
import { createRunner } from './runner'
import { createSchedulerLoop } from './scheduler-loop'
import { createSchedulerService } from './schedulers'
import { trayMenu, trayTooltip } from './tray'

const HIDDEN_ARG = '--hidden' // passed by the login item: start in the tray
const TRAY_HINT_KEY = 'trayHintShown'
const LOGIN_ITEM_KEY = 'loginItemInitialized'

if (!app.requestSingleInstanceLock()) {
  app.quit() // a second launch only shows the first one's window
} else {
  app.setAppUserModelId('com.auto-yt.app') // the notification sender name
  void app.whenReady().then(main)
}

function main(): void {
  const userData = app.getPath('userData')
  if (!app.commandLine.hasSwitch('user-data-dir')) {
    migrateLegacyData(join(app.getPath('appData'), '@auto-yt', 'desktop'), userData)
  }
  const now = () => new Date()
  const send = (channel: string, value?: unknown) =>
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, value))
  const log = (message: string, error: unknown) => console.error(message, error)

  let mainWindow: BrowserWindow | null = null
  let quitting = false

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
    win.on('close', (e) => {
      if (quitting) return
      e.preventDefault() // keep running in the tray
      win.hide()
      if (!storage.getSetting(TRAY_HINT_KEY, false)) {
        storage.setSetting(TRAY_HINT_KEY, true)
        notify({
          title: 'auto-yt is still running',
          body: 'Scheduled scans keep running in the background. Use the tray icon to open or quit.',
        })
      }
    })
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
    else void win.loadFile(join(__dirname, '../renderer/index.html'))
    return win
  }

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

  const auth = createGoogleAuth({
    clientId: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID,
    clientSecret: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET,
    store: createEncryptedFileStore(join(userData, 'auth.bin'), safeStorage),
    openExternal: (url) => shell.openExternal(url),
  })
  const storage = createSqliteStorage(openDatabase(join(userData, 'auto-yt.db')))
  storage.markInterruptedRuns(now())
  const youtube = createYouTubeClient({ getAccessToken: auth.getAccessToken })
  const runner = createRunner({
    storage,
    youtube,
    isShort: isShortVideo,
    now,
    notify,
    onChange: () => send(IPC.runsChanged),
    log,
  })
  const loop = createSchedulerLoop({
    storage,
    runner,
    now,
    isSignedIn: async () => (await auth.status()).signedIn,
    notify,
    onChange: () => {
      refreshTray()
      send(IPC.scansPausedChanged, loop.isPaused())
      send(IPC.runsChanged) // next-run times moved
    },
    log,
  })
  const schedulers = createSchedulerService({
    storage,
    now,
    onChange: () => {
      loop.poke()
      refreshTray()
    },
  })
  const channels = createChannelService({ youtube, now })
  registerIpc({ ipcMain, auth, youtube, schedulers, channels, runner, storage, loop })

  const canOpenAtLogin = app.isPackaged // in dev it would register electron.exe
  const tray = new Tray(nativeImage.createFromPath(trayIconPath))
  tray.on('click', showWindow)
  function refreshTray(): void {
    const paused = loop.isPaused()
    tray.setToolTip(trayTooltip(storage.listSchedulers(), paused))
    const state = {
      paused,
      openAtLogin: canOpenAtLogin && app.getLoginItemSettings().openAtLogin,
      canOpenAtLogin,
    }
    const menu = trayMenu(state, {
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
    })
    tray.setContextMenu(Menu.buildFromTemplate(menu))
  }

  auth.onStatusChange((status) => {
    send(IPC.authStatusChanged, status)
    if (status.signedIn) loop.poke() // release scans that waited for sign-in
  })
  powerMonitor.on('resume', () => loop.poke())
  powerMonitor.on('unlock-screen', () => loop.poke())

  if (canOpenAtLogin && !storage.getSetting(LOGIN_ITEM_KEY, false)) {
    app.setLoginItemSettings({ openAtLogin: true, args: [HIDDEN_ARG] }) // on by default, once
    storage.setSetting(LOGIN_ITEM_KEY, true)
  }

  app.on('second-instance', showWindow)
  app.on('activate', showWindow)
  app.on('before-quit', () => {
    quitting = true
    loop.stop()
  })
  app.on('window-all-closed', () => undefined) // stay in the tray

  refreshTray()
  loop.start() // checks right away, so scans missed while closed run now
  mainWindow = createWindow()
  if (!process.argv.includes(HIDDEN_ARG)) mainWindow.once('ready-to-show', () => mainWindow?.show())
}
