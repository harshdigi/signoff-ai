# Changelog

## 1.0.8 (3 November 2026, IST)

### New
- **Background view** (left bar). Everything the app runs, grouped: Claude sessions with the tools they start,
  terminals, tools, the app itself, and leftovers from earlier runs (only these can be stopped). Also lists every
  timer, how often it runs and whether it pauses while the window is hidden.
- **Memory per session.** Memory is the number Activity Monitor shows, compressed memory included. Each session row
  lists its tools by memory and has **Suspend**: Claude and its tools stop, the conversation stays, and sending a
  message resumes it.
- **Idle sessions suspend themselves.** A session with nothing to do for 20 minutes is suspended to free memory
  (Settings → Idle sessions; 0 = never). Never while a turn or shell command runs, while it is open on screen, or with
  unsent text in its input box. A session whose tools grew past 1 GB is suspended after 5 minutes.
- **One shared funes.** Background view → funes → Share one funes: one funes serves every session while the app is
  open, instead of one per session. Outside the app each session still runs its own. One per session again puts your
  entry back exactly.
- **Monitor tab.** Watch cards with "+ New watch", Check now, Extend and Describe; a watch can follow a change with no
  pull request, such as a merchant config change.
- **Reads-only team roles.** A role marked "Reads only (no worktree)" needs no git repo and gets no branch, so an
  oncall team of investigators can start from any folder. `signoff team propose --reads-only <role>`.

### Better
- **Battery and speed.** Background checks pause while the window is hidden. git runs when files change, not on a
  2-second timer. Long chats load their last 400 events, and transcripts are read once instead of on every request.
- **Files changed** diffs from the base the branch last left; `signoff register --base <ref>` sets it by hand.
- Menus open upward when there is no room below, and never run off the window.

### Fixed
- A nested session can be moved back to the top level ("Move to top level" is first in the ⤷ menu), and the top-level
  drop strip no longer cancels the drag.

### Upgrading from 1.0.7
- Quit the app, replace it in Applications, open it. Your data is kept. See [INSTALL.md](INSTALL.md#updating).
- The board moves from format v24 to v27 (review requests, watches without a pull request, a base per session). A copy
  of the board is saved first; nothing is removed.
- Quitting the app stops the sessions it started, as before; each resumes when you open it.

## 1.0.7 (20 October 2026, IST)

### New
- **Close ticket.** A ticket from Start ticket can be closed from its page: its plan and subtask sessions stop and
  move to Show removed; branches and worktrees stay. Reopen brings the ticket and its sessions back.
- **Delete removed sessions for good.** Each row under Show removed has Delete, and there is Delete all. Both ask
  once. It deletes the session, its chat and the decisions and reviews it posted; Claude Code's own transcript stays.
- **`signoff register --cwd <folder>`** moves a session to a repo or worktree, so a team lead that started in a parent
  folder can start its team. The move survives restarts while the folder is inside where Claude runs.

### Fixed
- Clicking Start twice on a team split no longer starts every session twice. The button shows "Starting…" meanwhile.
- A removed session is no longer started again by the app.

### Upgrading from 1.0.6
- Quit the app, replace it in Applications, open it. Your data is kept. See [INSTALL.md](INSTALL.md#updating).
- The board gains one column for closed tickets (board format v24). A copy of the board is saved first; nothing is
  removed.
- Sessions started before the update learn `register --cwd` once they restart.

## 1.0.6 (19 October 2026, IST)

### New
- **Autonomy per session.** The settings icon on the session tab bar sets how much Claude decides on its own: Ask as
  you go, Plan first then run, Full auto, or your own mix, with a "Claude | Ask me" switch per kind of decision.
  The default for new sessions is in Settings. Merges, pushes to main, deletes, production, money, secrets and
  messages to people always ask. Autonomy only applies while the Claude Code session is in Auto mode; the panel
  says when it is paused. The current mode shows in grey above the Send button.
- **Ship monitor.** From Ship: once a PR's CI is green, a "PR is up for review" message is drafted for the people
  and apps you choose (sent only if you opt in). After merge it watches the deploy to production and checks for new
  errors; on an incident it prepares a fire-fighting session with a rollback and fix plan, and ships nothing itself.
- **Story tab.** A ticket's decisions as one diagram: the question, the chosen way and the rejected options, with a
  short numbered "why" list. Update has Claude write the short text; approvals and reviews are only counted.
- **Attach any file** in the chat: the paperclip button, or drop or paste a file. Files on disk go to Claude as
  their path, with no copy and no size limit; pasted screenshots are saved as before.
- **Drag and drop sessions** in the sidebar to nest or move them.

### Fixed
- The session row's Move menu is visible again instead of being cut off by the sidebar.

### Upgrading from 1.0.5
- Quit the app, replace it in Applications, open it. Your data is kept. See [INSTALL.md](INSTALL.md#updating).
- The board gains tables and columns for the ship monitor, autonomy and stories (board format v23). A copy of the
  board is saved first; nothing is removed.
- Sessions started before the update learn the new `signoff autonomy`, `plan` and `monitor` commands once they restart.

## 1.0.5 (16 October 2026, IST)

### New
- **Tools: live check.** A refresh button next to ＋ checks every MCP server with `claude mcp list` and shows when it
  was checked. Rows say "not checked yet" until then, instead of an old saved status.
- **Nest a session under another.** ⤷ "Move under…" on a session row, or `signoff register --parent <id>` from a
  session. "Move to top level" undoes it.

### Better
- **Files changed** also lists repos a session changed through shell commands (patch, git apply, cp, git commit),
  not only files changed with Claude's Edit and Write tools.
- **Faster with very long chats.** Files changed no longer re-reads the whole transcript every few seconds, and the
  end of each Claude turn no longer reads it whole. On a 113 MB transcript this removed a freeze of about a second.

### Fixed
- A folded session row's child count is now a grey badge; orange means only "waiting on you".

### Upgrading from 1.0.4
- Quit the app, replace it in Applications, open it. Your data is kept; the board format does not change.

## 1.0.4 (15 October 2026, IST)

### Fixed
- A session no longer disappears from the Sessions list when `signoff register` runs from another folder: register
  keeps the folder the session was recorded in.

### Upgrading from 1.0.3
- Quit the app, replace it in Applications, open it. Your data is kept; the board format does not change.

## 1.0.3 (14 October 2026, IST)

### New
- **Review questions reach Claude:** a question you ask on a review file, and the result when you submit, now go
  to the session that posted the review and wake it.
- **One open review per change:** when Claude proposes again on the same ticket, its older open review closes as
  "replaced". Files whose diff is unchanged from one you accepted stay accepted.
- **Dismiss** on open review cards closes a review without submitting it. Sessions can withdraw their own stale
  review with `signoff withdraw --review R-n --reason "..."`.

### Fixed
- Top-bar menus (Run, Review, Skills, Folder) no longer close when you move the mouse onto them. The ⋯ menu on
  decision cards now closes on a click outside or Escape.
- Permission prompts that can no longer be answered from the app (older than the 10-minute hook timeout) drop out
  of the Decisions badge and the session counts.
- `signoff withdraw --ticket K --id R-n` closes the review R-n instead of failing with "no decision".

### Upgrading from 1.0.2
- Quit the app, replace it in Applications, open it. Your data is kept. See [INSTALL.md](INSTALL.md#updating).
- The board's review tables are rebuilt to allow the new "replaced" and "dismissed" states (board format v21). A
  copy of the board is saved first; nothing is removed.
- Sessions started before the update learn the new review commands once they restart.

## 1.0.2 (14 October 2026, IST)

### New
- **Voice input** in the chat: hold the mic (or ⌥Space) to talk, slide up to lock. Send or Enter stops the mic and
  sends. Apple's on-device speech only: audio never leaves the Mac. Language and auto-send in Settings.
- **Terminal menus in the chat:** when Claude Code waits on a menu, the chat shows its options as buttons instead of
  "Claude is working".
- **Decisions settled in the chat close on the board:** at the end of a turn the session is asked once to settle or
  withdraw decisions you already answered in the chat. Switch in Settings, on by default.
- **Mode, model and effort** in the composer are dropdowns that show the real values.

### Better
- New top bar (folder, branch, session, search) and left bar (icons, one header style, sessions and tickets in one
  list, two quiet lines per row). No gap in full screen.
- Tools: connected servers first, the rest folded. Run: grouped per repo.
- Chat: one folded steps row per turn, live while Claude works.
- Session page: the terminal starts from its tab; diffs open inside Files changed; files grouped per folder.
- Decision and review cards redesigned: question first, whole options clickable, evidence folded. Review files are
  folded; per file Accept, Ask for changes, Question or Drop.
- Permission prompts say your Claude session is asking, not Signoff AI.

### Fixed
- A review with several files showed as one file.

### Upgrading from 1.0.1
- Quit the app, replace it in Applications, open it. Your data is kept. See [INSTALL.md](INSTALL.md#updating).
- The board gets one new, empty column (`sessions.effort`); a copy of the board is saved first.
- The first time you use the mic, macOS asks for Microphone and Speech Recognition access.

## 1.0.1 (13 October 2026, IST)

### New
- **Later** on a decision: set it aside without losing it. It leaves "Waiting on you", shows under Decisions → Later
  and in the sidebar, and its session stops waiting for it. **Bring back** returns it.
- **Reopen** a dismissed decision from History.
- **Default mode for new chats** in Settings (Manual, Accept edits, Plan or Auto). Manual unless you change it.
- **Fold "Waiting on you"** in the chat; the count stays visible.

### Better
- Answers under "Ask about this" come as short points instead of one block.
- Code is coloured like the editor everywhere it is shown: chat, plans, flow docs, evidence on decision cards, review
  diffs, approvals, comments and hover previews.

### Safety
- Before a new version updates the board's format, the app saves a copy of the board next to it
  (`board.db.bak-v<old version>-<time>`, newest three kept). A fresh install makes none.

### Upgrading from 1.0.0
- Quit the app, replace it in Applications, open it. Your data is kept. See [INSTALL.md](INSTALL.md#updating).
- The board gets one new, empty column (`decisions.later_at`); nothing is removed.

## 1.0.0 (13 October 2026, IST)

First public pre-release.
