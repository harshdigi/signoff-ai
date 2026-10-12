// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'
import { skillDirs } from '../main/skilldirs'

// signoff ask: one spoken-style answer from Claude, for Siri (a Shortcut's "Run Shell Script" reads it out).
// - Runs your own claude, headless, in your project folder, with your skills (and nearby folders' skills).
// - Nobody is there to approve anything: permission prompts are off, so only actions that need no approval run
//   (reading files, your allowed tools). Nothing is edited and no decisions are posted.
// - Your hooks are off for this one run (disableAllHooks): a Stop hook that blocks (e.g. a docs check) would
//   otherwise make Claude answer the hook instead of your question.
const VOICE = [
  'You are answering a question the user asked by voice (Siri). They will hear your answer, not read it.',
  'Answer in a few short, plain sentences. No markdown, no tables, no code, no file paths unless asked.',
  'Do not edit files, post decisions or start long tasks. If you cannot answer without that, say so in one sentence.'
].join('\n')

// claude from PATH; Shortcuts runs scripts with a short PATH, so also try where the official installer puts it.
export function findClaude(path = process.env.PATH ?? '', home = homedir()): string | null {
  for (const d of [...path.split(delimiter), join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'])
    if (d && existsSync(join(d, 'claude'))) return join(d, 'claude')
  return null
}

export function askArgs(question: string, skill: string | undefined, addDirs: string[]): string[] {
  const prompt = skill ? `/${skill} ${question}`.trim() : question
  return ['-p', prompt, '--output-format', 'text', '--permission-prompts', 'none', '--settings', JSON.stringify({ disableAllHooks: true }),
    '--append-system-prompt', VOICE, ...addDirs.flatMap((d) => ['--add-dir', d])]
}

export function runAsk(question: string, o: { skill?: string; folder: string | null; model?: string; db: string }): { code: number; out: string } {
  const claude = findClaude()
  if (!claude) return { code: 1, out: 'Claude Code is not installed. Open Signoff AI and finish Setup.' }
  if (!o.folder) return { code: 1, out: 'No project folder yet. Open one in Signoff AI first.' }
  // Marked like the app's own sessions, so board hooks (the app's --terminal ones, the prototype's) stay out of it.
  const env = { ...process.env, DECISION_IDE_DB: o.db, DECISION_IDE_APP: '1' }
  const args = [...askArgs(question, o.skill, skillDirs(o.folder).dirs), ...(o.model ? ['--model', o.model] : [])]
  const r = spawnSync(claude, args, { cwd: o.folder, encoding: 'utf8', timeout: 180_000, env })
  if (r.error) return { code: 1, out: `Claude did not answer: ${r.error.message}` }
  return { code: r.status ?? 1, out: (r.stdout || r.stderr || '').trim() }
}
