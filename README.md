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
- Multiple saved servers with credentials encrypted at rest (AES-256)
- Interactive terminal via xterm.js over a WebSocket PTY
- Reusable saved commands + ad-hoc commands with live streaming output
- Remote file browser + editor (Monaco) with save-back over SFTP
- SFTP file uploads to any remote path
- Bookmarked files for fast access to frequently edited remote files
- Server overview with live system stats and connection status pill
- Dark / light theme with self-hosted fonts
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

4. **Open your browser** and go to:

   ```
   http://127.0.0.1:3456
   ```

That's it. The tool is ready to use.

---

## Usage

### Adding a Server

1. Click the **+** button in the sidebar.
2. Fill in the server label, IP/hostname, port, username, and either a password or path to an SSH private key.
3. Click **Save**.

The server appears in the sidebar. Click it to open its dashboard.

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
│   │       └── otpModal.js        # One-time passcode modal
│   ├── fonts/             # Self-hosted Zoho Puvi font files
│   └── vendor/            # Vendored xterm.js assets
├── uploads/               # Temporary directory for file uploads
├── data.db                # SQLite database (created on first run)
└── .secret                # Auto-generated AES-256 encryption key (created on first run)
```

### Frontend architecture notes

- **No build tooling.** CSS uses native `@import`; JS uses native ES modules (`type="module"`). Everything runs directly in the browser — no Webpack, Vite, or Tailwind.
- **Circular-import safety.** Modules that would form circular static imports use a dependency-injection pattern: each module exports a `_setXDeps()` setter. `main.js` calls these setters at boot time to wire the application graph.
- **State.** All shared mutable state lives in the `STATE` singleton in `state.js`. Modules import it directly; no global `window.*` pollution.

---

## Deploy on Render

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
| Port 3456 already in use | Kill the existing process: `lsof -ti:3456 \| xargs kill` then restart |
| SSH connection fails | Verify the server IP, port, username, and credentials. Use **Test Connection** from the UI. |
| Permission denied on SSH key | Ensure the key file has correct permissions: `chmod 600 ~/.ssh/id_rsa` |

---

## Stopping the Server

Press `Ctrl + C` in the terminal where `npm start` is running, or:

```bash
lsof -ti:3456 | xargs kill
```

---

## License

ISC
