// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from 'vitest'
import { allowedPermission, checkClaudeArgs, externalAllowed, isAppUrl } from '../security-rules'

const page = { rendererDir: '/Applications/Signoff AI.app/Contents/Resources/app.asar/out/renderer' }

describe('security rules', () => {
  it("only the app's own page counts as the app", () => {
    expect(isAppUrl('file:///Applications/Signoff%20AI.app/Contents/Resources/app.asar/out/renderer/index.html#x', page)).toBe(true)
    expect(isAppUrl('file:///Applications/Signoff%20AI.app/Contents/Resources/app.asar/out/rendererX/evil.html', page)).toBe(false)
    expect(isAppUrl('file:///etc/passwd', page)).toBe(false)
    expect(isAppUrl('https://evil.example/', page)).toBe(false)
    expect(isAppUrl(undefined, page)).toBe(false)
    expect(isAppUrl('not a url', page)).toBe(false)
    const dev = { ...page, devUrl: 'http://localhost:5173' }
    expect(isAppUrl('http://localhost:5173/', dev)).toBe(true)
    expect(isAppUrl('http://localhost:5174/', dev)).toBe(false)
  })

  it('links leave the app only for the web and email', () => {
    for (const u of ['https://claude.ai/x', 'http://localhost:3000', 'mailto:a@b.co']) expect([u, externalAllowed(u)]).toEqual([u, true])
    for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'vscode://file/x', 'x-apple.systempreferences:', 'decision-ide://run?skill=x', 'smb://host/share', 'nonsense'])
      expect([u, externalAllowed(u)]).toEqual([u, false])
  })

  it('the page may only write to the clipboard', () => {
    expect(allowedPermission('clipboard-sanitized-write')).toBe(true)
    for (const p of ['media', 'geolocation', 'notifications', 'openExternal', 'display-capture', 'clipboard-read']) expect([p, allowedPermission(p)]).toEqual([p, false])
  })

  it('claude never starts with a permission-skipping flag or mode', () => {
    expect(() => checkClaudeArgs(['--plugin-dir', 'x', '--permission-mode', 'plan'])).not.toThrow()
    expect(() => checkClaudeArgs(['--dangerously-skip-permissions'])).toThrow('refused to start claude with --dangerously-skip-permissions')
    expect(() => checkClaudeArgs(['--allow-dangerously-skip-permissions'])).toThrow('refused to start claude with --allow-dangerously-skip-permissions')
    expect(() => checkClaudeArgs(['--permission-mode', 'bypassPermissions'])).toThrow('refused to start claude in permission mode bypassPermissions')
  })
})
