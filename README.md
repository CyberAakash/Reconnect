```
 ██████╗ ███████╗ ██████╗ ██████╗ ███╗   ██╗███╗   ██╗███████╗ ██████╗████████╗
 ██╔══██╗██╔════╝██╔════╝██╔═══██╗████╗  ██║████╗  ██║██╔════╝██╔════╝╚══██╔══╝
 ██████╔╝█████╗  ██║     ██║   ██║██╔██╗ ██║██╔██╗ ██║█████╗  ██║        ██║
 ██╔══██╗██╔══╝  ██║     ██║   ██║██║╚██╗██║██║╚██╗██║██╔══╝  ██║        ██║
 ██║  ██║███████╗╚██████╗╚██████╔╝██║ ╚████║██║ ╚████║███████╗╚██████╗   ██║
 ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═══╝╚══════╝ ╚═════╝  ╚═╝

 Browser-based SSH Remote Server Manager
 Developed by Aakash — MTS @ ZohoIM
```

A lightweight, self-hosted web app to manage remote servers over SSH — all from your browser. No native SSH client needed. Designed for developers who want to replace repetitive terminal workflows with single-click operations.

---

## Features

- Browser-based SSH manager — no native SSH client needed
- **OTP / zero-trust auth (default)** — passcode-per-login via the org's ZAC zero-trust gateway. Legacy password/key auth is still available as a fallback but is being phased out. See [Authentication](#authentication).
- Multiple saved servers with credentials encrypted at rest (AES-256)
- Interactive terminal — a live xterm PTY in legacy mode; a command console in OTP mode (the zero-trust gateway allows one interactive shell per login)
- Reusable saved commands + ad-hoc commands with live streaming output
- Remote file browser + editor (Monaco) with save-back — over SFTP in legacy mode, or tunnelled through the single shell (base64) in OTP mode
- File uploads to any remote path
- Bookmarked files for fast access to frequently edited remote files
- Server overview with live system stats and connection status pill
- Dark / light theme with self-hosted fonts
- Built-in Help Guide with downloadable PDF documentation
- Zero build tooling — native ES modules and CSS `@import`, runs directly in the browser
- Binds to `127.0.0.1` only — not accessible from the network

---

## Prerequisites

- **macOS** (tested on macOS 13+)
- **Node.js** v16 or later
- **npm** (comes with Node.js)

### Install Node.js (if not already installed)

**Option A — Homebrew (recommended):**

```bash
brew install node
```

**Option B — Official installer:**

Download from [https://nodejs.org](https://nodejs.org) (LTS version recommended) and follow the installer.

**Verify installation:**

```bash
node -v
npm -v
```

Both commands should print a version number.

---

## Installation

1. **Clone or copy the project** to any directory on your Mac:

   ```bash
   cd ~/Applications  # or wherever you prefer
   git clone https://github.com/CyberAakash/Reconnect.git
   cd Reconnect
   ```

   If you received the project as a zip file, unzip it and `cd` into the folder.

2. **Install dependencies:**

   ```bash
   npm install
   ```

   This installs Express, ssh2, better-sqlite3 (bundles its own SQLite — no separate install needed), and multer.

3. **Start the server:**

   ```bash
   npm start
   ```

   **For development (auto-restart on file changes):**

   ```bash
   npm run dev
   ```

   > `npm run dev` uses nodemon and watches `server.js` and `db.js`. Any save to those files restarts the server automatically. Auth is disabled in dev mode.

   After starting, you will see the Reconnect ASCII banner followed by:

   ```
   ────────────────────────────────────────────────────────────────────────────────
   ────────────────────────────────────────────────────────────────────────────────
     ➜  Local:   http://localhost:9898

     PID 12345  │  Node v20.x.x  │  14:30:00  │  auth disabled (dev mode)
     Mode: development (nodemon)  │  Help: http://localhost:9898/docs
     ~ "May your sockets never close."
   ────────────────────────────────────────────────────────────────────────────────
   ```

   Open the URL shown in the `➜  Local:` line. The Help Guide is accessible at `/docs`.

4. **Open your browser** and go to:

   ```
   http://127.0.0.1:9898
   ```

That's it. The tool is ready to use.

---

## Auto-Start with PM2

PM2 keeps Reconnect running in the background and restarts it automatically after crashes or reboots. It was set up during initial configuration — the commands below are for day-to-day use.

### Common PM2 commands

| Command | What it does |
|---|---|
| `pm2 status` | See if Reconnect is running |
| `pm2 logs reconnect` | Tail live logs |
| `pm2 restart reconnect` | Restart the server |
| `pm2 stop reconnect` | Stop the server |
| `pm2 start npm --name reconnect -- start` | Start it again if stopped |

> **First-time setup** (if PM2 is not yet configured):
> ```bash
> npm install -g pm2
> pm2 start npm --name reconnect -- start
> pm2 save
> pm2 startup   # run the printed sudo command to enable auto-start on login
> ```

---

## Usage

### Adding a Server

1. Click the **+** button in the sidebar.
2. Fill in the server label, IP/hostname, port, and username.
   - In **OTP mode** (the default) no stored credential is needed — you authenticate with a one-time passcode at connect time.
   - In **legacy mode** also provide a password or a path to an SSH private key.
3. Click **Save**.

The server appears in the sidebar. Click it to open its dashboard, then **Connect**.

---

## Connection profiles (four independent axes)

Every server is configured along **four independent axes**, settable when you create or edit it, and changeable on the fly from the overview toolbar:

| Axis | Options | What it controls |
|------|---------|------------------|
| **Transport** | `Internal` / `External` | `Internal` tunnels through the zero-trust proxy (single shell channel). `External` connects directly over SSH. |
| **Auth flow** | `OTP` / `Password` | `OTP` prompts for a one-time passcode (internal hosts only). `External` always uses the stored key/password. |
| **Explorer** | `SFTP` / `One-channel` | `SFTP` uses the SFTP subsystem (fast, binary-safe). `One-channel` moves files as base64 over a shell — works anywhere a shell does. |
| **Terminal** | `Live PTY` / `Command panel` | `Live PTY` is a full interactive terminal (vim/htop/less). `Command panel` runs one command at a time and prints output. |

### Global defaults + scope

In **Settings (⚙)** each axis has a tool-wide **default**, plus a **Configuration scope** switch:
- **Global** — the four defaults apply to every server.
- **Per-server** — each server uses its own stored axis values (set them in the Add/Edit dialog or the inline overview toggles).

### The internal-transport constraint (allow + warn)

The zero-trust gateway grants exactly **one** SSH channel per login, so a live PTY and the SFTP subsystem are physically impossible there. You can still *pick* `SFTP`/`Live PTY` on an internal server — REConnect **downgrades** them to `One-channel`/`Command panel` at connect time and shows a notice (the inline toggles turn amber to flag it). Switch the server to **External** to use SFTP/PTY for real.

### OTP / Zero-Trust (default for internal hosts)

The organization's SSH access goes through a **ZAC certificate-based, password-less zero-trust** path. You never type a server password — a **one-time passcode (OTP)** sent to your Zoho email authorizes the session:

1. You click **Connect**; REConnect initiates the SSH session through the local zero-trust agent (0Agent → ServiceEdge → AppConnector).
2. The AppConnector enforces department/access policy, then prompts for an **OTP** (REConnect shows a passcode modal).
3. Enter the OTP from your email. On success the AppConnector obtains a short-lived ZAC-signed certificate and connects you to the target server.

Because the zero-trust gateway grants **one interactive shell per login and blocks SFTP/SCP/exec/port-forwarding** at the network layer, REConnect's OTP mode:
- presents the Terminal as a **command console** (run a command, see output) rather than a live PTY — use a real `ssh` session for full-screen tools like `vim`/`htop`;
- powers the **file browser, editor, uploads and system info over that single shell** (file contents move as base64). It works transparently; large/binary transfers are slower than SFTP.

**Prerequisites for OTP access**
- You must have **Localzoho DC policy / ZService access**. If you don't, raise a request in the PAM support channel (or have your team DRI email `pam-support@zohocorp.com`, CC your manager) with your **email, ZService name(s), and department**. Wait for approval.
- In **0Agent**, set the default network to the appropriate zero-host (e.g. *CT1 Localzoho Network*) and **reload policies**; revert to *none* when done.
- Verify with a plain terminal first: `ssh sas@<server-ip>` should prompt for an OTP.

### Direct (password / key) — External transport

For non-zero-trust hosts, set the server's **Transport = External** and store a password or private key. External hosts connect over plain SSH and can use any combination of **SFTP/One-channel** explorer and **Live PTY/Command panel** terminal.

### Testing every flow locally

You don't need the corporate gateway to exercise the non-OTP flows. A self-contained Docker harness (`test/`) stands up a direct SSH host and a keyboard-interactive (OTP-style) host behind a local CONNECT proxy. See **[`test/seed-servers.md`](test/seed-servers.md)** for the full matrix and run recipe (`docker compose up` + `node test/proxy.js` + `RECONNECT_SSH_PROXY=127.0.0.1:3128 npm start`).

### Running Commands

**Saved commands** are global — define them once and run them on any server.

1. Select a server from the sidebar.
2. Click **+ Add Command** to create a reusable command (e.g., "Check Disk" → `df -h`).
3. Click the command button to execute it. Output streams to the terminal panel in real time.

You can also type any command in the **Run Ad-hoc Command** input and press Enter.

### File Upload

1. Select a server.
2. In the **Upload File** section, choose a local file and enter the remote destination path (e.g., `/tmp/config.yaml`).
3. Click **Upload**. The file is transferred via SFTP.

### Edit Remote File

1. Select a server.
2. In the **Edit Remote File** section, enter the full remote file path (e.g., `/etc/nginx/nginx.conf`).
3. Click **Open** to fetch the file content into the editor.
4. Make your changes and click **Save to Remote**.

---

## Project Structure

```
Reconnect/
├── server.js              # Express backend — API routes, SSH/SFTP logic, SSE streaming
├── db.js                  # SQLite database setup (servers & commands tables)
├── package.json           # Node.js project config and dependencies
├── public/
│   ├── index.html         # Main UI layout (links style.css + js/main.js as type=module)
│   ├── style.css          # CSS entry point — @imports all partials in cascade order
│   ├── css/               # CSS partials (no build step; native @import)
│   │   ├── tokens.css         # Design tokens: CSS variables, dark/light theme, @font-face
│   │   ├── base.css           # Resets, app shell, mobile bar, keyframes
│   │   ├── layout.css         # Rail, sidebar, main column, tabbar, resize handle
│   │   ├── components.css     # Buttons, inputs, cards, modals, toast, status pill, badges
│   │   ├── responsive.css     # @media breakpoints (≤1024 px, ≤620 px), reduced-motion
│   │   └── views/
│   │       ├── overview.css   # Bento grid, metric cards, ring meters, shimmer
│   │       ├── terminal.css   # Terminal pane, quick-commands drawer
│   │       └── files.css      # File tree, breadcrumbs, Monaco editor host, bookmarks drawer
│   ├── js/                # ES module tree (no build step; native type=module)
│   │   ├── main.js            # Entry: INIT, status polling, DOM event wiring, DI boot
│   │   ├── state.js           # Shared STATE singleton
│   │   ├── icons.js           # ICONS map + icon() helper
│   │   ├── api.js             # api(), esc(), setBtnLoading()
│   │   ├── theme.js           # Theme toggle, Monaco/terminal theme sync
│   │   ├── monaco.js          # ensureMonaco(), langFor(), currentMonacoTheme()
│   │   ├── wterm.js           # ensureWterm() lazy loader
│   │   ├── ui/
│   │   │   ├── toast.js           # Toast notifications
│   │   │   ├── confirm.js         # Confirmation modal
│   │   │   ├── sidebar.js         # Server list, collapse, mobile nav
│   │   │   ├── statusPill.js      # Server status pill rendering
│   │   │   ├── tabs.js            # Overview / Terminal / Files tab switching
│   │   │   ├── overview.js        # Server overview panel + system stats
│   │   │   ├── outputPanel.js     # Output/log panel
│   │   │   └── resize.js          # Output panel drag-resize
│   │   ├── features/
│   │   │   ├── connect.js         # SSH connect/disconnect, SSE event handling
│   │   │   ├── terminal.js        # WTerm lifecycle, park/unpark, run command
│   │   │   ├── files.js           # File tree, Monaco editor, upload, bookmarks
│   │   │   └── quickCommands.js   # Quick-commands CRUD and drawer
│   │   └── modals/
│   │       ├── serverModal.js     # Add/edit/delete server modal
│   │       ├── settingsModal.js   # App settings (auth mode) modal
│   │       ├── otpModal.js        # One-time passcode modal
│   │       └── helpModal.js       # In-app help guide modal
│   ├── fonts/             # Self-hosted Zoho Puvi font files
│   └── vendor/            # Vendored xterm.js assets
├── docs/
│   ├── index.html             # In-app Help Guide (rendered in iframe)
│   ├── fonts/                 # ZohoPuvi font files for docs
│   ├── DOCUMENTATION.md       # Source documentation content
│   └── Reconnect — Deck.pdf   # Downloadable PDF documentation
├── uploads/               # Temporary directory for file uploads
├── data.db                # SQLite database (created on first run)
└── .secret                # Auto-generated AES-256 encryption key (created on first run)
```

### Frontend architecture notes

- **No build tooling.** CSS uses native `@import`; JS uses native ES modules (`type="module"`). Everything runs directly in the browser — no Webpack, Vite, or Tailwind.
- **Circular-import safety.** Modules that would form circular static imports use a dependency-injection pattern: each module exports a `_setXDeps()` setter. `main.js` calls these setters at boot time to wire the application graph.
- **State.** All shared mutable state lives in the `STATE` singleton in `state.js`. Modules import it directly; no global `window.*` pollution.

---

## Internal / Self-Hosted Deployment

> **Network requirement — read this first.**
> Reconnect is an SSH client. It can only reach servers that its host machine can route to.
> Internal app servers (e.g. `*.zohocorpin.com`, `*.csez.zohocorpin.com`) are not reachable from the public internet.
> **Public cloud platforms (Render, Vercel, Railway, Fly.io, etc.) will time out with `Timed out while waiting for handshake`.**
> The host must be on the corporate network (office LAN or VPN).

### Option A — Docker (recommended)

1. Build the image on a machine that has Docker and can reach the repo:
   ```bash
   git clone https://github.com/CyberAakash/Reconnect.git
   cd Reconnect
   docker build -t reconnect .
   ```

2. Run it (substitute real values for the three secrets):
   ```bash
   docker run -d --name reconnect \
     -p 9898:9898 \
     -e APP_PASSWORD='a-strong-password' \
     -e SESSION_SECRET='<32-byte hex>' \
     -e ENCRYPTION_KEY='<32-byte hex from your .secret file>' \
     -v reconnect-data:/data \
     reconnect
   ```

3. Access at `http://<internal-host>:9898`.

To generate the hex values:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**ENCRYPTION_KEY** must match the value in your local `.secret` file (or generate a new one if starting fresh).

### Option B — Direct Node.js (VM / internal server)

```bash
git clone https://github.com/CyberAakash/Reconnect.git
cd Reconnect
npm install --omit=dev
NODE_ENV=production HOST=0.0.0.0 PORT=9898 DATA_DIR=/var/reconnect \
  APP_PASSWORD='...' SESSION_SECRET='...' ENCRYPTION_KEY='...' \
  node server.js
```

For always-on operation, wrap with **pm2** or a **systemd** unit.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `APP_PASSWORD` | Yes | Password for the `/login` page. Use a strong value. |
| `SESSION_SECRET` | Yes | Signs the auth cookie. Random 32-byte hex string. |
| `ENCRYPTION_KEY` | Yes | AES-256 key for stored SSH credentials. Copy from `.secret` or generate new. |
| `HOST` | Defaults to `0.0.0.0` | Bind address. `0.0.0.0` listens on all interfaces. |
| `PORT` | Defaults to `9898` | HTTP port. |
| `DATA_DIR` | Defaults to app directory | Directory for `data.db` and `.secret`. Use a persistent volume path. |
| `NODE_ENV` | Set to `production` | Enables prod guards (secure cookies, APP_PASSWORD enforcement). |

### Persistent data

`data.db` (saved servers) and `.secret` (encryption key fallback) are written to `DATA_DIR`. Mount a persistent volume/directory at that path so they survive container restarts and re-deploys.

---

## Deploy on Render

> **Note:** `render.yaml` is kept for reference but Render (public cloud) cannot reach internal corporate SSH servers. Use the Internal deployment path above instead if your servers are internal-only.



Reconnect runs on [Render](https://render.com) as a persistent Node web service (not serverless). The included `render.yaml` blueprint wires everything up.

### Steps

1. Push this repo to GitHub (already done).
2. In the Render dashboard, click **New → Blueprint** and point it at the repo.
3. Set the following environment variables in the Render dashboard (**do not commit real values**):

| Variable | Required | Description |
|---|---|---|
| `APP_PASSWORD` | Yes | Password that protects the web UI. Use a strong random value. |
| `SESSION_SECRET` | Yes | Signs the auth cookie. Use a random 32-byte hex string. |
| `ENCRYPTION_KEY` | Yes | AES-256 key that keeps stored SSH credentials decryptable across restarts. Copy the hex value from your local `.secret` file, or generate a new one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `HOST` | Auto | Set to `0.0.0.0` by `render.yaml` — do not change. |
| `NODE_ENV` | Auto | Set to `production` by `render.yaml`. |
| `DATA_DIR` | Auto | Set to `/var/data` by `render.yaml` (persistent disk mount point). |

### Persistent disk caveat

The `render.yaml` blueprint includes a 1 GB persistent disk mounted at `/var/data` — this stores `data.db` (your saved servers). **Persistent disks require a paid Render plan** and pin the service to 1 instance.

On the **free tier** (no disk): remove the `disk:` block from `render.yaml`. The `data.db` will reset on restart, but as long as `ENCRYPTION_KEY` is set via env your SSH credentials remain consistent if you re-add servers.

### Security note

> **This tool executes arbitrary commands on your remote servers.** Never deploy it publicly without setting `APP_PASSWORD`. Use a long, random password. Do not reuse passwords from other services.

---

## Security Notes

- When deployed, set `HOST=0.0.0.0` so the process binds to all interfaces (Render handles TLS/reverse-proxy).
- When running locally, the server binds to **127.0.0.1 only** — it is not accessible from other machines.
- Server passwords are **encrypted at rest** using AES-256-CBC. The encryption key is stored in `.secret` (auto-generated on first run with restrictive file permissions).
- No credentials are ever passed in URL query parameters.
- **Do not commit `.secret` or `data.db` to version control.** Add them to your `.gitignore`:

  ```
  .secret
  data.db
  uploads/
  ```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `npm install` fails on `better-sqlite3` | Make sure you have Xcode Command Line Tools: `xcode-select --install` |
| Port 9898 already in use | Kill the existing process: `lsof -ti:9898 \| xargs kill` then restart |
| SSH connection fails | Verify the server IP, port, username, and credentials. Use **Test Connection** from the UI. |
| Permission denied on SSH key | Ensure the key file has correct permissions: `chmod 600 ~/.ssh/id_rsa` |
| OTP connect fails / "All configured authentication methods failed" | Confirm OTP access is approved (PAM/ZService) and 0Agent is on the right zero-host with policies reloaded. Verify `ssh sas@<ip>` prompts for an OTP in a plain terminal. |
| OTP times out before you enter it | REConnect auto-requests a fresh passcode (up to 3 tries). Just enter the latest OTP from your email. |
| `Host key verification failed` | The server's key changed. Remove the stale entry and reconnect: `ssh-keygen -R <server-ip>` (this affects only that host). |
| Terminal won't run `vim`/`htop` in OTP mode | Expected — OTP mode is a command console (one shell, no live PTY). Use a real `ssh` session for full-screen programs. |

---

## Stopping the Server

**If running via PM2:**
```bash
pm2 stop reconnect
```

**If running directly (`npm start`):**

Press `Ctrl + C` in the terminal, or:

```bash
lsof -ti:9898 | xargs kill
```

---

## License

ISC

---

## Optional: Custom Local Domain + Memorable Port

> **This section is optional.** The default setup (`http://127.0.0.1:9898`) works perfectly without it.

If you'd like to access Reconnect via a friendly URL like `http://reconnect.zoho.tool:9898`, follow the steps below.

### How it works

```
Browser: reconnect.zoho.tool:9898  --(hosts file)-->  127.0.0.1:9898  --> Node app
```

The OS hosts file resolves the custom name to loopback; no code changes are needed beyond what's already done.

### Step 1: Add a hosts file entry

**macOS** — run in Terminal:
```bash
echo "127.0.0.1 reconnect.zoho.tool" | sudo tee -a /etc/hosts
```

**Windows** — open Notepad as Administrator and add this line to `C:\Windows\System32\drivers\etc\hosts`:
```
127.0.0.1 reconnect.zoho.tool
```

### Step 2: Verify it works

```bash
ping -c 1 reconnect.zoho.tool
# Should show: 127.0.0.1
```

### Step 3: Access the tool

Open your browser and go to:
```
http://reconnect.zoho.tool:9898
```

> **Tip:** Bookmark this URL. Because `.tool` is not a standard public TLD, some browsers may treat a bare `reconnect.zoho.tool` as a search query — always use the full `http://` prefix.

### To undo (remove the custom domain)

```bash
sudo nano /etc/hosts
# Find and delete the line: 127.0.0.1 reconnect.zoho.tool
# Save with Ctrl+O, exit with Ctrl+X
```

### Step 4 (advanced): Access without a port number

If you want `http://reconnect.zoho.tool` with no `:9898`, pick one approach:

#### Option A — macOS pfctl port forwarding (recommended)

Keeps the app on port 9898. The OS silently redirects port 80 traffic to it.

```bash
# One-time: enable pf and add the forwarding rule
sudo pfctl -e 2>/dev/null; echo "rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 80 -> 127.0.0.1 port 9898" | sudo pfctl -ef -
```

**Understanding the output** — you may see messages like these. All are **warnings, not errors**:

| Message | What it means |
|---|---|
| `pfctl: Use of -f option, could result in flushing of rules…` | Normal advisory — pf loaded your rule. Safe to ignore. |
| `No ALTQ support in kernel / ALTQ related functions disabled` | macOS doesn't include bandwidth shaping. No effect on port forwarding. |
| `pfctl: pf already enabled` | Packet filter was already running — fine. The `-e` flag is harmless. |

If the command exits **without an error** (just the warnings above), the rule is active. Test by visiting `http://reconnect.zoho.tool` — no port needed.

> **Note:** This rule lasts until the next reboot. To make it survive reboots, add it to `/etc/pf.conf` (see macOS pf documentation). The app itself continues to run on port 9898 — no PM2 changes needed.

#### Option B — Run on port 80

```bash
pm2 delete reconnect
sudo PORT=80 pm2 start npm --name reconnect -- start
pm2 save
```

> **macOS caveat:** port 80 requires root. Running PM2 as root is generally not recommended. Prefer Option A.

#### Option C — Just use a bookmark (simplest)

The app runs on `:9898` as-is. Add `http://reconnect.zoho.tool:9898` as a browser bookmark named "Reconnect" — one click, never type the port again.
