// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'

// One-shot headless Claude runs (claude -p): Siri's `signoff ask`, the monitor's setup check and error checks.
// - Nobody is there to approve anything: permission prompts are off, so only actions that need no approval run.
// - Hooks are off for the run (disableAllHooks): a Stop hook that blocks would make Claude answer the hook instead.

// claude from PATH; Shortcuts runs scripts with a short PATH, so also try where the official installer puts it.
export function findClaude(path = process.env.PATH ?? '', home = homedir()): string | null {
  for (const d of [...path.split(delimiter), join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'])
    if (d && existsSync(join(d, 'claude'))) return join(d, 'claude')
  return null
}

export function headlessArgs(prompt: string, o: { system?: string; addDirs?: string[]; allow?: string[]; disallow?: string[]; model?: string } = {}): string[] {
  return ['-p', prompt, '--output-format', 'text', '--permission-prompts', 'none', '--settings', JSON.stringify({ disableAllHooks: true }),
    ...(o.system ? ['--append-system-prompt', o.system] : []), ...(o.addDirs ?? []).flatMap((d) => ['--add-dir', d]),
    ...(o.allow?.length ? ['--allowedTools', o.allow.join(',')] : []), ...(o.disallow?.length ? ['--disallowedTools', o.disallow.join(',')] : []), ...(o.model ? ['--model', o.model] : [])]
}

// Runs without blocking the caller (the app's main process must stay responsive while Claude works).
export function runHeadless(args: string[], o: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number }): Promise<{ code: number; out: string }> {
  const claude = findClaude()
  if (!claude) return Promise.resolve({ code: 1, out: 'Claude Code is not installed. Open Signoff AI and finish Setup.' })
  return new Promise((resolve) => {
    execFile(claude, args, { cwd: o.cwd, env: o.env ?? process.env, timeout: o.timeoutMs, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0
      resolve({ code, out: (stdout || stderr || (err ? err.message : '')).trim() })
    })
  })
}
