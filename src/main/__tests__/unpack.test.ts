// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from 'vitest'
import { unpack } from '../../renderer/src/board/unpack'

// Real one-line questions from before decisions had a context field.
describe('unpacking one-line questions', () => {
  it('splits "question? point; point. point" into the question and its points', () => {
    const u = unpack("Commit point 7 (session status)? Checkout::OrderStatus (created, verifying, verified, paid, refund_claimed, completed, expired incl. unswept, failed); InviteLinkType.target_status uses it; GET /api/v1/orders/:id for the shop or the order's customer, else 404 (new OrderStatusSerializer: id, status, failure_reason, expires_at, created_at); GET /api/v1/invite-links/:id/sessions (creator only, paginated, newest first). Failure message moved to Order#failure_message and reused by the public serializer (its spec unchanged and green). Regression: 2483 examples, only the 13 failures also present on main 356483a09. RuboCop clean. No push.")
    expect(u.lead).toBe('Commit point 7 (session status)?')
    expect(u.points).toEqual(expect.arrayContaining(['RuboCop clean', 'No push']))
    expect(u.points.length).toBeGreaterThanOrEqual(6)
  })

  it('splits numbered "(1) (2)" parts, and leaves a short question alone', () => {
    expect(unpack("Point 7 (session status, D13). (1) Checkout::OrderStatus: created | verifying | verified | paid | refund_claimed (bank path) | completed | expired (incl. past expires_at not yet swept) | failed. (2) InviteLinkType.target_status uses it. (3) GET /api/v1/orders/:id: shop or the order's customer only, else 404; returns id, status, failure_reason, expires_at, created_at. Gap found: partners can't get session ids (link response only has openings_count). Add GET /api/v1/invite-links/:id/sessions (creator only, paginated: session_id, status, created_at)?").points.length).toBe(3)
    expect(unpack('Use the existing error?')).toEqual({ lead: 'Use the existing error?', points: [] })
  })
})
