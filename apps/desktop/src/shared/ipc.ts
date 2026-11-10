/** IPC channel names, shared by main and preload. */
export const IPC = {
  authGetStatus: 'auth:getStatus',
  authSignIn: 'auth:signIn',
  authCancelSignIn: 'auth:cancelSignIn',
  authSignOut: 'auth:signOut',
  authStatusChanged: 'auth:statusChanged',
  youtubeListMyPlaylists: 'youtube:listMyPlaylists',
} as const
