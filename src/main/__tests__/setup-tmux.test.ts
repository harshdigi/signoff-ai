// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from 'vitest'
import { tmuxInstall } from '../setup'

describe('installing tmux from Setup', () => {
  it('uses Homebrew on a Mac, installing Homebrew first when it is missing; elsewhere points to the guide', () => {
    expect(tmuxInstall('darwin', true)).toEqual({ command: 'brew install tmux', url: 'https://github.com/tmux/tmux/wiki/Installing' })
    expect(tmuxInstall('darwin', false).command).toMatch(/^\/bin\/bash -c "\$\(curl -fsSL https:\/\/raw\.githubusercontent\.com\/Homebrew\/install\/HEAD\/install\.sh\)" && .+ install tmux$/)
    expect(tmuxInstall('linux', false)).toEqual({ command: null, url: 'https://github.com/tmux/tmux/wiki/Installing' })
  })
})
