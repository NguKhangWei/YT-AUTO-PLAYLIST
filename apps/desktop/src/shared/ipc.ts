// IPC channel names shared by main and preload.

export const IPC = {
  authGetStatus: 'auth:getStatus',
  authSignIn: 'auth:signIn',
  authCancelSignIn: 'auth:cancelSignIn',
  authSignOut: 'auth:signOut',
  authStatusChanged: 'auth:statusChanged',
  listMyPlaylists: 'youtube:listMyPlaylists',
  searchChannels: 'channels:search',
  schedulersList: 'schedulers:list',
  schedulersCreate: 'schedulers:create',
  schedulersUpdate: 'schedulers:update',
  schedulersSetActive: 'schedulers:setActive',
  schedulersRemove: 'schedulers:remove',
  schedulersRunNow: 'schedulers:runNow',
  runsList: 'runs:list',
  runsChanged: 'runs:changed',
  scansIsPaused: 'scans:isPaused',
  scansSetPaused: 'scans:setPaused',
  scansPausedChanged: 'scans:pausedChanged',
} as const
