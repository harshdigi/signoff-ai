// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openStore, type Store } from '../store'
import { touchSession } from '../../shared/board'
import { saveSetup, startMonitor } from '../../shared/monitors'
import { checkErrors, errorTool, fullTool, parseVerdict } from '../monitor-errors'

const REPO = 'acme/shop'
let db: Store
const found = { messaging: [], ci: { provider: 'GitHub Actions', prChecks: [], mainWorkflows: [] }, deploy: { workflow: null, trigger: 'manual', postDeploy: null }, notes: [],
  errors: [{ app: 'Scout', mcp: 'scout', tools: ['query_logs', 'mcp__scout__query_traces'], services: ['shop-api', 'shop-worker'], needs: [] }, { app: 'Sentry', mcp: 'claude.ai Sentry', tools: ['issues'], services: ['shop'], needs: [] }] }
beforeEach(() => {
  db = openStore(join(mkdtempSync(join(tmpdir(), 'errors-')), 'board.db'))
  touchSession(db, 's', {})
})

describe('error checks', () => {
  it('names tools as Claude Code does, and uses your chosen tool and services, else the first found', () => {
    expect(fullTool('claude.ai Sentry', 'issues')).toBe('mcp__claude_ai_Sentry__issues')
    expect(errorTool(db, REPO)).toBeNull()
    saveSetup(db, REPO, { found, foundAt: 't', chosen: null })
    expect(errorTool(db, REPO)).toEqual({ app: 'Scout', mcp: 'scout', tools: ['mcp__scout__query_logs', 'mcp__scout__query_traces'], services: ['shop-api', 'shop-worker'] })
    saveSetup(db, REPO, { found, foundAt: 't', chosen: { errors: { app: 'Sentry', services: [] } } })
    expect(errorTool(db, REPO)?.tools).toEqual(['mcp__claude_ai_Sentry__issues'])
  })

  it('runs with only the read tools allowed and reads the verdict; a missing one is an error', async () => {
    saveSetup(db, REPO, { found, foundAt: 't', chosen: null })
    const m = startMonitor(db, { session: 's', repo: REPO, pr: 7, windowMinutes: 60, checkMinutes: 15 })
    let args: string[] = []
    const v = await checkErrors(db, { ...m, deployed_at: '2026-10-17T10:00:00Z' }, async (a) => { args = a; return { code: 0, out: '<verdict>{"newErrors":false,"summary":"quiet","evidence":[]}</verdict>' } }, '2026-10-17T10:15:00Z')
    expect(v).toEqual({ newErrors: false, summary: 'quiet', evidence: [] })
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__scout__query_logs,mcp__scout__query_traces')
    expect(args[1]).toContain('deployed at 2026-10-17T10:00:00Z')
    expect(() => parseVerdict('looks fine')).toThrow('the error check did not return a verdict')
    expect(() => parseVerdict('<verdict>{"newErrors":"no"}</verdict>')).toThrow('the error check verdict is incomplete')
  })
})
