// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { openStore } from '../../main/store'
import { answerApproval, pendingApprovals } from '../../shared/approvals'
import { touchSession } from '../../shared/board'

// signoff mcp end to end: an MCP client calls `approve` the way Claude Code does, the "window" answers in the store.
const CLI = join(__dirname, '../../../out/cli/decide.cjs')

describe('signoff mcp', () => {
  it('blocks the approve call until the user answers, then returns the answer as text JSON', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'mcp-')), 'board.db')
    const db = openStore(dbPath)
    touchSession(db, 'chat-1', {})
    const transport = new StdioClientTransport({ command: 'node', args: [CLI, 'mcp'], env: { PATH: process.env.PATH!, DECISION_IDE_DB: dbPath, DECISION_IDE_SESSION: 'chat-1' } })
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(transport)
    try {
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual(['approve'])
      const call = client.callTool({ name: 'approve', arguments: { tool_name: 'Bash', input: { command: 'ls' }, tool_use_id: 'tu1' } })
      let pending = pendingApprovals(db)
      for (let i = 0; i < 40 && !pending.length; i++) {
        await new Promise((r) => setTimeout(r, 100))
        pending = pendingApprovals(db)
      }
      expect(pending.map((p) => [p.session_id, p.tool_name, p.tool_use_id])).toEqual([['chat-1', 'Bash', 'tu1']])
      answerApproval(db, pending[0].id, { allow: false, message: 'not now' })
      expect(await call).toEqual({ content: [{ type: 'text', text: JSON.stringify({ behavior: 'deny', message: 'not now' }) }] })
    } finally {
      await client.close()
    }
  }, 15000)
})
