// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
// Which inline code spans are worth turning into links: things that name a file or a definition.
// - paths with a code extension, optionally :line or :from-to
// - Foo::Bar, Foo#bar, Foo.bar, CamelCaseNames, ALL_CAPS_CONSTANTS, snake_case_names (with an underscore)
// Plain words (`eu`, `true`, `OK`) and anything with spaces stay plain code.
const PATH = /^[\w./-]+\.(?:rb|rake|erb|py|js|jsx|mjs|cjs|ts|tsx|go|java|kt|swift|sql|sh|yml|yaml|json|md|css|scss|html)(?::\d+(?:-\d+)?)?$/
const QUALIFIED = /^[A-Z]\w*(?:::[A-Z]\w*)*(?:(?:::|#|\.)[A-Za-z_]\w*[?!]?)$/
const CAMEL = /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$/
const CONSTANT = /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/
const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+[?!]?$/

export function looksLikeRef(s: string): boolean {
  const t = s.trim()
  if (!t || /\s/.test(t) || t.length > 160) return false
  return PATH.test(t) || QUALIFIED.test(t) || CAMEL.test(t) || CONSTANT.test(t) || SNAKE.test(t)
}

// The lines a hover shows: a few before the line, more after, numbered.
export function around(text: string, line: number, before = 3, after = 12): { n: number; text: string }[] {
  const lines = text.split('\n')
  const from = Math.max(1, line - before)
  const to = Math.min(lines.length, line + after)
  return lines.slice(from - 1, to).map((t, i) => ({ n: from + i, text: t }))
}
