// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { fenceLanguage, fencedLanguage } from './languages'
import { useColoredLines } from './use-colored-lines'

// Code anywhere in the app (chat, cards, plans, approvals, comments, previews) coloured like the editor.
// - Monaco escapes the code it colours, so its HTML carries no markup from the code.
// - Shows the plain text until the colours are ready, when the language is unknown, and if colouring fails.

// One coloured line, or its plain text while there is no colour.
export function CodeLine({ html, text }: { html: string | null | undefined; text: string }): React.JSX.Element {
  return html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <>{text || ' '}</>
}

// A <pre> of code in one language.
export function CodePre({ code, language, className }: { code: string; language: string | null; className?: string }): React.JSX.Element {
  const lines = code.split('\n')
  const html = useColoredLines(lines, language)
  return <pre className={className}>{lines.map((l, i) => <div key={i}><CodeLine html={html?.[i]} text={l} /></div>)}</pre>
}

// A unified diff: rows keep their add/remove/hunk background, the code in them is coloured by the file's language.
const diffRow = (l: string): string => /^(\+\+\+|---|diff |index |#\s)/.test(l) ? 'dl-head' : l.startsWith('@@') ? 'dl-hunk' : l.startsWith('+') ? 'dl-add' : l.startsWith('-') ? 'dl-del' : ''
export function CodeDiff({ diff, language, className = 'diff' }: { diff: string; language: string | null; className?: string }): React.JSX.Element {
  const rows = diff.split('\n')
  const isCode = (l: string): boolean => !['dl-head', 'dl-hunk'].includes(diffRow(l))
  const code = rows.filter(isCode)
  const html = useColoredLines(code.map((l) => l.slice(1)), language)
  let k = 0
  return <pre className={className}>{rows.map((l, i) => {
    if (!isCode(l)) return <div key={i} className={diffRow(l)}>{l || ' '}</div>
    const h = html?.[k++]
    return <div key={i} className={diffRow(l)}>{l.slice(0, 1) || ' '}<CodeLine html={h} text={l.slice(1)} /></div>
  })}</pre>
}

// A fenced code block in Markdown. The language comes from the fence (```ruby).
export function CodeBlock({ code, fence }: { code: string; fence: string }): React.JSX.Element {
  const lines = code.split('\n')
  const html = useColoredLines(lines, fenceLanguage(fence))
  return html ? <code className="hl">{lines.map((l, i) => <span key={i}><CodeLine html={html[i]} text={l} />{i < lines.length - 1 ? '\n' : ''}</span>)}</code> : <code>{code}</code>
}

// react-markdown's code renderer: fenced blocks with a language are coloured; inline code and the rest unchanged.
export function MdCode({ className, children }: { className?: string; children?: React.ReactNode }): React.JSX.Element {
  const fence = fencedLanguage(className)
  return fence ? <CodeBlock code={String(children).replace(/\n$/, '')} fence={fence} /> : <code className={className}>{children}</code>
}
