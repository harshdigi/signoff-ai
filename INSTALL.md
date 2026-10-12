# Installing Signoff AI (macOS)

Signoff AI is a desktop app on top of Claude Code. You chat with Claude, review its changes file by file,
and answer its decisions in one window instead of a terminal.

## What you need

- A Mac with macOS 13 or newer (Apple Silicon or Intel).
- A Claude plan that includes Claude Code: Pro, Max, Team, Enterprise, or a Console account. The free plan does not.
- About 550 MB of disk space (the download is 235 MB).

You do not need to install Claude Code, Node or anything else first. The app sets that up.

## Install

1. Open `decision-ide-1.0.0.dmg`.
2. Drag **Signoff AI** onto **Applications**.
3. Eject the disk image.

## First launch (one-time "Open Anyway")

The app is not signed with an Apple Developer ID yet, so macOS blocks it the first time.

1. Open **Signoff AI** from Applications. macOS says it cannot verify the app. Click **Done** (or **Cancel**).
2. Open **System Settings → Privacy & Security**.
3. Scroll down to the message about Signoff AI and click **Open Anyway**. Confirm with your password or Touch ID.
4. Open the app again and click **Open**.

After that it opens normally. On macOS 14 and older you can instead right-click the app and choose **Open**.

## Setup inside the app

On first start a short Setup screen checks four things. Each has a button:

1. **Claude Code**: installs it with Anthropic's official installer (you can watch it in the terminal panel).
2. **Sign in**: Claude Code's own sign-in opens in your browser. The app never sees your login.
3. **git**: on a Mac this installs Apple's Command Line Tools if git is missing.
4. **tmux**: chats run in tmux, so a chat can also be opened in Terminal. Installs it with Homebrew; if you have no
   Homebrew, it installs Homebrew first (it asks for your Mac password in the terminal panel).

Then click **Open Folder…** and pick a project. The app asks once whether you trust that folder
(Claude can run code from it).

## Where your data lives

Everything stays on your Mac: `~/Library/Application Support/decision-ide/`.
Your Claude Code login and settings stay in Claude Code's own files; the app does not change them.

## Updating

There is no auto-update yet. When you get a newer `.dmg`, drag the new app onto Applications and replace the old one.
Your data is kept.

## Uninstall

1. Drag **Signoff AI** from Applications to the Trash.
2. To remove its data too: delete `~/Library/Application Support/decision-ide/`.

## If something goes wrong

- **"Claude Code not found" after installing it**: click **Check again** on the Setup screen. If it still fails,
  quit and reopen the app.
- **A chat says it could not start claude, or that tmux is not installed**: open the command palette (⇧⌘P) → **Setup** and check all four items are green.
- **Terminal tabs stay blank**: quit and reopen the app; if it persists, send the person who shared the app a screenshot.
