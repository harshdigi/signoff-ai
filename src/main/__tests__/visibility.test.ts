// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it, vi } from 'vitest'
import { onBack, onScreen, setOnScreen } from '../visibility'

// SIGNOFF-38-PERF/D5: background checks pause while the window is off screen.
describe('window visibility', () => {
  it('counts as on screen until the page says otherwise', () => {
    expect(onScreen()).toBe(true)
  })

  it('runs the back listeners once when the window returns, not when it leaves', () => {
    const l = vi.fn()
    const off = onBack(l)
    setOnScreen(false)
    expect(onScreen()).toBe(false)
    expect(l).not.toHaveBeenCalled()
    setOnScreen(false)
    setOnScreen(true)
    setOnScreen(true)
    expect(onScreen()).toBe(true)
    expect(l).toHaveBeenCalledTimes(1)
    off()
    setOnScreen(false)
    setOnScreen(true)
    expect(l).toHaveBeenCalledTimes(1)
  })
})
