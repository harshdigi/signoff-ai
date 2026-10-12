// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { readFileSync } from 'fs'
import { join } from 'path'
import type { Settings } from './settings'

// How the app starts claude so the session follows the decision protocol (IDE/D7).
// - The user's own Claude config is never touched: everything is per session, by flag and env.
// - --plugin-dir loads resources/decision-protocol: hooks plus decide on the Bash PATH.
// - --append-system-prompt carries resources/protocol.md, the user's profile (IDE/D16 A) and their preferences.
// - Read at each start, so a saved setting applies to the next session.
export type ClaudeLaunch = { args: string[]; env: Record<string, string> }

// addDirs: nearby folders whose skills should load at start (skilldirs.ts), each passed as --add-dir.
// The rules a session gets: the protocol, the user's profile, the ticket rule and their preferences.
// - Sessions the app starts get them as a system prompt; sessions in your own terminal, from the startup hook.
export function protocolParts(resources: string, settings: Settings): string[] {
  return [
    readFileSync(join(resources, 'protocol.md'), 'utf8'),
    readFileSync(join(resources, 'profiles', `${settings.profile}.md`), 'utf8'),
    // Setting askTicket (default on): with no ticket, Claude asks whether to create one instead of inventing a key.
    ...(settings.askTicket ? [readFileSync(join(resources, 'tickets-ask.md'), 'utf8')] : []),
    ...(settings.preferences.trim() ? [`## The user's preferences\n${settings.preferences.trim()}\n`] : [])
  ]
}

export function protocolLaunch(p: { resources: string; cli: string; db: string; node: string; settings: Settings; addDirs?: string[] }): ClaudeLaunch {
  return {
    args: ['--plugin-dir', join(p.resources, 'decision-protocol'), '--append-system-prompt', protocolParts(p.resources, p.settings).join('\n'), ...(p.addDirs ?? []).flatMap((d) => ['--add-dir', d])],
    // DECISION_IDE_APP: marks sessions the app started, so the global terminal hooks (--terminal) stay out of them.
    env: { DECISION_IDE_DB: p.db, DECISION_IDE_CLI: p.cli, DECISION_IDE_NODE: p.node, DECISION_IDE_APP: '1' }
  }
}
