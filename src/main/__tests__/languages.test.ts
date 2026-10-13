// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from 'vitest'
import { fenceLanguage, fencedLanguage, languageOf } from '../../renderer/src/ide/languages'

describe('code block languages', () => {
  it('a fence names a Monaco language by id, extension or shell alias; anything else stays uncoloured', () => {
    expect(['ruby', 'rb', 'ts', 'TypeScript', 'bash', 'sql', 'diff', 'text', ''].map(fenceLanguage))
      .toEqual(['ruby', 'ruby', 'typescript', 'typescript', 'shell', 'sql', null, null, null])
  })

  it('react-markdown gives a fenced block "language-<fence>"; inline code has no class', () => {
    expect([fencedLanguage('language-ruby'), fencedLanguage(undefined), fencedLanguage('')]).toEqual(['ruby', null, null])
  })

  it('languageOf by file name is unchanged by the move', () => {
    expect(['app/models/order.rb', 'Gemfile', 'x.unknown'].map(languageOf)).toEqual(['ruby', 'ruby', 'plaintext'])
  })
})
