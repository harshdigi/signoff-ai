// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { app } from 'electron'
import { join } from 'path'

// Where the app's runnable files are. In a packaged app they sit outside the asar archive
// (electron-builder asarUnpack), because Claude Code runs them as ordinary files.
export function appFiles(): { resources: string; cli: string } {
  const base = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked') : app.getAppPath()
  return { resources: join(base, 'resources'), cli: join(base, 'out/cli/decide.cjs') }
}

// One data folder for dev and packaged builds (~/Library/Application Support/decision-ide on macOS),
// so renaming the app ("Signoff AI") does not start an empty board. decide uses the same folder.
export function pinUserData(): void {
  app.setPath('userData', join(app.getPath('appData'), 'decision-ide'))
}
