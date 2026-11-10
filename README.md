# YT-AUTO-PLAYLIST

A Windows desktop app that automatically adds new uploads from YouTube channels you pick to a playlist you choose, on a schedule.

- **Schedulers:** each one scans a set of channels every N days (1–30) at a time you choose, in any time zone (Malaysia Time by default). It adds their new videos to **its own playlist**, so you could have a "Gaming" scheduler and a "Learning" one.
- **Regular videos only:** Shorts, livestreams, premieres and upcoming streams are skipped.
- **No duplicates:** a video is added once. Videos already in the playlist, including ones you added yourself, are left alone, and videos you remove aren't added back.
- **Runs in the background:** it lives in the system tray and starts when you log in. Scans missed while the PC was off or asleep run **once** when it's back.
- **Your account, your quota:** it uses your own Google Cloud project. Nothing goes through anyone else's server.

## How it works

1. You sign in with Google in your normal browser (the app never sees your password).
2. You create schedulers: name, target playlist, interval, time, time zone, and the channels to track (search by name, or paste a channel URL or `@handle`).
3. At each scheduled time the app:
   - lists each channel's uploads since its last scan
   - keeps regular videos only
   - skips anything already in the playlist
   - adds the rest, **oldest first**

   You get a Windows notification with what was added.

4. Channels you add count uploads **from the moment you add them**. Older videos aren't backfilled.

## Install

There's no shared download: every install uses its own Google Cloud OAuth client, so you build the installer yourself. It's a one-time, roughly 15-minute setup.

### 1. Requirements

- Windows 10 or 11
- [Node.js](https://nodejs.org/) 24 or newer, and Git
- A Google account with a **YouTube channel** (playlists belong to a channel)

### 2. Create the Google Cloud project

The Google account you use in the Cloud console only owns the project. The account you later sign in with in auto-yt (the one whose playlists get filled) can be the same or a different one.

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create a new project, e.g. `auto-yt`.
2. Go to **APIs & Services → Library**, search for **YouTube Data API v3** and click **Enable**.

### 3. Configure the OAuth consent screen

In **APIs & Services → OAuth consent screen** (shown as **Google Auth Platform** in newer consoles):

1. **Branding:** set an app name (e.g. `auto-yt`) and your email as support and developer contact.
2. **Audience:** choose **External**.
3. **Test users:** add the Google account you'll sign in with.
4. **Optional: publish the app** (Audience → Publishing status → **Publish app**, "In production").
   - While the app stays in **Testing**, Google ends your sign-in every **7 days** and the app asks you to sign in again. Scans wait until you do. Publishing removes that.
   - Publishing requires an **application home page** and **privacy policy** link on the Branding page. Your fork's GitHub URLs work, e.g. `https://github.com/<you>/YT-AUTO-PLAYLIST` and `.../blob/main/PRIVACY.md`.
   - Personal use needs no Google verification. At sign-in Google shows _"Google hasn't verified this app"_. Choose **Advanced → Go to auto-yt (unsafe)**. It's your own app.

### 4. Create the OAuth client

1. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID** (or **Google Auth Platform → Clients → Create client**).
2. For **Application type**, choose **Desktop app**. Name it anything.
3. Copy the **Client ID** and **Client secret**.

### 5. Build and install

```sh
git clone https://github.com/<you>/YT-AUTO-PLAYLIST.git auto-yt
cd auto-yt
cp .env.example .env     # paste the client ID and secret into .env
npm install
npm run build:win        # creates apps/desktop/release/<version>/auto-yt-setup-<version>.exe
```

Run `auto-yt-setup-<version>.exe`. It installs for your Windows user only, so no admin rights are needed, and opens the app.

- The installer isn't code-signed, so Windows SmartScreen may say _"Windows protected your PC"_. Click **More info → Run anyway**.
- Your client ID and secret are built into the installer, so **don't share the installer**. Anyone else should build their own.

### 6. First run

1. Click **Sign in with Google**. Approve in the browser, close the tab, and you're back in the app.
2. Click **New scheduler**, pick a playlist (create it on YouTube first), set the schedule, add channels, then **Create**.
3. Use **Run now** to try it straight away. Scheduled scans happen on their own from then on.

## Everyday use

- **Closing the window** keeps auto-yt running in the tray (look under the **^** arrow). **Quit** is in the tray menu.
- **Tray menu:** Open, **Pause scheduled scans**, **Start at login** (on by default), Quit. Hover the icon to see the next scan.
- **History** tab: every scan, with the videos added (linked), what was skipped and why, and any errors.
- **API meter** in the header: YouTube API units this app used today.

## YouTube API quota

Google gives each Cloud project **10,000 units per day**. The count resets at **midnight Pacific Time** (16:00 Malaysia Time in winter, 15:00 in summer).

| Action                          | Cost                                |
| ------------------------------- | ----------------------------------- |
| Search channels by name         | 101 (same search within 24 h: free) |
| Paste a channel URL / `@handle` | 1                                   |
| Scan a channel for new uploads  | about 1–3                           |
| **Add a video to a playlist**   | **50**                              |

Adding videos is the expensive part: about **190 videos per day** across all schedulers. If the quota runs out mid-scan, the scan stops and you're notified. The remaining videos are added on the next scan.

## Troubleshooting

| Problem                                      | What to do                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| "Set up Google access" screen                | `.env` was empty when you built. Fill it in and run `npm run build:win` again.                                                         |
| "Access blocked" when signing in             | Your account isn't a **Test user** on the consent screen (step 3), or the app isn't published.                                         |
| "This Google account has no YouTube channel" | Create a channel at youtube.com (or sign in with another account).                                                                     |
| Asked to sign in again every week            | The consent screen is still in **Testing**. Publish it (step 3.4).                                                                     |
| "YouTube daily quota used up"                | Wait for the reset (midnight Pacific Time). Fewer channels or longer intervals use less.                                               |
| A scheduler turned itself **Off**            | Its playlist was deleted on YouTube. Edit it, pick another playlist, and turn it back on.                                              |
| No notifications                             | Check Windows **Focus assist / Do not disturb** and Settings → System → Notifications → auto-yt.                                       |
| Scans didn't run at the scheduled time       | auto-yt only runs while you're logged in and the PC is awake. Missed scans run once when it's back. Check it's not paused (tray menu). |

## Your data

Everything is stored on your PC in `%APPDATA%\auto-yt`:

- your sign-in, encrypted with your Windows account
- a SQLite database of schedulers, channels and history

The app only talks to Google and YouTube. **Sign out** revokes its access at Google, and you can also remove access at [myaccount.google.com/permissions](https://myaccount.google.com/permissions). Uninstalling keeps `%APPDATA%\auto-yt`; delete that folder to remove everything. See [PRIVACY.md](PRIVACY.md).

## Development

| Command             | What it does                                            |
| ------------------- | ------------------------------------------------------- |
| `npm run dev`       | Run the app with hot reload (uses the same data folder) |
| `npm run check`     | Typecheck, lint, format check and tests                 |
| `npm test`          | Tests only (`npm run test:watch` to watch)              |
| `npm run build:win` | Build the Windows installer                             |

- `packages/core` is the scan engine: schedule maths, the YouTube API client, the video filter and the scan algorithm. It uses no Electron or Node APIs, so it can also run elsewhere (e.g. a Cloudflare Worker).
- `apps/desktop` is the Electron and React app: sign-in, SQLite storage, the scheduler loop, the tray and the UI.

In `npm run dev` there's a **Debug: look back 7 days** button on each scheduler. It treats the last week's uploads as new, so **Run now** has something to add.
