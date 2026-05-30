# RemoteTool — Tailwind CSS Redesign Prompts

> Copy-paste prompts for Claude, Cursor, or any AI design tool.  
> Each prompt is self-contained but references the **Design System Foundation** in Section 1.  
> All prompts are derived from the real app: `public/index.html`, `public/app.js`, `public/style.css`.

---

## HOW TO USE

1. Paste **Section 1 — Foundation** first in every new conversation to set context.
2. Then paste whichever **screen** or **component** prompt you need.
3. The AI will generate Tailwind HTML/JSX that matches the app's real structure and tokens.

---

## TAILWIND SETUP RECOMMENDATION

### Design / Iteration (zero build — keep current setup)

```html
<!-- Drop into <head> of index.html. Supports all Tailwind classes + arbitrary values. -->
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    darkMode: 'class',          // matches data-theme="dark" via JS toggle
    theme: {
      extend: {
        fontFamily: {
          ui:   ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
          mono: ['SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', 'Menlo', 'monospace'],
        },
        colors: {
          accent:   { DEFAULT: '#6366f1', hover: '#4f46e5', subtle: 'rgba(99,102,241,0.08)', medium: 'rgba(99,102,241,0.16)' },
          danger:   { DEFAULT: '#ef4444', hover: '#dc2626', subtle: 'rgba(239,68,68,0.08)' },
          success:  { DEFAULT: '#10b981', subtle: 'rgba(16,185,129,0.08)' },
          warning:  { DEFAULT: '#f59e0b', subtle: 'rgba(245,158,11,0.08)' },
        },
        borderRadius: {
          sm: '5px',
          DEFAULT: '8px',
          lg: '12px',
          xl: '16px',
        },
        boxShadow: {
          xs: '0 1px 2px rgba(0,0,0,0.05)',
          sm: '0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)',
          md: '0 4px 8px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.04)',
          lg: '0 8px 20px rgba(0,0,0,0.08), 0 4px 8px rgba(0,0,0,0.04)',
          xl: '0 20px 40px rgba(0,0,0,0.12)',
        },
        width: {
          sidebar: '240px',
          'sidebar-collapsed': '60px',
          output: '380px',
        },
      },
    },
  }
</script>
```

### Production (Tailwind CLI — recommended when shipping)

```bash
npm install -D tailwindcss
npx tailwindcss init
# tailwind.config.js — same theme.extend as above
# Input: src/input.css with @tailwind directives
# Output: public/output.css
# Build: npx tailwindcss -i src/input.css -o public/output.css --watch
```

> **Dark mode note:** the existing JS sets `data-theme="dark"` on `<html>`. Change dark mode strategy to `class` and add a one-liner that syncs: `document.documentElement.classList.toggle('dark', theme === 'dark')`.

---

---

# SECTION 1 — DESIGN SYSTEM FOUNDATION PROMPT

> Paste this at the start of every design conversation.

---

```
You are redesigning RemoteTool — a self-hosted SSH server manager that runs locally at 127.0.0.1:3456.
It is a single-page app (vanilla JS, no framework) with a Node/Express backend.

## DESIGN LANGUAGE

Visual character: Dense developer tool. Think VS Code sidebar meets Vercel dashboard.
Not minimal-blank — surfaces have subtle depth. Not garish — one accent color only.
Dark mode is the primary experience; light mode must be equally polished.

Typography:
  UI text:   system-ui stack (Segoe UI on Windows, SF Pro on Mac, Roboto on Android)
  Monospace: SF Mono / Cascadia Code / JetBrains Mono / Fira Code / Menlo
  Sizes: 11px (label), 12px (secondary), 13px (body), 14px (section), 16px (title)

## COLOR TOKENS (map to Tailwind theme)

Light mode:
  bg:             #f0f2f5        (page background)
  surface:        #ffffff        (card / panel)
  surface-2:      #f7f8fa        (inset / input background)
  surface-hover:  #eef0f3
  border:         #e3e6ec
  border-strong:  #c8cdd8
  text:           #111827
  text-muted:     #6b7280
  text-subtle:    #9ca3af
  accent:         #6366f1        (indigo, primary action)
  accent-hover:   #4f46e5
  accent-subtle:  rgba(99,102,241,0.08)
  accent-medium:  rgba(99,102,241,0.16)
  danger:         #ef4444
  danger-hover:   #dc2626
  danger-subtle:  rgba(239,68,68,0.08)
  success:        #10b981
  warning:        #f59e0b

Dark mode (data-theme="dark" on <html>, or .dark class):
  bg:             #0d0f14
  surface:        #161922
  surface-2:      #1d2130
  surface-hover:  #242840
  border:         #272c3f
  border-strong:  #353c55
  text:           #e4e6f0
  text-muted:     #8b91ab
  text-subtle:    #565e7a
  accent:         #818cf8        (lighter indigo for dark bg)
  accent-hover:   #a5b4fc
  danger:         #f87171
  success:        #34d399
  warning:        #fbbf24

## SHADOWS (light / dark)
  xs:  0 1px 2px rgba(0,0,0,0.05)   /  rgba(0,0,0,0.28)
  sm:  0 1px 3px rgba(0,0,0,0.07)   /  rgba(0,0,0,0.32)
  md:  0 4px 8px rgba(0,0,0,0.07)   /  rgba(0,0,0,0.36)
  lg:  0 8px 20px rgba(0,0,0,0.08)  /  rgba(0,0,0,0.40)
  xl:  0 20px 40px rgba(0,0,0,0.12) /  rgba(0,0,0,0.55)

## RADII
  sm: 5px  |  default: 8px  |  lg: 12px  |  xl: 16px

## LAYOUT DIMENSIONS
  Sidebar width (expanded):  240px
  Sidebar width (collapsed):  60px   (icons only, tooltip on hover)
  Output pane width (default): 380px (user-draggable 180–660px)
  Mobile breakpoint: ≤1024px  →  sidebar becomes overlay drawer
  Minimum content pane: 300px

## COMPONENT CONVENTIONS
  Buttons:
    btn-primary  = accent bg, white text, hover darken, focus ring accent/50
    btn-ghost    = transparent, text-muted, hover surface-hover
    btn-danger   = danger bg, white text
    btn-sm       = h-7 (28px), px-3, text-13px, rounded, gap-1.5 between icon+label
    icon-btn     = 28×28px, rounded, centered icon, no label (has aria-label + tooltip)
    is-loading   = disabled + spinner replaces content
  
  Inputs:
    height 32px, border, rounded, bg surface-2, focus ring accent
    monospace variant: font-mono text-12px
  
  Sections (on dashboard):
    card-like: bg surface, rounded-lg, border, shadow-xs
    section-header: h-10, px-4, flex items-center justify-between, border-b
    section-body: p-4

  Status colors in terminal output:
    stdout:  text (default)
    stderr:  danger / text-red-400
    info:    accent / text-indigo-400
    success: success / text-emerald-400
    exit-ok: success
    exit-err: danger

## ICON SYSTEM
  Inline 14×14px SVG icons (stroke="currentColor", stroke-width=1.5).
  Larger variants: 16×16 for sidebar, 32×32 for welcome illustration.
  Icon set used: server, plus, pencil, trash, play, terminal, refresh, connect,
    disconnect, check, upload, file, folder, compile, open, close, sun, moon,
    chevronLeft, menu, clear, save, newFile.

## ACCESSIBILITY
  All interactive elements have aria-label or visible text label.
  Use role="list" / role="listitem" on server list and command/file lists.
  Connection status region: aria-live="polite".
  Modal: role="dialog" aria-modal="true" aria-labelledby="modal-title".
  Keyboard: Enter/Space on list items, Escape closes modal/drawer.
  Focus ring: always visible — use focus-visible:ring-2 ring-accent/60.
```

---

---

# SECTION 2 — FULL SCREEN PROMPTS

---

## SCREEN 1 — Welcome / Empty State

> Screen shown before any server is selected.

---

```
Using the RemoteTool design system (see Foundation), design the WELCOME / EMPTY STATE screen.

## SCREEN SPEC
Full-page layout (viewport height). Three-pane shell visible but center content shows empty state.
  Left sidebar: 240px wide, server list present but none selected (no active item).
  Center pane: fills remaining space after sidebar, centered vertically + horizontally.
  Right output pane: 380px wide, visible but empty terminal.

## WHAT TO RENDER

### Sidebar (left, 240px)
  Header:
    - "RT" brand logo badge (accent bg, white text, 32×32, rounded-lg, font-mono font-bold)
    - "RemoteTool" text (font-ui, font-semibold, text-13px)
    - Right side: theme toggle icon-btn (sun/moon), collapse icon-btn (chevronLeft)
  Auth mode bar (below header, bg surface-2, border-b):
    - Label "Auth Mode" text-11px text-muted uppercase tracking-wide
    - Segmented toggle: [Legacy] [OTP] — active tab = accent bg white text, inactive = ghost
  Server list section:
    - Section label "SERVERS" text-11px uppercase tracking-wider text-subtle
    - "+ Add" icon-btn on the right
    - Empty state: dashed border rounded-lg inside list area, text-subtle "No servers yet."
  Sidebar footer (pinned to bottom): nothing for now, reserved space

### Center (empty state)
  Vertically + horizontally centered block:
    - Large server icon illustration (32×32 stroke, text-muted, mb-4)
    - h2 "No server selected" font-semibold text-18px
    - p text-muted text-14px "Add a server from the sidebar or select one to get started."
    - Small "Add Server" button (btn-primary, sm) below the text
  Background: bg (page bg color), no card

### Right output pane (380px)
  Header row:
    - "Output" label font-semibold text-13px, text-muted
    - Clear button (btn-ghost btn-sm, clear icon) right-aligned
  Terminal area:
    - pre element, bg surface, font-mono text-12px, full height, p-3
    - Empty: subtle placeholder text-subtle "Run a command to see output here."

### Resize divider (between center and right)
  4px wide vertical strip, bg border, hover: bg accent cursor-col-resize

## STATES
  Light: bg #f0f2f5, surfaces white, subtle shadows
  Dark:  bg #0d0f14, surfaces #161922

## TAILWIND HINTS
  Layout shell: `flex h-screen w-screen overflow-hidden`
  Sidebar:      `flex flex-col w-60 shrink-0 bg-[var(--surface)] border-r border-[var(--border)]`
  Center:       `flex-1 min-w-0 flex items-center justify-center bg-[var(--bg)]`
  Output:       `w-[380px] shrink-0 flex flex-col bg-[var(--surface)] border-l border-[var(--border)]`
  Divider:      `w-1 shrink-0 cursor-col-resize bg-[var(--border)] hover:bg-[var(--accent)]`
```

---

## SCREEN 2 — Dashboard (Server Selected, 3-Pane)

> The main working screen shown after clicking a server in the sidebar.

---

```
Using the RemoteTool design system (see Foundation), design the DASHBOARD / SERVER SELECTED screen.
This is the primary working screen — all three panes are active.

## SCREEN SPEC
  Sidebar: 240px, active server item highlighted
  Center: scrollable, contains multiple sections stacked vertically
  Right output pane: 380px, terminal with prior command output

## SIDEBAR CHANGES (vs Welcome)
  Active server list item:
    - bg accent-subtle, border-l-2 border-accent
    - Server icon (indigo tint), label text-accent, host/user text-11px text-muted below label
  Other items: default ghost hover

## CENTER PANE — dashboard header (sticky, bg surface, border-b, shadow-xs)
  Left: h2 server label (font-semibold text-16px) + connection status badge inline
  Status badge variants:
    disconnected: gray dot + "Disconnected"
    connecting:   yellow/amber dot pulsing + "Connecting…"
    awaiting_otp: blue dot pulsing + "Awaiting OTP"
    ready:        green dot + "Connected"
  Right action bar (gap-2):
    [Legacy mode]:  [Test] [Edit] [Delete]
    [OTP mode]:     [Connect] [Disconnect] [Test] [Edit] [Delete]
    OTP mode + awaiting: OTP input bar visible (see OTP screen)
    All: btn-sm, with icon prefix

## CENTER PANE — scrollable content sections
  Each section = card (bg surface, rounded-lg, border, shadow-xs, mb-4):

  ### Saved Commands
  Header: "Saved Commands" h3 text-14px font-semibold | [+ Add] btn-sm right
  Body: horizontal wrapping flex of command pill buttons
    Command pill: bg surface-2, border, rounded-md, h-8, px-3, text-13px
      Left: terminal icon text-muted
      Center: command label text
      Right: pencil + trash icon-btns (appear on hover, gap-1)
      Hover: bg surface-hover, shadow-xs
      Active/loading: opacity-70, spinner

  ### Run Ad-hoc Command
  Header: "Run Ad-hoc Command" h3
  Body: inline form — full-width input + [Run] btn-primary
    Input: placeholder "e.g. uptime", font-mono, flex-1
    Run button: play icon + "Run"

  ### Saved Files
  Header: "Saved Files" h3 | [+ Add] btn-sm
  Body: same pill layout as Commands but file icon, opens editor drawer on click

  ### Browse Remote Files
  Header: "Browse Remote Files" h3 | [New File] [Upload] btn-sm
  Sub-header: path input + [List] btn
  File browser list below (see file browser screen)

  ### Compile
  Header: "Compile" h3
  Body: filename input + [Compile] btn-run

## RIGHT OUTPUT PANE (active)
  Header: "Output" + pulsing green dot when running + [Clear] btn-ghost
  Terminal: pre, font-mono text-12px, line-height 1.5, p-3
    stdout lines: text (default)
    stderr lines: text-red-400 dark:text-red-400
    info lines:   text-indigo-400
    success lines: text-emerald-400
  Exit code badge: small inline badge at end of run

## TAILWIND HINTS
  Center scroll: `flex-1 overflow-y-auto p-5 space-y-4`
  Section card:  `bg-[var(--surface)] rounded-lg border border-[var(--border)] shadow-xs`
  Section header:`flex items-center justify-between h-10 px-4 border-b border-[var(--border)]`
  Section body:  `p-4`
```

---

## SCREEN 3 — OTP Connect Flow

> Shown when Auth Mode = OTP and user clicks Connect.

---

```
Using the RemoteTool design system (see Foundation), design the OTP CONNECT FLOW states.
This is an overlay on the dashboard header action bar — not a modal, just inline state changes.

## THREE STATES TO SHOW (design all three as separate variants)

### State A — OTP mode idle (server selected, not yet connected)
  Dashboard header action bar contains:
    [Connect →]  btn-primary, connect icon
    [Test]       btn-sm ghost
    [Edit]       btn-sm ghost, pencil icon
    [Delete]     btn-sm btn-danger, trash icon
  Connection status: gray dot "Disconnected"

### State B — Connecting / Awaiting OTP
  [Connect] button hidden.
  OTP bar appears inline (below or replacing the action buttons):
    - Small label "Check your Zohocorp email for the OTP code" text-12px text-muted italic
    - OTP input: w-36, font-mono, text-center, letter-spacing-wider, placeholder "••••••"
    - [Submit OTP] btn-primary, check icon, text "Submit"
    - [Cancel] text-button (link style, text-muted, hover text-danger)
  Connection status: amber pulsing dot "Awaiting OTP"
  The OTP input should auto-focus.

### State C — Connected (ready)
  [Disconnect →]  btn-sm, disconnect icon, border-danger text-danger hover:bg-danger-subtle
  [Test]          btn-sm ghost (now shows "OK" with green check if last test passed)
  [Edit]          btn-sm ghost
  [Delete]        btn-sm danger
  Connection status: green pulsing dot "Connected"
  Green subtle banner strip below header (toast-like): "Connected successfully!" fades out after 3s.

## PULSING DOT ANIMATION
  Use Tailwind `animate-pulse` on the dot.
  Disconnected: bg-gray-400
  Connecting:   bg-amber-400 animate-pulse
  Awaiting OTP: bg-blue-400 animate-pulse
  Connected:    bg-emerald-500 (no pulse — steady)

## TAILWIND HINTS
  OTP input:    `w-36 text-center font-mono tracking-widest border rounded px-2 h-8 bg-[var(--surface-2)]`
  Status dot:   `w-2 h-2 rounded-full inline-block mr-1.5`
  Success toast:`absolute top-0 left-0 right-0 h-6 bg-emerald-500/10 text-emerald-600 text-12px flex items-center px-4 border-b border-emerald-500/20`
```

---

## SCREEN 4 — Remote File Browser (Populated)

> The file listing inside the "Browse Remote Files" section.

---

```
Using the RemoteTool design system (see Foundation), design the REMOTE FILE BROWSER component
as it appears populated inside the dashboard section card.

## ANATOMY
  Path navigation row (above list):
    - Breadcrumb or input showing current path (e.g. /home/sas/source_compile/)
    - [List] btn to re-fetch

  File/directory rows (inside the section body, no outer padding):
    Each row = full-width, h-9 (36px), flex items-center, px-3, border-b (last row no border-b)
    Hover: bg surface-hover cursor-pointer

  ### Directory row
    - Folder icon (14px, text-amber-400 dark:text-amber-300)
    - Name text-13px font-medium flex-1
    - ".." back row has same style, folder icon, name ".."
    - Click → navigate into directory

  ### File row
    - File icon (14px, text-[var(--text-muted)])
    - Name text-13px flex-1
    - Size text-11px text-subtle mr-2
    - Action buttons (appear on row hover, flex gap-1):
        Open:    icon-btn (open/edit icon), title="Open in editor"
        Compile: icon-btn (compile icon, text-amber-500), only for .java .go .c .cpp .ts .js .py .rs
        Delete:  icon-btn (trash icon, text-danger hover:bg-danger-subtle)

  ### Empty state
    Full-width centered text-subtle "Empty directory" inside the section body

  ### Loading state
    Shimmer skeleton rows (3-4 rows), or spinner centered with "Loading…" text-muted text-12px

  ### Error state
    Red-tinted inset box, danger icon, error message text, retry link

## TAILWIND HINTS
  Row:         `flex items-center px-3 h-9 border-b border-[var(--border)] hover:bg-[var(--surface-hover)] transition-colors`
  Actions:     `opacity-0 group-hover:opacity-100 flex gap-1 ml-auto` (use `group` on row)
  Spinner:     `w-3.5 h-3.5 border-2 border-[var(--border)] border-t-[var(--accent)] rounded-full animate-spin`
```

---

## SCREEN 5 — Editor Drawer Open

> Bottom-anchored slide-up drawer for reading/writing remote files.

---

```
Using the RemoteTool design system (see Foundation), design the EDITOR DRAWER.
It slides up from the bottom of the content pane (not full screen), overlapping the lower
sections of the dashboard. A semi-transparent backdrop covers the content behind it.

## SCREEN SPEC
  Drawer height: 60vh (configurable by user drag in future).
  Drawer width: same as center content pane (sidebar and output pane still visible).
  Entry animation: slide up from bottom, ease-out 200ms.
  Backdrop: rgba(0,0,0,0.35) over center content only (not sidebar/output).
  z-index: above content, below modal.

## ANATOMY

  ### Drawer header (h-12, bg surface, border-b, px-4)
    Left side:
      - File name (basename of path) — font-semibold text-14px, truncated
      - Status chip (small, inline-flex, ml-2): "Saved!" = emerald, "Save failed" = danger, "Saving…" = amber
    Center:
      - Path input: flex-1, font-mono text-12px, placeholder "/home/sas/source_compile/Foo.java"
      - [Open] btn-sm (open icon + "Open")
    Right:
      - [×] icon-btn (close icon), closes drawer

  ### Textarea body (flex-1, grows to fill drawer height)
    - Full-width, no border, no outline, padding p-3
    - bg surface, font-mono text-12px line-height 1.6
    - spellcheck false, resize: none
    - Subtle line numbers column optional (future)

  ### Drawer footer (h-11, bg surface-2, border-t, px-4, flex items-center justify-between)
    Left: status text (e.g. "Saved!" in emerald, "Saving…" in amber, empty normally)
    Right btn group (gap-2):
      [Save & Compile]  btn-sm, compile icon + label, accent/secondary style
      [Save to Remote]  btn-sm btn-primary, save icon + label

## STATES
  Default (empty/new file): placeholder textarea "// Start typing…", path input empty
  Loading (fetch): spinner in textarea center, "Fetching…" in status
  Loaded: file content in textarea, path filled
  Saving: Save button shows spinner (is-loading), status "Saving…"
  Saved: status "Saved!" text-emerald, fades to empty after 2s
  Error: status "Save failed" text-danger, shake micro-animation on save button

## TAILWIND HINTS
  Drawer:    `absolute inset-x-0 bottom-0 flex flex-col rounded-t-xl bg-[var(--surface)] border-t border-[var(--border)] shadow-xl z-40 transition-transform`
  Open:      `translate-y-0`
  Closed:    `translate-y-full`
  Backdrop:  `absolute inset-0 bg-black/35 z-30`
  Textarea:  `flex-1 w-full resize-none outline-none p-3 font-mono text-xs bg-[var(--surface)] text-[var(--text)]`
```

---

## SCREEN 6 — Mobile Layout

> The UI at viewport ≤1024px wide.

---

```
Using the RemoteTool design system (see Foundation), design the MOBILE LAYOUT.
Breakpoint: max-width 1024px.

## DIFFERENCES FROM DESKTOP

### Top bar (mobile-only, fixed h-12, bg surface, border-b, shadow-sm)
  Left:  hamburger icon-btn (3-line menu icon, 20×20px)
  Center: "RT" brand badge + "RemoteTool" text
  Right:  theme toggle icon-btn

### Sidebar
  Becomes an overlay drawer (fixed, left-0 top-0 h-full w-60, z-50).
  Default: off-screen left (translate-x-[-100%]).
  Open: translate-x-0, backdrop overlay behind it (bg-black/40 z-40 inset-0 fixed).
  Content identical to desktop sidebar.
  Close: tap backdrop or select a server.

### Work area
  Main content takes full width (no sidebar gutter).
  Output pane:
    - On mobile: hidden by default, appears as bottom sheet (h-48) below main content.
    - Or: full width stacked below main content, collapsible with a toggle.
    - No drag-resize divider on mobile.

### Dashboard header
  Action buttons compress: show only icon-btns (no text labels) on very narrow screens.
  OTP bar stacks vertically if viewport < 480px.

### Editor drawer
  Full height (100vh) on mobile, slides up from bottom, covering entire screen.
  Drawer header remains fixed, textarea fills remaining height.

## TAILWIND HINTS
  Top bar:    `lg:hidden fixed top-0 inset-x-0 h-12 flex items-center px-3 gap-3 bg-[var(--surface)] border-b z-50`
  Sidebar:    `fixed inset-y-0 left-0 w-60 z-50 transition-transform lg:translate-x-0 lg:static lg:z-auto`
  Overlay:    `fixed inset-0 bg-black/40 z-40 lg:hidden`
  Content:    `flex-1 min-w-0 pt-12 lg:pt-0`
  Output:     `lg:w-[380px] w-full border-t lg:border-t-0 lg:border-l`
```

---

---

# SECTION 3 — COMPONENT PROMPTS

---

## COMPONENT 1 — Sidebar

---

```
Using the RemoteTool design system (see Foundation), design the SIDEBAR component in full detail.

## PURPOSE
Navigation panel listing SSH servers. Fixed left. Collapsible. Mobile becomes overlay drawer.

## ANATOMY (expanded, 240px)

  ### Header (h-14, px-4, flex items-center justify-between, border-b)
    Brand group (flex items-center gap-2.5):
      Logo badge: 32×32, rounded-lg, bg-accent, text-white, font-mono font-bold text-13px, "RT"
      Brand name: "RemoteTool" font-semibold text-14px text-[var(--text)]
    Actions group (flex gap-1):
      Theme toggle: icon-btn, sun icon (dark mode) / moon icon (light mode)
      Collapse:     icon-btn, chevronLeft icon, rotates 180° when collapsed

  ### Auth mode bar (px-3 py-2, bg surface-2, border-b)
    "Auth Mode" label: text-11px uppercase tracking-wider text-subtle, mb-1.5
    Segmented control (flex, rounded-md, bg border/40, p-0.5, gap-0.5):
      [Legacy] [OTP]
      Active segment:   bg-[var(--surface)] text-[var(--accent)] font-medium shadow-xs rounded
      Inactive segment: text-[var(--text-muted)] hover:text-[var(--text)]
      Both: text-12px h-7 px-3 flex-1 text-center transition-all

  ### Server list group (flex-1, overflow-y-auto, pt-2 pb-2)
    Group header row (h-7, px-3, flex items-center justify-between):
      "SERVERS" text-11px uppercase tracking-wider text-subtle
      [+] icon-btn (plus icon, 24×24)

    Server list item (role="listitem"):
      Height: h-10, px-3, flex items-center gap-2.5, rounded-md mx-2, cursor-pointer
      Icon: server SVG 16×16, text-muted (default) / text-accent (active)
      Text column:
        Label: text-13px font-medium text-[var(--text)] leading-tight
        Host:  "user@host:port" text-11px text-subtle
      
      States:
        Default:  transparent bg
        Hover:    bg-[var(--surface-hover)]
        Active:   bg-accent-subtle, border-l-2 border-accent, label text-accent
        Focus:    focus-visible:ring-2 ring-accent/50

    Empty list:
      Inside list area, dashed border rounded-lg p-4 mx-2, text-center
      text-subtle text-12px "No servers added yet"
      Small [+ Add Server] link below

## COLLAPSED STATE (60px wide)
  - Hide: brand name, "SERVERS" label, server host/user text, auth mode bar (keep as tooltip)
  - Show: logo badge only (centered), server icons only (centered), collapsed chevron (rotated)
  - Each icon item: 40px square centered, tooltip on hover (server label + host)
  - Collapse button rotates 180°, now a "expand" chevron pointing right

## TRANSITIONS
  Width transition: `transition-[width] duration-200 ease-in-out`
  Text opacity: `transition-opacity duration-150`

## DARK MODE
  Sidebar bg: bg-[var(--surface)] (dark: #161922)
  Border-r: border-[var(--border)] (dark: #272c3f)
  Active item accent: accent #818cf8 in dark

## TAILWIND HINTS
  Root:   `flex flex-col h-full bg-[var(--surface)] border-r border-[var(--border)] transition-[width] duration-200 w-60 [&.collapsed]:w-[60px]`
  Item:   `flex items-center gap-2.5 h-10 px-3 rounded-md mx-2 cursor-pointer transition-colors hover:bg-[var(--surface-hover)] [&.active]:bg-accent-subtle [&.active]:border-l-2 [&.active]:border-accent`
```

---

## COMPONENT 2 — Center Panel (Dashboard Sections)

---

```
Using the RemoteTool design system (see Foundation), design the CENTER PANEL
— the main content area showing all dashboard sections for a selected server.

## PURPOSE
Scrollable main work area. Contains multiple independent section cards stacked vertically.

## ANATOMY

  ### Panel wrapper
    flex-1, overflow-y-auto, p-5, space-y-4, bg-[var(--bg)]

  ### Section card (base)
    bg-[var(--surface)], rounded-lg, border border-[var(--border)], shadow-xs
    Overflow hidden (so header border-b clips cleanly)

  ### Section header
    h-10, px-4, flex items-center justify-between, border-b border-[var(--border)]
    h3: text-14px font-semibold text-[var(--text)]
    Right slot: button(s) or nothing

  ### Section body
    p-4

  ---

  ### SECTION: Saved Commands
    Body: flex flex-wrap gap-2
    Command pill button:
      inline-flex items-center gap-2 h-8 px-3 rounded-md border text-13px
      bg surface-2, border, text, hover: surface-hover + shadow-xs
      Left: terminal icon text-muted
      Right actions (group-hover visible): pencil icon-btn, trash icon-btn (danger)
      Active/running: opacity-60, spinner in place of terminal icon
      Use `group` class on pill to show hover actions

  ### SECTION: Run Ad-hoc Command
    Body: inline form (flex gap-2)
      Input (flex-1): h-8, font-mono text-12px, border, rounded, bg surface-2
                      placeholder "e.g. uptime, ls -la, df -h"
      Button [Run]: h-8, btn-primary, play icon + "Run", w-20 shrink-0

  ### SECTION: Saved Files
    Identical layout to Saved Commands.
    File icon instead of terminal icon on pills.

  ### SECTION: Browse Remote Files
    Header right slot: [New File] [Upload] — both btn-sm
    Below header, before body: path sub-row (bg surface-2, px-4 py-2, border-b)
      Path input (flex-1 font-mono text-12px) + [List] btn-sm
    Body: file browser list (see File Browser component)

  ### SECTION: Compile
    Body: inline form
      Input (flex-1): placeholder "Filename, e.g. ZohoOneAPI.java", font-mono text-12px
      Button [Compile]: btn-run style = accent border + accent text, compile icon

## TAILWIND HINTS
  Ad-hoc form: `flex gap-2 items-center`
  Pill group:  `group relative inline-flex items-center gap-2 h-8 px-3 rounded-md border border-[var(--border)] bg-[var(--surface-2)] text-13px cursor-pointer hover:bg-[var(--surface-hover)] hover:shadow-xs transition-all`
  Pill actions:`hidden group-hover:flex items-center gap-0.5 ml-1`
```

---

## COMPONENT 3 — Right Extendable Output Panel

---

```
Using the RemoteTool design system (see Foundation), design the RIGHT OUTPUT/TERMINAL PANEL.
This is the resizable right-side pane showing live SSH command output.

## PURPOSE
Streams stdout/stderr/exit events from SSH commands. Persists across command runs.
User can drag-resize it left/right (180px min, 660px max, 380px default).

## ANATOMY

  ### Resize handle (drag divider)
    4px wide vertical strip between content and output pane.
    bg-[var(--border)]
    Hover: bg-[var(--accent)], cursor-col-resize
    Active (dragging): bg-accent, show resize cursor globally
    Tailwind: `w-1 shrink-0 bg-[var(--border)] hover:bg-[var(--accent)] cursor-col-resize transition-colors`

  ### Panel root
    flex flex-col, h-full, bg-[var(--surface)], border-l border-[var(--border)]
    Default width: 380px. Width is set via inline style (JS-controlled).

  ### Panel header (h-10, px-4, flex items-center justify-between, border-b, shrink-0)
    Left group:
      Running indicator dot: w-2 h-2 rounded-full mr-2
        Idle:    bg-[var(--border)]
        Running: bg-emerald-500 animate-pulse
      "Output" label: font-semibold text-13px text-[var(--text)]
    Right: [Clear] btn-ghost btn-sm (clear/trash icon + "Clear")

  ### Terminal body (flex-1, overflow-y-auto, p-3)
    pre element: font-mono text-12px leading-relaxed whitespace-pre-wrap break-words m-0
    Line color variants:
      .term-stdout:  color: var(--text)            (default)
      .term-stderr:  color: var(--danger)           (red)
      .term-info:    color: var(--accent)           (indigo)
      .term-success: color: var(--success)          (emerald)
    Scroll: auto-scroll to bottom on new output
    Selection: allowed (user may copy output)
    Empty state: text-[var(--text-subtle)] text-12px italic "Run a command to see output here."

  ### Scrollbar styling
    Thin scrollbar: `scrollbar-thin scrollbar-thumb-[var(--border)] scrollbar-track-transparent`

## RESIZE BEHAVIOR
  JS mousedown on divider → mousemove adjusts inline `style.width` → mouseup saves to localStorage.
  CSS: `min-w-[180px] max-w-[660px]`

## TAILWIND HINTS
  Panel:   `flex flex-col h-full bg-[var(--surface)] border-l border-[var(--border)] min-w-[180px] max-w-[660px]`
  Header:  `flex items-center justify-between h-10 px-4 border-b border-[var(--border)] shrink-0`
  Body:    `flex-1 overflow-y-auto p-3`
  pre:     `font-mono text-xs leading-relaxed whitespace-pre-wrap break-words m-0 text-[var(--text)]`
```

---

## COMPONENT 4 — Top Navigation Bar (Mobile)

---

```
Using the RemoteTool design system (see Foundation), design the TOP NAVIGATION BAR (mobile).
This bar is hidden on desktop (lg:hidden). It replaces the sidebar header for mobile.

## PURPOSE
Fixed top bar for mobile (≤1024px). Provides hamburger menu access, branding, and theme toggle.

## ANATOMY (h-12, fixed top-0 inset-x-0, z-50)
  Background: bg-[var(--surface)], border-b border-[var(--border)], shadow-sm
  Layout: flex items-center px-3 gap-2

  Left:
    Hamburger icon-btn (28×28px, menu icon 20×20, rounded)
    On click: opens sidebar overlay drawer

  Center (flex-1, justify-center):
    Logo badge "RT" (24×24, rounded-md, accent bg, white text, font-mono text-12px font-bold)
    "RemoteTool" text (text-14px font-semibold, text-[var(--text)], hidden below 360px)

  Right:
    Theme toggle icon-btn (sun/moon, 28×28)
    Optional: connection status dot (if server active)

## STATES
  Default: no active server
  Active server: show connection status dot + server name (text-11px text-muted, truncate)

## TAILWIND HINTS
  Root:    `lg:hidden fixed top-0 inset-x-0 h-12 z-50 flex items-center px-3 gap-2 bg-[var(--surface)] border-b border-[var(--border)] shadow-sm`
  Brand:   `flex-1 flex items-center justify-center gap-2`
  Logo:    `w-6 h-6 rounded-md bg-[var(--accent)] text-white font-mono font-bold text-xs flex items-center justify-center`
```

---

## COMPONENT 5 — Bottom Editor Drawer

---

```
Using the RemoteTool design system (see Foundation), design the BOTTOM EDITOR DRAWER component.
It slides up from the bottom of the center content pane to edit remote files.

## PURPOSE
In-app code/text editor for reading and writing files on the remote server over SFTP.
Not a full-screen modal — shows at 60vh so the user can still see the file browser above.

## ANATOMY

  ### Backdrop (behind drawer, over center content only)
    absolute inset-0, bg-black/35, z-30, hidden when drawer closed
    Click → closes drawer

  ### Drawer container
    absolute inset-x-0 bottom-0, z-40
    Height: 60vh (could also allow drag resize in future)
    bg-[var(--surface)], rounded-t-xl, border-t border-[var(--border)], shadow-xl
    Animation: `transition-transform duration-200 ease-out`
    Open:  `translate-y-0`
    Closed: `translate-y-full`

  ### Header (h-12, px-4, flex items-center gap-3, border-b border-[var(--border)], shrink-0)
    Title (font-semibold text-14px, truncate, max-w-[200px]):
      Shows basename of file (e.g. "ZohoOneAPI.java") or "New File"
    Status chip (inline-flex, text-11px, rounded-full, px-2 py-0.5, ml-1):
      "Saved!"     = bg-emerald-500/10 text-emerald-600
      "Saving…"    = bg-amber-500/10 text-amber-600
      "Save failed"= bg-danger-subtle text-danger
    Path input (flex-1, font-mono text-12px, h-7, border, rounded, bg surface-2):
      Placeholder: "/home/sas/source_compile/Foo.java"
    [Open] btn-sm (open icon + "Open")
    [×] icon-btn (close icon, ml-auto)

  ### Editor body (flex-1, no padding, overflow hidden)
    textarea:
      w-full h-full, resize-none, outline-none, border-none
      p-3, font-mono text-12px, leading-relaxed
      bg-[var(--surface)], color: var(--text)
      spellcheck false
      Tab key → insert 2 spaces (JS behavior, not CSS)

  ### Footer (h-11, px-4, flex items-center justify-between, bg surface-2, border-t, shrink-0)
    Left: status text (same as status chip content, text-12px)
    Right btn group (flex gap-2):
      [Save & Compile]  compile icon + text, bg transparent, border border-[var(--border)], hover border-accent text-accent
      [Save to Remote]  save icon + text, btn-primary

## LOADING STATE (file fetch in progress)
  Textarea replaced with centered spinner + "Fetching /path/to/file…" text-muted

## TAILWIND HINTS
  Drawer:   `absolute inset-x-0 bottom-0 h-[60vh] flex flex-col bg-[var(--surface)] rounded-t-xl border-t border-[var(--border)] shadow-xl z-40 transition-transform duration-200`
  Footer:   `h-11 px-4 flex items-center justify-between bg-[var(--surface-2)] border-t border-[var(--border)] shrink-0`
  Textarea: `flex-1 w-full resize-none outline-none p-3 font-mono text-xs leading-relaxed bg-[var(--surface)] text-[var(--text)]`
```

---

## COMPONENT 6 — Modal

---

```
Using the RemoteTool design system (see Foundation), design the MODAL component.
Used for: Add/Edit Server, Add/Edit Command, Add/Edit Saved File.

## PURPOSE
Centered overlay dialog for form input. Dynamic fields based on context.
ARIA: role="dialog" aria-modal="true" aria-labelledby="modal-title"

## ANATOMY

  ### Overlay (backdrop)
    fixed inset-0, z-50, bg-black/50, backdrop-blur-sm
    Click outside: does NOT dismiss (data could be lost) — only buttons dismiss

  ### Modal card (centered)
    position: fixed, centered (top-1/2 left-1/2, -translate-1/2)
    w-[420px] max-w-[calc(100vw-32px)]
    bg-[var(--surface)], rounded-xl, border border-[var(--border)], shadow-xl
    Animation: scale-in from 0.95 + fade-in, 150ms ease-out

  ### Modal header (h-12, px-5, flex items-center justify-between, border-b)
    h3: text-15px font-semibold text-[var(--text)]
    [×] icon-btn (close, top-right)

  ### Modal body (p-5, space-y-4)
    Form fields rendered dynamically by JS.
    
    Field group (.form-group):
      label: text-12px font-medium text-muted, mb-1, block
      input (text/number/password): full-width, h-8, border, rounded, bg surface-2
        focus: ring-2 ring-accent/40 border-accent outline-none
        error: ring-2 ring-danger/40 border-danger
      select: same as input, appearance-none, custom chevron background
      monospace inputs (path, command, key_path): font-mono text-12px

    ### Auth type conditional fields (JS-toggled display)
      auth_type = "password" → show password field, hide key_path field
      auth_type = "key"      → hide password field, show key_path field
      Transition: fade in/out (not instant toggle) via opacity + max-height transition

  ### Modal footer (px-5 py-4, flex items-center justify-end gap-2, border-t, bg surface-2, rounded-b-xl)
    [Cancel]  btn-sm (ghost style, text-muted)
    [Save]    btn-sm btn-primary (check icon + "Save")
    When saving: Save btn shows is-loading spinner

## KEYBOARD
  Escape → Cancel (dismiss without saving)
  Enter  → Save (if not in textarea)
  Tab    → cycle through fields

## ANIMATION
  Open:  `animate-[modal-in_150ms_ease-out]`
  @keyframes modal-in: from {opacity:0; transform: scale(0.95) translateY(-4px)} to {opacity:1; transform: scale(1) translateY(0)}

## TAILWIND HINTS
  Overlay: `fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm`
  Card:    `w-[420px] max-w-[calc(100vw-2rem)] bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-xl`
  Input:   `w-full h-8 px-3 border border-[var(--border)] rounded bg-[var(--surface-2)] text-[var(--text)] text-13px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:border-accent`
```

---

## COMPONENT 7 — Tooltip

---

```
Using the RemoteTool design system (see Foundation), design the TOOLTIP component.
Used on: icon-btns (no visible label), collapsed sidebar items, file browser action buttons.

## PURPOSE
Shows a short text label on hover/focus for buttons that only show icons.

## ANATOMY

  Trigger element (the icon-btn or list item):
    - Has `title` attribute (used as fallback) and `aria-label`
    - Add a `data-tooltip` attribute for custom tooltip text if different from aria-label

  Tooltip bubble:
    absolute, bg-[#1a1f2e] (dark surface always, even in light mode)
    text-white text-11px font-medium px-2 py-1 rounded-md
    white-space: nowrap
    shadow-md
    pointer-events: none
    z-[100]

  Position variants:
    Default (right):  left: calc(100% + 6px), top: 50%, -translateY(50%)
    Bottom:           top: calc(100% + 6px), left: 50%, -translateX(50%)
    Top:              bottom: calc(100% + 6px), left: 50%, -translateX(50%)

  Arrow (optional, 4×4px rotated square):
    same bg as tooltip, absolute on the side facing the trigger

  Show/hide:
    CSS: `opacity-0 group-hover:opacity-100 transition-opacity delay-150 duration-100`
    Or JS-based for complex cases

## VARIANTS

  Standard: text label only
    e.g. "Toggle theme" | "Collapse sidebar" | "Add server"

  With keyboard shortcut:
    Two spans: label text + kbd element
    kbd: font-mono text-10px bg-white/10 px-1 rounded border border-white/20

## EXAMPLE TAILWIND STRUCTURE
  <div class="group relative inline-flex">
    <button class="icon-btn" aria-label="Compile file"><!-- compile icon --></button>
    <div class="pointer-events-none absolute left-[calc(100%+6px)] top-1/2 -translate-y-1/2 
                whitespace-nowrap rounded-md bg-[#1a1f2e] px-2 py-1 text-[11px] font-medium 
                text-white opacity-0 shadow-md transition-opacity delay-150 group-hover:opacity-100 z-[100]">
      Compile file
    </div>
  </div>
```

---

## COMPONENT 8 — Loading State

---

```
Using the RemoteTool design system (see Foundation), design all LOADING STATE variants.
Loading states must never let the UI feel stuck — always show feedback within 200ms.

## VARIANT 1 — Button loading (is-loading)

Trigger: setBtnLoading(btn, true) — applied on any btn-sm or btn-primary.

Visual:
  - Button becomes disabled (pointer-events-none, opacity-70)
  - Button content replaced by: spinner + optional text ("Saving…", "Connecting…")
  - Spinner: 14×14px, border-2, border-white/30, border-t-white, rounded-full, animate-spin
  - Width: keep original width (use min-width) to prevent layout shift

Tailwind pattern for spinner:
  `<span class="inline-block w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin"></span>`

States of common buttons:
  [Run]          → spinner + "Running…"
  [Save]         → spinner + "Saving…"
  [Compile]      → spinner + "Compiling…"
  [Connect]      → spinner + "Connecting…"
  [Submit OTP]   → spinner (no text — button is narrow)
  [Upload]       → spinner + "Uploading…"
  [Test]         → spinner + "Testing…"

## VARIANT 2 — File browser loading

Shows inside the file browser section body while fetching directory listing.

Visual:
  Centered block: spinner (20px, border-2, border-[var(--border)], border-t-[var(--accent)]) + "Loading…" text-muted text-12px ml-2
  OR: 4–5 skeleton rows, each h-9, bg-[var(--surface-hover)] rounded animate-pulse, varying widths

Tailwind skeleton row:
  `<div class="h-9 rounded bg-[var(--surface-hover)] animate-pulse" style="width: 70%"></div>`

## VARIANT 3 — Output pane running dot

Small dot in the output panel header indicating an active command stream.

Visual:
  Idle:    `w-2 h-2 rounded-full bg-[var(--border)]`
  Running: `w-2 h-2 rounded-full bg-emerald-500 animate-pulse`

## VARIANT 4 — Full-page / section spinner

Used when loading the initial server list or commands.

Visual:
  Centered in its container: flex items-center justify-center h-full
  Spinner: 24×24px, border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin rounded-full

## VARIANT 5 — Drawer file fetch

When the editor drawer is fetching a remote file.

Visual:
  Replace textarea with flex items-center justify-center h-full bg-[var(--surface)]
  spinner 20px + "Fetching [filename]…" text-muted text-12px
```

---

## COMPONENT 9 — Icon Button

---

```
Using the RemoteTool design system (see Foundation), design the ICON BUTTON component.
This is the most common interactive element in the app.

## PURPOSE
Compact 28×28px button with a single SVG icon and no visible text label.
Must have aria-label (and tooltip — see Tooltip component).

## BASE STYLES
  w-7 h-7 (28×28px), flex items-center justify-center
  rounded (8px), border-0, bg transparent
  color: text-[var(--text-muted)]
  transition: colors 150ms

## STATES

  Default:
    bg transparent, text-muted icon

  Hover:
    bg-[var(--surface-hover)], text-[var(--text)]

  Active (pressed):
    bg-[var(--accent-subtle)], text-[var(--accent)]
    scale-95 brief

  Focus-visible:
    ring-2 ring-[var(--accent)]/50, ring-offset-1 ring-offset-[var(--surface)]

  Disabled:
    opacity-40, pointer-events-none

  Is-loading:
    show spinner (see Loading State), pointer-events-none

## VARIANTS

  Standard:        transparent bg (described above)
  Destructive:     hover:bg-danger-subtle hover:text-danger   (e.g. close-drawer ×)
  Accent:          active bg accent, text white                (rare — e.g. active toggle)

## SIZES
  Default (28×28): w-7 h-7, icon 14×14
  Large   (32×32): w-8 h-8, icon 16×16  — used in sidebar header (theme toggle, collapse)
  Small   (24×24): w-6 h-6, icon 12×12  — used in inline pill actions

## SVG ICON SPECS
  All icons: viewBox="0 0 14 14" (small) or 0 0 16 16 (sidebar)
  stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
  fill="none" (most icons) / fill="currentColor" (play ▶, compile arrows)
  Never use emoji or Unicode symbols — inline SVG only.

## TAILWIND SNIPPET
  <button
    class="inline-flex items-center justify-center w-7 h-7 rounded text-[var(--text-muted)]
           hover:bg-[var(--surface-hover)] hover:text-[var(--text)]
           active:bg-[var(--accent-subtle)] active:text-[var(--accent)]
           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50
           transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none"
    aria-label="Add server"
    title="Add server">
    <!-- SVG icon here -->
  </button>
```

---

## COMPONENT 10 — Connection Status Badge

---

```
Using the RemoteTool design system (see Foundation), design the CONNECTION STATUS BADGE.
Shown inline in the dashboard header next to the server name.

## ANATOMY
  Inline-flex, items-center, gap-1.5, px-2 py-0.5, rounded-full
  border, text-12px font-medium

## FOUR STATES

  disconnected:
    dot: w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500
    text: "Disconnected"
    container: border-gray-200 dark:border-gray-700 text-gray-500

  connecting:
    dot: bg-amber-400 animate-pulse
    text: "Connecting…"
    container: border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400

  awaiting_otp:
    dot: bg-blue-400 animate-pulse
    text: "Awaiting OTP"
    container: border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400

  ready:
    dot: bg-emerald-500 (no pulse — steady = stable connection)
    text: "Connected"
    container: border-emerald-200 dark:border-emerald-800/50 text-emerald-600 dark:text-emerald-400
    optional: subtle bg-emerald-50 dark:bg-emerald-950/20

## TAILWIND
  Base:    `inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium`
  Dot:     `w-1.5 h-1.5 rounded-full`
  Ready:   `bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-400`
```

---

## COMPONENT 11 — Auth Mode Segmented Toggle

---

```
Using the RemoteTool design system (see Foundation), design the AUTH MODE SEGMENTED TOGGLE.
A two-segment control in the sidebar for switching between Legacy and OTP auth.

## PURPOSE
Toggle between two mutually exclusive auth modes: "Legacy" (password/key) and "OTP" (certificate + email code).

## ANATOMY
  Container: flex p-0.5 gap-0.5 rounded-lg bg-[var(--border)]/40 (pill background)
  Width: stretch to sidebar width minus padding

  Each segment button:
    flex-1, text-center, h-7, text-12px, rounded-md, transition-all

  Inactive state:
    bg transparent, text-[var(--text-muted)], hover:text-[var(--text)]

  Active state:
    bg-[var(--surface)], text-[var(--accent)], font-medium, shadow-xs
    Transition: background slides (no harsh flash)

## LABELS
  [Legacy]  — title="Password / SSH key auth (auto-connects)"
  [OTP]     — title="ZAC certificate + Zohocorp email OTP"

## CHANGING MODES
  Visual feedback: the active segment slides, like a pill indicator.
  After switching: terminal writes "Auth mode switched to: OTP" in info color.
  Clears all pooled sessions server-side.

## COLLAPSED SIDEBAR
  In collapsed (60px) sidebar: hide this entire bar. Auth mode available via settings page (future).

## TAILWIND
  Container: `flex p-0.5 gap-0.5 rounded-lg bg-black/10 dark:bg-white/5`
  Button:    `flex-1 h-7 rounded-md text-xs text-center font-medium transition-all text-[var(--text-muted)] hover:text-[var(--text)]`
  Active:    `bg-[var(--surface)] text-[var(--accent)] shadow-xs`
```

---

## COMPONENT 12 — Command / File Pill Buttons

---

```
Using the RemoteTool design system (see Foundation), design COMMAND PILL BUTTONS and FILE PILL BUTTONS.
These are clickable cards in the Saved Commands and Saved Files sections.

## PURPOSE
One-click command runners and file openers. Each pill runs an SSH command or opens a file in the editor.
Inline edit/delete actions appear on hover.

## ANATOMY

  Outer pill (use group class for hover state cascade):
    inline-flex items-center gap-2 h-8 pl-2.5 pr-1.5 rounded-md
    border border-[var(--border)] bg-[var(--surface-2)]
    cursor-pointer, user-select: none
    transition: background-color, box-shadow

  Left icon: terminal icon (commands) or file icon (files) — 14×14, text-muted

  Label: text-13px text-[var(--text)], max-w-[160px] truncate

  Right action group (hidden by default, visible on group-hover):
    flex gap-0.5, opacity-0 group-hover:opacity-100 transition-opacity
    [✏] icon-btn small (24×24) — pencil icon, text-muted hover:text-accent
    [🗑] icon-btn small (24×24) — trash icon, text-muted hover:text-danger hover:bg-danger-subtle

## STATES

  Default:    bg surface-2, border, text
  Hover:      bg surface-hover, shadow-xs, actions appear
  Running:    opacity-60, left icon replaced with spinner, border-accent subtle
  Disabled:   opacity-40, pointer-events-none

## EMPTY STATE (no commands/files saved)
  text-subtle text-12px italic, no pills
  "No saved commands yet." / "No saved files yet."

## TAILWIND
  Pill:     `group inline-flex items-center gap-2 h-8 pl-2.5 pr-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] cursor-pointer hover:bg-[var(--surface-hover)] hover:shadow-xs transition-all`
  Actions:  `flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100`
```

---

## COMPONENT 13 — File Browser Row

---

```
Using the RemoteTool design system (see Foundation), design the FILE BROWSER ROW component.
Rows appear in the Remote File Browser section inside the dashboard.

## TWO ROW TYPES

  ### Directory row (folders, including ".." back nav)
    Height: h-9 (36px)
    Layout: flex items-center px-3 gap-2
    Hover: bg-[var(--surface-hover)], cursor-pointer
    Folder icon: 14×14, text-amber-400 dark:text-amber-300
    Name: text-13px font-medium text-[var(--text)]
    ".." row: same but lighter text-subtle

  ### File row
    Same height + padding as directory row.
    Add `group` class for hover action reveal.
    
    Left: file icon 14×14 text-muted
    Name: text-13px flex-1 truncate
    Size: text-11px text-subtle mr-2 (e.g. "12.4 KB", "1.2 MB")
    Actions (group-hover visible, gap-1):
      Open:    icon-btn small, open/edit icon — "Open in editor"
      Compile: icon-btn small, compile icon, text-amber-500 — only for compila ble extensions
      Delete:  icon-btn small, trash icon, hover:bg-danger-subtle hover:text-danger

  ### Border between rows
    border-b border-[var(--border)] on all rows except last child

## EXTENSION-BASED FILE TYPE INDICATORS (optional enhancement)
  .java .go .c .cpp: text-amber-500 (compilable, show compile btn)
  .ts .js:           text-blue-400
  .py:               text-yellow-400
  .json .yaml .toml: text-green-400
  .sh .bash:         text-emerald-400
  Other:             text-muted (default)

## TAILWIND
  Dir row:   `flex items-center px-3 h-9 gap-2 border-b border-[var(--border)] cursor-pointer hover:bg-[var(--surface-hover)] transition-colors`
  File row:  `group flex items-center px-3 h-9 gap-2 border-b border-[var(--border)] hover:bg-[var(--surface-hover)] transition-colors`
  Actions:   `opacity-0 group-hover:opacity-100 flex gap-1 ml-auto transition-opacity duration-100`
```

---

## COMPONENT 14 — Form Field Group

---

```
Using the RemoteTool design system (see Foundation), design the FORM FIELD GROUP component.
Used inside modals for all server/command/file forms.

## ANATOMY

  .form-group (mb-4 last:mb-0):
    
    label:
      display: block, mb-1
      text-12px font-medium text-[var(--text-muted)]
    
    input[type=text/number/password]:
      width: 100%
      h-8 (32px)
      px-3, border border-[var(--border)], rounded (8px)
      bg-[var(--surface-2)], text-[var(--text)], text-13px
      outline: none
      Focus: ring-2 ring-[var(--accent)]/40 border-[var(--accent)]
      Error:  ring-2 ring-danger/40 border-danger bg-danger-subtle/30
      Disabled: opacity-50 bg-[var(--surface)] cursor-not-allowed

    input[type=password]:
      font-family: inherit (show password chars normal)
      optional: eye icon toggle to show/hide (icon-btn absolute right inside input)

    input.input-mono (path, command, key_path fields):
      font-family: var(--font-mono), text-12px
      letter-spacing: 0

    select:
      same as input + appearance-none
      background-image: chevron-down SVG (right-aligned, pointer-events-none)
      padding-right: 2rem for arrow space

    Error message:
      text-11px text-danger mt-1 flex items-center gap-1
      danger icon (circle-x 12px) + message text

## SPECIFIC FIELDS IN SERVER FORM
  label:     text input, placeholder "My Server"
  host:      text input, placeholder "192.168.1.10"
  port:      number input, w-24 (not full width), default value 22
  username:  text input, placeholder "root"
  auth_type: select ["Password", "SSH Key"]
  password:  password input (conditional on auth_type="password")
  key_path:  text input mono (conditional on auth_type="key"), placeholder "/Users/you/.ssh/id_rsa"

## TRANSITIONS (conditional fields)
  When auth_type changes: conditional fields fade + slide (not instant).
  `transition-[opacity,max-height] duration-200 overflow-hidden`
  Hidden: `opacity-0 max-h-0`
  Visible: `opacity-100 max-h-16`

## TAILWIND
  Label:  `block text-xs font-medium text-[var(--text-muted)] mb-1`
  Input:  `w-full h-8 px-3 border border-[var(--border)] rounded bg-[var(--surface-2)] text-[var(--text)] text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 focus-visible:border-[var(--accent)] transition`
```

---

## COMPONENT 15 — Terminal Output Lines

---

```
Using the RemoteTool design system (see Foundation), design the TERMINAL OUTPUT LINE styles.
These are <span> elements appended inside a <pre> in the right output pane.

## PURPOSE
Color-coded output lines streaming from SSH command execution. Must be readable in both themes.

## LINE TYPES + COLORS

  .term-stdout  (standard command output):
    color: var(--text)   — same as normal body text
    Light: #111827   Dark: #e4e6f0

  .term-stderr  (error output, red channel):
    color: var(--danger)
    Light: #ef4444   Dark: #f87171
    Optional: subtle left border `border-l-2 border-danger pl-2`

  .term-info  (tool-generated info, e.g. "Connecting…", "$ command"):
    color: var(--accent)
    Light: #6366f1   Dark: #818cf8
    Slightly lighter weight, italic optional

  .term-success  (success messages, "Connected!", "Saved!", "exit code 0"):
    color: var(--success)
    Light: #10b981   Dark: #34d399

  ## PROMPT LINE (command echoed before output)
    "$ uptime" — displayed as .term-info, font-weight: 500
    Prefix: "$ " in text-muted, then command in accent

  ## EXIT CODE BADGE
    Inline at end of command output:
    Exit 0:  `[exit: 0]` — text-11px font-mono text-success
    Exit >0: `[exit: 2]` — text-11px font-mono text-danger

  ## SECTION SEPARATOR
    "\n" between command runs rendered as empty line, or thin hr:
    `<hr class="border-[var(--border)] my-1 opacity-50">`

## PRE ELEMENT STYLES
  white-space: pre-wrap, word-break: break-word (prevents horizontal scroll on long lines)
  line-height: 1.5, letter-spacing: 0 (mono default)
  Selectable: user-select text (user should be able to copy output)
  No scrollbar gap: `overflow-anchor: auto` for auto-scroll behavior

## SCROLLBAR
  Custom thin scrollbar:
  `::-webkit-scrollbar { width: 6px; }`
  `::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }`
  `::-webkit-scrollbar-track { background: transparent; }`

## TAILWIND (apply to pre)
  `font-mono text-xs leading-relaxed whitespace-pre-wrap break-words select-text text-[var(--text)]`
  Spans use inline color via CSS custom props or Tailwind arbitrary values:
    stdout:  (inherits pre color)
    stderr:  `text-[var(--danger)]`
    info:    `text-[var(--accent)]`
    success: `text-[var(--success)]`
```

---

---

# SECTION 4 — QUICK REFERENCE CHEATSHEET

> Paste this into any prompt for fast token lookup.

---

```
## RemoteTool Quick Token Reference

Colors (CSS vars):
  --bg | --surface | --surface-2 | --surface-hover
  --border | --border-strong
  --text | --text-muted | --text-subtle
  --accent | --accent-hover | --accent-subtle | --accent-medium
  --danger | --danger-hover | --danger-subtle
  --success | --success-subtle | --warning | --warning-subtle

Key dimensions:
  Sidebar: w-60 (240px) / w-[60px] collapsed
  Output pane: w-[380px] default, min-w-[180px] max-w-[660px]
  Mobile breakpoint: lg (1024px)

Button heights: h-7 (28px) standard | h-8 (32px) form buttons | w-7 h-7 icon-btn
Input height: h-8 (32px)
Section header: h-10 (40px)
Sidebar item: h-10 (40px)
Drawer header: h-12 (48px)
Top bar mobile: h-12 (48px)

Radii:
  rounded-sm (5px) | rounded (8px) | rounded-lg (12px) | rounded-xl (16px)

Shadows:
  shadow-xs | shadow-sm | shadow-md | shadow-lg | shadow-xl

Font sizes:
  text-[11px] labels/secondary | text-xs (12px) mono/small
  text-[13px] body | text-sm (14px) section headers | text-base (16px) titles

Animations:
  animate-spin (spinner) | animate-pulse (status dots) | transition-colors duration-150

Terminal line classes:
  .term-stdout | .term-stderr | .term-info | .term-success
```

---

*End of RemoteTool Tailwind Redesign Prompts*  
*Generated from: `server.js`, `db.js`, `public/index.html`, `public/app.js`, `public/style.css`*
