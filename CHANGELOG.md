# Changelog

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
