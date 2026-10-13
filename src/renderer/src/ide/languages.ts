// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2

// Monaco language ids by file extension, and for the language named on a Markdown code fence (```ruby).
const BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', md: 'markdown', css: 'css', scss: 'scss', html: 'html', erb: 'html', rb: 'ruby', rake: 'ruby',
  py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', sql: 'sql', sh: 'shell',
  yml: 'yaml', yaml: 'yaml', xml: 'xml', php: 'php', cs: 'csharp', c: 'c', h: 'c', cpp: 'cpp', dockerfile: 'dockerfile'
}

export function languageOf(path: string): string {
  const name = path.split('/').pop()!.toLowerCase()
  if (name === 'gemfile' || name === 'rakefile') return 'ruby'
  if (name === 'dockerfile') return 'dockerfile'
  return BY_EXT[name.split('.').pop() || ''] || 'plaintext'
}

const KNOWN = new Set(Object.values(BY_EXT))
const ALIASES: Record<string, string> = { bash: 'shell', zsh: 'shell', console: 'shell' }

// The fence's language as a Monaco id, or null when it names none Monaco colours (the block then stays one colour).
export function fenceLanguage(fence: string): string | null {
  const f = fence.trim().toLowerCase()
  if (ALIASES[f]) return ALIASES[f]
  if (KNOWN.has(f)) return f
  return BY_EXT[f] ?? null
}

// react-markdown marks a fenced block's language as class "language-<fence>"; inline code has none.
export function fencedLanguage(className: string | undefined): string | null {
  return /language-(\S+)/.exec(className ?? '')?.[1] ?? null
}
