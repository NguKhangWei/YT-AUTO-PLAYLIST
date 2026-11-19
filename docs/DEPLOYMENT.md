# Deploying auto-yt

auto-yt can be deployed in two ways:

- **Desktop:** the Windows tray app. Scans run only while your PC is on.
- **Cloud:** a small always-free Google Cloud VM. Scans run around the clock, and you manage it from a private web page that only your devices can open.

The recommended setup uses both: the cloud runs the scans, and the desktop app stays installed with scans **paused** as a fallback.

> **Status:** everything in this runbook is built. Reachability (2.8) passed on the real VM on 2026-11-19; the server itself (2.9 onwards) is tested locally and waits for its first deploy.
>
> **Scans run every hour**, at the minute each scheduler sets (H1). Missed hours (VM down, laptop asleep) are caught up with **one** scan.

**Contents**

- [Part 1: Desktop install](#part-1-desktop-install)
- [Part 2: Cloud deployment](#part-2-cloud-deployment)
  - [2.1 Before you start](#21-before-you-start)
  - [2.2 Google Cloud: billing guard and APIs](#22-google-cloud-billing-guard-and-apis)
  - [2.3 Publish the OAuth consent screen](#23-publish-the-oauth-consent-screen)
  - [2.4 Tailscale and ntfy](#24-tailscale-and-ntfy)
  - [2.5 Network and VM](#25-network-and-vm)
  - [2.6 Set up the VM](#26-set-up-the-vm)
  - [2.7 Remove the IPv4 address](#27-remove-the-ipv4-address-go-ipv6-only)
  - [2.8 Check reachability (C0)](#28-check-reachability-c0)
  - [2.9 Configure, deploy and start](#29-configure-deploy-and-start)
  - [2.10 Move your data from the desktop](#210-move-your-data-from-the-desktop)
  - [2.11 Sign in](#211-sign-in)
  - [2.12 Verify](#212-verify)
- [Part 3: Operating it](#part-3-operating-it)
- [Cost](#cost)

---

## Part 1: Desktop install

Follow **Install** in the [README](../README.md):

1. Create the Google Cloud project.
2. Set up the consent screen.
3. Create the Desktop OAuth client.
4. Fill in `.env`, then run `npm run build:win`.
5. Run `apps/desktop/release/<version>/auto-yt-setup-<version>.exe`.

Notes:

- **If every test fails with "Vitest failed to find the runner"**, the terminal's folder has a lowercase drive letter (`c:\…`, as VS Code opens it). Vitest then loads itself twice under two path spellings. Run `cd C:\Users\<you>\auto-yt` (uppercase `C:`) and try again.
- **Build from a normal PowerShell or Windows Terminal window.** electron-builder runs `powershell.exe`, and some shells started from editors don't have it on `PATH`. If `npm run dev` crashes with "`app` is undefined", the shell has `ELECTRON_RUN_AS_NODE` set; the dev script already clears it.

**Upgrading the desktop app:**

1. Raise `version` in `apps/desktop/package.json`.
2. Run `npm run build:win`.
3. Run the new installer over the old one. Settings and data in `%APPDATA%\auto-yt` are kept.

---

## Part 2: Cloud deployment

### How it fits together

```
Laptop / phone ──(Tailscale, private)──▶ https://auto-yt.<tailnet>.ts.net
                                              │  tailscale serve
                                              ▼
                       e2-micro VM (IPv6-only, Debian, systemd)
                        node /opt/auto-yt/app/server.mjs  (127.0.0.1:8080)
                        /var/lib/auto-yt/{auto-yt.db, auth.json, backups/}
                                              │  IPv6
                                              ▼
                     Google OAuth + YouTube Data API     ntfy.sh ──▶ phone
```

- **Same scan engine as the desktop app:** same rules, same quota, same database format.
- **Private:** nothing listens on the public internet. The web page is reachable only from devices signed in to your Tailscale account, and the server also checks that you are the one signed in.
- **Free:** the VM runs IPv6-only, and Google doesn't charge for IPv6 addresses. It has an IPv4 address only during setup, for under an hour.

### 2.1 Before you start

- [ ] The desktop app works with your Google Cloud project (Part 1).
- [ ] The [gcloud CLI](https://cloud.google.com/sdk/docs/install) is installed on the laptop. Run `gcloud auth login`.
- [ ] A [Tailscale](https://tailscale.com) account, with the app on your laptop and phone.
- [ ] The [ntfy](https://ntfy.sh) app on your phone.
- [ ] A billing account linked to the project. It's needed for Compute Engine even when everything stays in the free tier.

Set these once in the PowerShell window you'll use:

```powershell
$PROJECT = "<your-project-id>"   # e.g. auto-yt-123456
$REGION  = "us-central1"         # must be us-west1, us-central1 or us-east1 for the free tier
$ZONE    = "us-central1-a"
gcloud config set project $PROJECT
```

### 2.2 Google Cloud: billing guard and APIs

```powershell
gcloud services enable compute.googleapis.com billingbudgets.googleapis.com
gcloud billing projects describe $PROJECT --format="value(billingAccountName)"   # prints billingAccounts/XXXX
gcloud billing accounts describe <XXXX> --format="value(currencyCode)"             # e.g. MYR
gcloud billing budgets create --billing-account=<XXXX> --display-name="auto-yt guard" `
  --budget-amount=5MYR --filter-projects="projects/$PROJECT" `
  --threshold-rule=percent=0.5 --threshold-rule=percent=1.0
```

Use the billing account's own currency in `--budget-amount` (`1USD` fails on a ringgit account with `INVALID_ARGUMENT`). You'll get an email if the project ever costs more than half of that. It should cost nothing. If the email arrives, check [Cost](#cost). The console works too: **Billing → Budgets & alerts → Create budget**.

> **Billing notes:**
>
> - A new billing account puts a **temporary authorization hold** on your card (RM120 in Malaysia), released within about a week. It isn't a charge.
> - `gcloud billing …` can fail with **429 "Quota exceeded … consumer project_number:32555940559"**. That's gcloud's own shared project, not yours: wait a minute, or run `gcloud config set billing/quota_project $PROJECT`.
> - A billing account that's **closed** (`OPEN: False` in `gcloud billing accounts list`) can't be used. If it can't be reopened ("not in good standing"), create a new one.

### 2.3 Publish the OAuth consent screen

**Required for the cloud.** While the consent screen is in **Testing**, Google ends the sign-in after 7 days and cloud scans stop until you sign in again.

1. In the Cloud console, open **Google Auth Platform → Branding**:
   - **Application home page:** `https://github.com/NguKhangWei/YT-AUTO-PLAYLIST`
   - **Privacy policy:** `https://github.com/NguKhangWei/YT-AUTO-PLAYLIST/blob/main/PRIVACY.md`

   These links must open without signing in, so the repo must be public. If it isn't, host `PRIVACY.md` somewhere public, such as a public gist.

2. Under **Audience → Publish app**, confirm the change to **In production**. Don't submit the app for verification; personal use doesn't need it.
3. After publishing, **sign in to the desktop app again** once. Sign-ins made while the app was in Testing still expire after 7 days.

The cloud uses the **same Desktop OAuth client** as the desktop app. If you put the VM in a **new** project and created a new client there, put the new ID and secret in the repo `.env`, rebuild the desktop app (`npm run build:win`), install it and sign in again: the old sign-in belongs to the old client.

> **Important:** **Sign out** in either the desktop app or the web UI revokes Google access for **both**, because they share one client. To stop one copy, pause or stop it; don't sign out.

### 2.4 Tailscale and ntfy

1. In the Tailscale admin console, under **DNS**:
   - turn on **MagicDNS**
   - turn on **HTTPS Certificates**

   Note your tailnet name (`<tailnet>.ts.net`).

2. Choose a long random ntfy topic. Anyone who knows the name can read the notifications, so treat it like a password:

   ```powershell
   "auto-yt-" + -join ((48..57) + (97..122) | Get-Random -Count 24 | ForEach-Object {[char]$_})
   ```

   In the ntfy app, tap **Subscribe** and enter that topic.

### 2.5 Network and VM

Create a network that has IPv6, and a temporary firewall rule so you can SSH in during setup:

```powershell
gcloud compute networks create auto-yt-net --subnet-mode=custom
gcloud compute networks subnets create auto-yt-subnet --network=auto-yt-net --region=$REGION `
  --range=10.10.0.0/24 --stack-type=IPV4_IPV6 --ipv6-access-type=EXTERNAL
$MYIP = (Invoke-RestMethod https://api.ipify.org)
gcloud compute firewall-rules create auto-yt-setup-ssh --network=auto-yt-net `
  --allow=tcp:22 --source-ranges="$MYIP/32"
```

Create the VM. It must be an **e2-micro** with a **pd-standard** disk (the default "balanced" disk is charged):

```powershell
gcloud compute instances create auto-yt --zone=$ZONE --machine-type=e2-micro `
  --subnet=auto-yt-subnet --stack-type=IPV4_IPV6 --ipv6-network-tier=PREMIUM `
  --image-family=debian-13 --image-project=debian-cloud `
  --boot-disk-size=30GB --boot-disk-type=pd-standard
```

The VM has an IPv4 address now, which is free for the first hour each month. **Do steps 2.6–2.7 in one sitting.**

### 2.6 Set up the VM

```powershell
gcloud compute ssh auto-yt --zone=$ZONE
```

Run the following on the VM.

**Updates and swap.** Automatic security updates stay on. The swap gives the 1 GB VM headroom during upgrades.

```sh
sudo apt-get update && sudo apt-get -y full-upgrade
sudo apt-get -y install unattended-upgrades curl xz-utils sqlite3
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Node.js 24.** Install the latest 24.x from nodejs.org and check its checksum:

```sh
BASE=https://nodejs.org/dist/latest-v24.x
TAR=$(curl -fsSL $BASE/SHASUMS256.txt | grep -o 'node-v24[^ ]*-linux-x64.tar.xz')
curl -fsSLO "$BASE/$TAR"
curl -fsSL $BASE/SHASUMS256.txt | grep " $TAR\$" | sha256sum -c -
sudo tar -xJf "$TAR" -C /usr/local --strip-components=1 --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md
rm "$TAR" && node -v    # v24.x
```

**Tailscale.** `--ssh` lets you SSH in over Tailscale once the IPv4 address is gone.

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh --hostname=auto-yt
```

Open the URL it prints and approve the machine. In the Tailscale admin console, open the machine's menu and choose **Disable key expiry**, so the VM never drops off your tailnet.

**Service user and folders:**

```sh
sudo useradd --system --home-dir /var/lib/auto-yt --create-home --shell /usr/sbin/nologin autoyt
sudo chmod 700 /var/lib/auto-yt
sudo mkdir -p /opt/auto-yt /etc/auto-yt
sudo chown "$USER" /opt/auto-yt
ls -ld /opt/auto-yt    # the owner must be your VM user, not root
```

Run these as your normal VM user, not in a root shell (`sudo -i`): the deploy copies the app into `/opt/auto-yt` as that user. If the owner shows `root`, run `sudo chown <your-vm-username> /opt/auto-yt`.

Exit the VM. **Install Tailscale on the laptop too** (`winget install Tailscale.Tailscale`) and sign in with the same account. Then check that SSH over Tailscale works:

```powershell
tailscale status                              # lists your laptop and auto-yt
ssh <your-vm-username>@auto-yt "hostname"     # prints auto-yt
```

Your VM username is the folder name in `/home` on the VM (`ls /home`), e.g. `User`; it's case-sensitive. Every later `ssh`/`scp` to `auto-yt` goes over Tailscale. "Could not resolve hostname auto-yt" means Tailscale isn't running or signed in on the laptop.

### 2.7 Remove the IPv4 address (go IPv6-only)

```powershell
gcloud compute instances delete-access-config auto-yt --zone=$ZONE --access-config-name="external-nat"
gcloud compute firewall-rules delete auto-yt-setup-ssh --quiet
ssh <your-vm-username>@auto-yt "curl -6 -sI https://www.googleapis.com | head -1"   # still reachable
```

The VM now has no public IPv4 address and no open ports. It reaches Google, YouTube and ntfy over IPv6 and your devices over Tailscale.

> **If you need IPv4 again** (e.g. to install something from an IPv4-only host, such as GitHub), add it back for a few minutes, then remove it again with the command above:
> `gcloud compute instances add-access-config auto-yt --zone=$ZONE --access-config-name="external-nat"`

### 2.8 Check reachability (C0)

On the laptop, copy the probe script and run it on the VM:

```powershell
scp apps/desktop/scripts/cloud-probe.mjs <your-vm-username>@auto-yt:/tmp/
ssh <your-vm-username>@auto-yt "node /tmp/cloud-probe.mjs <your-ntfy-topic>"
```

It needs no secrets and uses no quota. It checks:

- Node 24 and its built-in SQLite
- which hosts have IPv6 addresses
- Google sign-in and the YouTube API (it expects their "not signed in" errors)
- the Shorts check, on two Shorts and two regular videos from your own history
- ntfy, with one test push to your phone

The last lines give the `SHORTS_PROBE` value to use and whether anything blocks deploying.

> All of these hosts already have IPv6 addresses (checked 2026-11-19), including ntfy.sh, Debian, nodejs.org and Tailscale; only GitHub doesn't. The probe on the VM checks that the connections themselves work. On a laptop without IPv6, add `--any-family`.

| Probe result              | Do this                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| All OK                    | Use `SHORTS_PROBE=on` in 2.9.                                                                              |
| Shorts check unreliable   | Use `SHORTS_PROBE=off`. Every video of 3 minutes or less is then treated as a Short and skipped.           |
| ntfy unreachable          | Stop and decide on another notifier (e.g. email) before going further.                                     |
| Google or YouTube failing | Stop. Check the VM has an external IPv6 address: `gcloud compute instances describe auto-yt --zone=$ZONE`. |

### 2.9 Configure, deploy and start

**1. Install the service (once, from the laptop, in the repo folder).** The unit is [apps/desktop/deploy/auto-yt.service](../apps/desktop/deploy/auto-yt.service): it runs `node /opt/auto-yt/app/server.mjs` as `autoyt`, restarts on failure, and can only write to `/var/lib/auto-yt`.

```powershell
scp apps/desktop/deploy/auto-yt.service <your-vm-username>@auto-yt:/tmp/
ssh <your-vm-username>@auto-yt "sudo install -m 644 /tmp/auto-yt.service /etc/systemd/system/ && rm /tmp/auto-yt.service && sudo systemctl daemon-reload && sudo systemctl enable auto-yt"
```

**2. Write the settings (once, on the VM).** Open a session with `ssh <your-vm-username>@auto-yt` (or the browser SSH button) and paste this, filling in your values. The template with explanations is [apps/desktop/deploy/auto-yt.env.example](../apps/desktop/deploy/auto-yt.env.example).

```sh
sudo tee /etc/auto-yt/auto-yt.env >/dev/null <<'EOF'
GOOGLE_CLIENT_ID=<client id from the repo .env, without MAIN_VITE_>
GOOGLE_CLIENT_SECRET=<client secret>
AUTO_YT_DATA_DIR=/var/lib/auto-yt
AUTO_YT_PORT=8080
AUTO_YT_ALLOWED_LOGIN=<your Tailscale login: admin console -> the machine -> Creator>
NTFY_TOPIC=<your random ntfy topic, 16+ characters>
SHORTS_PROBE=on
EOF
sudo chown root:autoyt /etc/auto-yt/auto-yt.env && sudo chmod 640 /etc/auto-yt/auto-yt.env
```

The server refuses to start, and says why in its log, if a value is missing or the ntfy topic is short enough to guess (the probe's `auto-yt` would be refused).

**3. Build and deploy (on the laptop).** Use the same commit as your desktop build.

```powershell
npm ci
npm run check
npm run deploy:cloud -- <your-vm-username>@auto-yt
```

`deploy:cloud`:

1. Runs `npm run build:server`, which writes `apps/desktop/out-server/`: `server.mjs` (one file, only Node built-ins) and `web/` (the UI).
2. Copies it to `/opt/auto-yt/app.new` on the VM over Tailscale SSH.
3. Keeps the running version as `/opt/auto-yt/app.prev`, moves the new one to `/opt/auto-yt/app`, restarts the service, and prints its status and last log lines.

The first start creates an empty database and waits for sign-in. That's expected: 2.10 and 2.11 bring in your data and sign-in.

To do it by hand:

```powershell
npm run build:server
ssh <your-vm-username>@auto-yt "rm -rf /opt/auto-yt/app.new"
scp -r apps/desktop/out-server <your-vm-username>@auto-yt:/opt/auto-yt/app.new
ssh <your-vm-username>@auto-yt "cd /opt/auto-yt && rm -rf app.prev && { [ ! -d app ] || mv app app.prev; } && mv app.new app && sudo systemctl restart auto-yt"
```

**4. Publish the web UI to your tailnet only (on the VM, once):**

```sh
sudo tailscale serve --bg 8080
tailscale serve status    # shows https://auto-yt.<tailnet>.ts.net
```

Use `serve`, never `funnel`: funnel would put the web UI on the public internet. `serve` also tells the server who you are (the `Tailscale-User-Login` header), which it checks against `AUTO_YT_ALLOWED_LOGIN`.

### 2.10 Move your data from the desktop

The database holds your schedulers, history and the record of videos already added, which stops them being added again. Your sign-in isn't copied (it's encrypted for your Windows account), so you sign in again in 2.11.

1. In the desktop tray menu, tick **Pause scheduled scans**, then click **Quit**. Quitting writes all pending changes into `auto-yt.db`.
2. Copy the database and install it for the service:

   ```powershell
   scp "$env:APPDATA\auto-yt\auto-yt.db" <your-vm-username>@auto-yt:/tmp/auto-yt.db
   ssh <your-vm-username>@auto-yt "sudo systemctl stop auto-yt; sudo install -o autoyt -g autoyt -m 600 /tmp/auto-yt.db /var/lib/auto-yt/auto-yt.db; rm /tmp/auto-yt.db; sudo rm -f /var/lib/auto-yt/auto-yt.db-wal /var/lib/auto-yt/auto-yt.db-shm"
   ```

3. You can start the desktop app again. It stays **paused**, so it never scans on a schedule. **Don't use Run now on the desktop** while the cloud is active: the two databases are now separate, and the desktop could re-add videos the cloud added that you later removed by hand.

### 2.11 Sign in

The server has no browser, so you sign in on the laptop. In the repo folder:

```powershell
npm run cloud:signin -- --out "$env:TEMP\auto-yt-auth.json"
```

It uses the Google client from the repo `.env` (the same one as the server's settings) and opens your browser. Approve in the browser. On the "Google hasn't verified this app" screen, choose **Advanced → Go to auto-yt**. Then install the token file on the VM and delete the local copy:

```powershell
scp "$env:TEMP\auto-yt-auth.json" <your-vm-username>@auto-yt:/tmp/auth.json
ssh <your-vm-username>@auto-yt "sudo install -o autoyt -g autoyt -m 600 /tmp/auth.json /var/lib/auto-yt/auth.json; rm /tmp/auth.json; sudo systemctl start auto-yt"
Remove-Item "$env:TEMP\auto-yt-auth.json"
```

The file holds a Google refresh token. Never commit or share it.

### 2.12 Verify

- [ ] `ssh <your-vm-username>@auto-yt "systemctl is-active auto-yt"` prints `active`.
- [ ] `https://auto-yt.<tailnet>.ts.net` opens on the laptop and phone, signed in as you, with your schedulers.
- [ ] The header says scans are **paused**, because the flag came over with the desktop database. Click **Resume**.
- [ ] **Run now** on a scheduler finishes, History shows the run, and an ntfy push arrives.
- [ ] With Tailscale turned off on your phone, the URL doesn't load.
- [ ] Reboot the VM (`ssh … "sudo reboot"`). After about a minute the web UI is back. If an hour's slot passed while the VM was down, History shows exactly one catch-up scan.
- [ ] **The real test:** set a scheduler's minute 5 minutes ahead, shut the laptop and wait. The scan runs and the push arrives.
- [ ] The next day, `/var/lib/auto-yt/backups/` holds a dated backup.

---

## Part 3: Operating it

| Task                   | How                                                                                                                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| See logs               | `ssh <user>@auto-yt "journalctl -u auto-yt -n 200 --no-pager"` (`-f` to follow)                                                                                                                                                                 |
| Deploy a new version   | Laptop: `git pull`, `npm ci`, `npm run check`, `npm run deploy:cloud -- <user>@auto-yt`                                                                                                                                                         |
| Roll back the app      | `node apps/desktop/scripts/deploy-cloud.mjs <user>@auto-yt --rollback` (switches back to `/opt/auto-yt/app.prev` and restarts; the version you left stays in `app.bad`)                                                                         |
| Try the server locally | `npm run serve:local`, then open `http://127.0.0.1:8080`. It uses its own data folder (`apps/desktop/.local-server`), never your desktop data, and lets anyone on this PC in. Stop it with Ctrl+C.                                              |
| Restore the database   | Stop the service. Copy a file from `/var/lib/auto-yt/backups/` over `auto-yt.db` (`sudo install -o autoyt -g autoyt -m 600 …`), delete the `-wal`/`-shm` files, start the service.                                                              |
| Keep an off-VM copy    | `scp <user>@auto-yt:/var/lib/auto-yt/backups/<latest>.db .` now and then. The backups folder is readable only by `autoyt`; copy the file somewhere you can read it first, or run the scp with sudo on the VM side.                              |
| "Sign in again" push   | Repeat 2.11. This happens if you revoked access, signed out, or the consent screen went back to Testing.                                                                                                                                        |
| "Quota used up" push   | Nothing to do: the remaining videos are added on the next scan. The quota resets at midnight Pacific Time. It's shared with the desktop app (same project).                                                                                     |
| Update Node.js         | Repeat the Node step in 2.6 (it needs IPv6 only), then `sudo systemctl restart auto-yt`.                                                                                                                                                        |
| OS updates             | Security updates install automatically. Now and then: `sudo apt-get update && sudo apt-get -y full-upgrade && sudo reboot`.                                                                                                                     |
| Fall back to desktop   | Stop the cloud: `ssh <user>@auto-yt "sudo systemctl disable --now auto-yt"`. To keep the latest cursors, copy `/var/lib/auto-yt/auto-yt.db` back to `%APPDATA%\auto-yt\` with the desktop app quit. Start the desktop app and untick **Pause**. |
| Back to the cloud      | The reverse: pause and quit the desktop, copy the database up (2.10), then `sudo systemctl enable --now auto-yt` and click **Resume** in the web UI.                                                                                            |
| Tear it all down       | `gcloud compute instances delete auto-yt --zone=$ZONE`, then delete `auto-yt-subnet` and `auto-yt-net`. Remove the machine from Tailscale.                                                                                                      |

**Rule of thumb:** only one copy, cloud or desktop, should ever be unpaused.

---

## Cost

| Item                          | Free allowance                                   | auto-yt use                  |
| ----------------------------- | ------------------------------------------------ | ---------------------------- |
| e2-micro VM                   | 1 per month in us-west1 / us-central1 / us-east1 | 1                            |
| Standard persistent disk      | 30 GB-month                                      | 30 GB `pd-standard`          |
| External IPv6 address         | Not charged                                      | 1                            |
| External IPv4 address         | ~1 hour per month, then ~$0.005/hour             | Setup only, under 1 hour     |
| Egress                        | 1 GB/month from North America                    | A few MB of API calls        |
| Tailscale (Personal), ntfy.sh | Free                                             | Free                         |
| YouTube Data API              | 10,000 units/day                                 | ≈ channels × 24 + 50 per add |

**If the budget alert fires**, check in the Billing report, in this order:

1. Is the VM in a free region?
2. Is the disk `pd-standard`?
3. Was an IPv4 address left attached? (`gcloud compute instances describe auto-yt --zone=$ZONE --format="value(networkInterfaces[0].accessConfigs)"` should print nothing.)
4. Are there disk snapshots?

Google can change the free tier at any time; the budget alert is what tells you.
