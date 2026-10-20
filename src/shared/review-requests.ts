// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { now } from './board'
import type { Store } from '../main/store'

// Review requests per pull request (SIGNOFF-31/D14), kept across restarts and monitors:
// - sent: the app posted it; found: it was already in Slack (Check Slack, or the send run's search);
// - approved: a reply in its thread approved the PR, or the PR was approved on GitHub (app 'GitHub').
// An approved request stays approved: a later sent or found does not take that back.
export type RequestState = 'sent' | 'found' | 'approved'
export type ReviewRequest = { repo: string; pr: number; app: string; place: string; state: RequestState; message: string | null; by: string | null; at: string }

export function recordRequest(db: Store, r: { repo: string; pr: number; app: string; place: string; state: RequestState; message?: string | null; by?: string | null }): void {
  db.prepare(`INSERT INTO review_requests (repo, pr, app, place, state, message, by, at) VALUES (@repo, @pr, @app, @place, @state, @message, @by, @at)
    ON CONFLICT(repo, pr, app, place) DO UPDATE SET
      state = CASE WHEN review_requests.state = 'approved' THEN 'approved' ELSE excluded.state END,
      message = COALESCE(excluded.message, review_requests.message),
      by = COALESCE(excluded.by, review_requests.by),
      at = CASE WHEN review_requests.state = 'approved' THEN review_requests.at ELSE excluded.at END`)
    .run({ ...r, place: r.place.trim(), message: r.message ?? null, by: r.by ?? null, at: now() })
}

export const requestsOf = (db: Store, repo: string, pr: number): ReviewRequest[] =>
  db.prepare('SELECT * FROM review_requests WHERE repo = ? AND pr = ? ORDER BY at').all(repo, pr) as ReviewRequest[]
