# Changelog

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
