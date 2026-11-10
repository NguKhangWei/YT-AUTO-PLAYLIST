# YT-AUTO-PLAYLIST

- Automatically scans your favourite channels for uploads and adds new videos to a chosen playlist. Runs on a scheduler every day.

> Work in progress. Right now the app can sign in to your Google account and list your playlists.

## Setup

auto-yt talks to YouTube through **your own Google Cloud project**, so every install is personal and needs no Google review. This takes about 10 minutes, once.

### 1. Requirements

- Node.js 24 or newer
- A Google account with a YouTube channel (you need a channel to own playlists)

### 2. Create the Google Cloud project

The Google account you use in the Cloud console only owns the project. The account you later sign in with in auto-yt (the one whose playlists get filled) can be the same or a different one, but it must own a YouTube channel.

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create a new project, e.g. `auto-yt`.
2. Go to **APIs & Services → Library**, search for **YouTube Data API v3** and click **Enable**.

### 3. Configure the OAuth consent screen

In **APIs & Services → OAuth consent screen** (shown as **Google Auth Platform** in newer consoles):

1. **Branding / App information:** set an app name (e.g. `auto-yt`) and your email as support and developer contact. To publish to production (step 4) Google also requires an **application home page** and **privacy policy** link. Your fork's GitHub URLs work, e.g. `https://github.com/<you>/YT-AUTO-PLAYLIST` and `https://github.com/<you>/YT-AUTO-PLAYLIST/blob/main/PRIVACY.md` (push the repo first so the links load).
2. **Audience:** choose **External**.
3. **Data access / Scopes** (optional): add `.../auth/youtube`. The app asks for it at sign-in anyway.
4. **Optional: publish the app (Audience → Publishing status → Publish app, "In production").** You can skip this and stay in _Testing_ (add your account under **Audience → Test users**); the only cost is signing in again every 7 days.
   - Publishing needs the home page and privacy policy links from step 3.
   - You don't need verification for personal use. At sign-in, Google shows _"Google hasn't verified this app"_. Choose **Advanced → Go to auto-yt (unsafe)**. It's your own app.

### 4. Create the OAuth client

1. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID** (or **Google Auth Platform → Clients → Create client**).
2. For **Application type**, choose **Desktop app**. Name it anything.
3. Copy the **Client ID** and **Client secret**.

### 5. Configure and run

```sh
git clone <this repo> && cd auto-yt
cp .env.example .env    # then paste the client ID and secret into .env
npm install
npm run dev             # the first run downloads Electron (~100 MB)
```

Click **Sign in with Google**. Your browser opens Google's sign-in page. After you approve, the browser tab says you can close it, and the app shows your playlists.

Your sign-in is stored only on your computer, encrypted with your OS account (Windows DPAPI). It is only ever sent to Google. **Sign out** revokes the app's access at Google. You can also remove access any time at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Development

| Command         | What it does                               |
| --------------- | ------------------------------------------ |
| `npm run dev`   | Run the app with hot reload                |
| `npm run check` | Typecheck, lint, format check and tests    |
| `npm test`      | Tests only (`npm run test:watch` to watch) |

`packages/core` holds the scan engine. It doesn't depend on Electron or Node, so it can also run elsewhere (e.g. a Cloudflare Worker). `apps/desktop` is the Electron and React app.
