// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// A button with a dropdown under it. The one way menus open and close in the app:
// - opens and closes on its button; stays open while the mouse moves to it or away;
// - closes on a pick (a row that is not a heading or greyed out), a click outside, Escape, leaving the window,
//   or the page scrolling or resizing under it;
// - drawn on top of the page (a portal at the button's position), so a row or panel that clips its overflow, such as
//   a session row, cannot hide it; near the bottom of the window it opens upward.
export function Menu({ trigger, align = 'left', className = '', children }: {
  trigger: (m: { open: boolean; toggle: () => void }) => ReactNode
  align?: 'left' | 'right'
  className?: string
  children: ReactNode
}): React.JSX.Element {
  const [at, setAt] = useState<CSSProperties | null>(null)
  const [box, setBox] = useState<HTMLSpanElement | null>(null) // state, not a ref: the button's place is read in its click handler
  const drop = useRef<HTMLDivElement>(null)
  const open = !!at
  useEffect(() => {
    if (!open) return
    const close = (): void => setAt(null)
    const inside = (t: EventTarget | null): boolean => !!t && (!!box?.contains(t as Node) || !!drop.current?.contains(t as Node))
    const outside = (e: MouseEvent): void => { if (!inside(e.target)) close() }
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') close() }
    const scrolled = (e: Event): void => { if (!drop.current?.contains(e.target as Node)) close() }
    document.addEventListener('mousedown', outside, true)
    document.addEventListener('keydown', esc)
    document.addEventListener('scroll', scrolled, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', outside, true)
      document.removeEventListener('keydown', esc)
      document.removeEventListener('scroll', scrolled, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [open, box])
  const toggle = (): void => {
    if (open || !box) return setAt(null)
    const r = box.getBoundingClientRect()
    // Opens upward when the button is low in the window and there is more room above; either way it is no taller than
    // that room (it scrolls), so no row ends up off-screen.
    const below = window.innerHeight - r.bottom - 12
    const above = r.top - 12
    const up = below < 240 && above > below
    const v: CSSProperties = up ? { bottom: window.innerHeight - r.top + 4, top: 'auto', maxHeight: Math.min(above, window.innerHeight * 0.6) } : { top: r.bottom + 4, maxHeight: Math.min(below, window.innerHeight * 0.6) }
    setAt({ ...v, ...(align === 'right' ? { right: window.innerWidth - r.right } : { left: r.left }) })
  }
  const picked = (e: React.MouseEvent): void => {
    const row = (e.target as HTMLElement).closest('.dropdown > div')
    if (row && !row.classList.contains('dd-head') && !row.classList.contains('off')) setAt(null)
  }
  return (
    <span ref={setBox} className={className}>
      {trigger({ open, toggle })}
      {at && createPortal(<div ref={drop} className="dropdown floating" style={at} onClick={picked} onMouseDown={(e) => e.stopPropagation()}>{children}</div>, document.body)}
    </span>
  )
}
