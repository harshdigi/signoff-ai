// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { anchorStatus, anchorsFor, docsBrief, findDocs, findFlowDocs, generatePrompt, indexDocs, parseAnchors, readDoc, reposNear, touchedDocs, verifyDocs } from '../flows'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'flows-'))
const write = (root: string, p: string, s: string): void => {
  mkdirSync(join(root, p, '..'), { recursive: true })
  writeFileSync(join(root, p), s)
}

describe('flow docs', () => {
  it('reads anchors in the Claude Docs format, with the heading they sit under', () => {
    expect(parseAnchors('ps/CLAUDE.md', '# Checkout\nConstants: `app/constants/checkout_constants.rb`.\n## Workflows\n(`app/constants/checkout_constants.rb:108-163`) and `:165`, `app/x.ts:7`')).toEqual([
      { doc: 'ps/CLAUDE.md', heading: 'Checkout', docLine: 2, file: 'app/constants/checkout_constants.rb', start: null, end: null },
      { doc: 'ps/CLAUDE.md', heading: 'Workflows', docLine: 4, file: 'app/constants/checkout_constants.rb', start: 108, end: 163 },
      { doc: 'ps/CLAUDE.md', heading: 'Workflows', docLine: 4, file: 'app/x.ts', start: 7, end: 7 }
    ])
  })

  it('indexes a docs folder (skipping scripts), finds docs touched by changed files, and flags stale anchors', () => {
    const docs = tmp()
    const repo = tmp()
    write(docs, 'orders/CLAUDE.md', '# Orders\n`app/models/order.rb:2`\n`app/models/quote.rb:40`\n')
    write(docs, 'billing/CLAUDE.md', '# Billing\n`app/models/billing.rb`\n')
    write(docs, 'scripts/readme.md', '`app/models/order.rb:1`')
    write(repo, 'app/models/order.rb', 'a\nb\nc\n')
    write(repo, 'app/models/quote.rb', 'a\n')
    const { anchors, docs: list } = indexDocs(docs)
    expect(list).toEqual(['billing/CLAUDE.md', 'orders/CLAUDE.md'])
    expect(touchedDocs(anchors, ['app/models/order.rb', 'app/models/quote.rb', 'README.md'])).toEqual([{ doc: 'orders/CLAUDE.md', headings: ['Orders'], files: ['app/models/order.rb', 'app/models/quote.rb'] }])
    expect(anchorsFor(anchors, 'app/models/billing.rb').map((a) => a.doc)).toEqual(['billing/CLAUDE.md'])
    expect(anchors.map((a) => [a.file, anchorStatus(a, repo)])).toEqual([['app/models/billing.rb', 'elsewhere'], ['app/models/order.rb', 'ok'], ['app/models/quote.rb', 'stale']])
  })

  it('reads only Markdown inside the docs folder', () => {
    const docs = tmp()
    write(docs, 'a/CLAUDE.md', 'hi')
    expect(readDoc(docs, 'a/CLAUDE.md')).toBe('hi')
    expect(() => readDoc(docs, '../../etc/passwd')).toThrow('not a doc in the flow docs folder')
    expect(indexDocs('')).toEqual({ anchors: [], docs: [] })
  })

  it('finds the flow docs folder of a workspace: Claude Docs inside or next to it, else a docs folder inside', () => {
    const anchored = (root: string): void => {
      write(root, 'CLAUDE.md', '# Index')
      write(root, 'orders/CLAUDE.md', '# Orders\n## Orders\n' + Array.from({ length: 10 }, (_, i) => `- step \`app/models/order.rb:${i + 1}\``).join('\n'))
    }
    const ws = tmp()
    mkdirSync(join(ws, 'repo', '.git'), { recursive: true })
    write(ws, 'notes/CLAUDE.md', '# just notes, no anchors')
    expect(findFlowDocs(ws)).toBeNull()
    anchored(join(ws, 'product-docs'))
    expect(findFlowDocs(ws)).toBe(join(ws, 'product-docs'))
    anchored(join(ws, 'Claude Docs'))
    expect(findFlowDocs(ws)).toBe(join(ws, 'Claude Docs'))
    expect(findFlowDocs(join(ws, 'repo'))).toBe(join(ws, 'Claude Docs')) // opened a repo next to it
  })

  it('finds docs by name or heading, and briefs a session on using them first', () => {
    const docs = tmp()
    write(docs, 'orders/CLAUDE.md', '# Orders\n## Order quote\n`app/models/order.rb:3`')
    write(docs, 'billing/CLAUDE.md', '# Billing\n`app/models/billing.rb`')
    expect(findDocs(docs, ['order', 'QUOTE'])).toEqual([{ doc: 'orders/CLAUDE.md', headings: ['Order quote'] }])
    expect(findDocs(docs, ['billing'])).toEqual([{ doc: 'billing/CLAUDE.md', headings: ['Billing'] }])
    expect(findDocs(docs, [])).toEqual([])
    const brief = docsBrief(docs)
    expect(brief[0]).toBe(`## Flow docs: ${docs.split('/').pop()} (${docs})`)
    expect(brief).toContain('- If no doc covers it, say so in one line and continue as you normally would.')
    expect(brief.slice(-3)).toEqual(['Docs (2):', '  billing/CLAUDE.md', '  orders/CLAUDE.md'])
    expect(docsBrief(tmp())).toEqual([])
  })

  it('verifies anchors against the repos next to the docs folder, with or without a repo prefix', () => {
    const ws = tmp()
    mkdirSync(join(ws, 'api', '.git'), { recursive: true })
    mkdirSync(join(ws, 'web', '.git'), { recursive: true })
    write(ws, 'api/app/order.rb', 'a\nb\nc\n')
    write(ws, 'web/src/page.tsx', 'x\n')
    write(ws, 'Claude Docs/orders/CLAUDE.md', '# Orders\n`app/order.rb:2`\n`app/order.rb:40-41`\n`web/src/page.tsx:1`\n`app/gone.rb`\n')
    const docs = join(ws, 'Claude Docs')
    expect(reposNear(docs).sort()).toEqual([join(ws, 'api'), join(ws, 'web')])
    expect(verifyDocs(docs)).toEqual({ checked: 4, skipped: 0, broken: [
      { doc: 'orders/CLAUDE.md', docLine: 3, anchor: 'app/order.rb:40-41', problem: 'line past the end' },
      { doc: 'orders/CLAUDE.md', docLine: 5, anchor: 'app/gone.rb', problem: 'missing file' }
    ] })
    // docs-meta.json with repo paths and prefixes: checked there; anchors under no prefix are skipped, not failed.
    write(ws, 'base/app/order.rb', 'a\n'.repeat(50))
    write(ws, 'Claude Docs/docs-meta.json', JSON.stringify({ repos: { api: { path: join(ws, 'base'), prefixes: ['app/'] } } }))
    expect(verifyDocs(docs)).toEqual({ checked: 3, skipped: 1, broken: [{ doc: 'orders/CLAUDE.md', docLine: 5, anchor: 'app/gone.rb', problem: 'missing file' }] })
  })

  it('the generate prompt points at the guide, the repos and the target, and asks before writing', () => {
    const p = generatePrompt({ folder: '/w', target: '/w/Claude Docs', guide: '/app/flow-docs-guide.md', repos: ['/w/api', '/w/web'] })
    expect(p.split('\n').slice(0, 3)).toEqual(['Write flow docs for the code in /w, into /w/Claude Docs.', 'Read the house style first and follow it exactly: /app/flow-docs-guide.md', 'Repos to cover: api, web.'])
    expect(p).toContain('Before writing anything, post that list as one decision so the user picks')
    expect(p).toContain('Do not change any code in the repos. Write only inside the docs folder.')
  })
})

