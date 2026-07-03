# Local test matrix — exercising every connection axis

REConnect now has four independent per-server axes:

| Axis | Values |
|------|--------|
| **Transport** | `internal` (proxy tunnel + single shell) / `external` (direct SSH) |
| **Auth** | `otp` / `password` (`otp` only honored on internal) |
| **Explorer** | `sftp` / `onechannel` (base64-over-shell) |
| **Terminal** | `pty` (live) / `console` (command panel) |

Internal transport grants a single channel, so `sftp`/`pty` are **downgraded** to
`onechannel`/`console` there (you'll see a toast + amber toggle). All combos are
freely usable on **external**.

## 1. Start the targets + proxy

```bash
cd test
docker compose up -d --build        # ssh-external :2222, ssh-otp :2223
node proxy.js &                     # HTTP CONNECT proxy on 127.0.0.1:3128
```

Both SSH hosts use `tester` / `tester123`.

> **No `docker compose`?** Colima ships the Docker CLI without the Compose plugin.
> Install it (`brew install docker-compose` then enable as a CLI plugin), or run the
> two containers directly:
> ```bash
> docker build -t reconnect-ssh-otp ./otp-sshd
> docker run -d --name reconnect-ssh-otp -p 2223:22 reconnect-ssh-otp
> docker run -d --name reconnect-ssh-external -e PASSWORD_ACCESS=true \
>   -e USER_NAME=tester -e USER_PASSWORD=tester123 -e PUID=1000 -e PGID=1000 \
>   -p 2222:2222 lscr.io/linuxserver/openssh-server:latest
> ```

> **Port 3128 already in use?** The corporate zero-trust agent uses it. Run the test
> proxy on another port and point REConnect at it:
> `PORT=3130 node proxy.js` + `RECONNECT_SSH_PROXY=127.0.0.1:3130 npm start`.

## 2. Start REConnect

```bash
cd ..
# auth off for local (no APP_PASSWORD); point internal transport at the test proxy
RECONNECT_SSH_PROXY=127.0.0.1:3128 npm start
# open http://127.0.0.1:9898
```

> If you see `ERR_DLOPEN_FAILED` for `better-sqlite3`, your Node major changed —
> run `npm rebuild better-sqlite3` (the binding is per-Node-version).

## 3. Add servers (UI → Add Server) and walk the matrix

### A. External — full direct SSH (SFTP + live PTY)
- Host `127.0.0.1`, Port `2222`, User `tester`, Auth = Password `tester123`
- Connection method **External**, Explorer **SFTP**, Terminal **Live PTY**
- ✅ Connect → Files tab lists via SFTP; Terminal tab is an interactive PTY (try `htop`, `vim`).

### B. External — one-channel + command panel
- Same as A, but Explorer **One-channel**, Terminal **Command panel**
- ✅ Files still browse (base64-over-exec); Terminal runs one command at a time.
  Proves explorer/terminal are decoupled from transport.

### C. Internal + OTP (the original flow, now local)
- Host `127.0.0.1`, Port `2223`, User `tester`, Auth = Password `tester123`
- Connection method **Internal**, Flow **OTP**
- (Explorer/Terminal can be left at anything — they’ll downgrade.)
- ✅ Connect → OTP prompt appears → type `tester123` → connects through the proxy.
  A toast notes SFTP/PTY downgraded to one-channel/command-panel.

### D. Internal + Password (no OTP prompt)
- Same as C but Flow **Password**.
- ✅ Connects silently through the proxy using the stored password (no prompt).

### E. Downgrade visibility
- Take server A (external, SFTP + PTY) and flip it to **Internal** from the overview
  toggles.
- ✅ The Explorer/Terminal toggles turn amber (downgraded); the next Connect uses
  one-channel + command panel and toasts why.

## 4. Global vs per-server scope (Settings)
- **Per-server**: each server uses its own four axes (the inline toggles apply).
- **Global**: the four defaults in Settings rule every server, regardless of its
  stored values — verify by switching scope and re-connecting.

## Cleanup
```bash
cd test && docker compose down
# stop the proxy: kill the `node proxy.js` job
```
