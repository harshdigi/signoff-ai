// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getApproval, requestApproval } from '../shared/approvals'
import type { Store } from '../main/store'

// signoff mcp: the --permission-prompt-tool for chat sessions (IDE/D10).
// - Claude Code calls `approve` with {tool_name, input, tool_use_id} (checked with a live probe on 2.1.291).
// - We file the request in the store, wait for the window's answer, and return its JSON as text.
// - No timeout: an unanswered prompt waits, as it would in the terminal. Interrupting the turn ends it.
export async function runMcp(db: Store, session: string): Promise<void> {
  const server = new McpServer({ name: 'decide', version: '0.1.0' })
  server.registerTool('approve', {
    description: 'Ask the user in Signoff AI to allow or deny a tool call',
    inputSchema: { tool_name: z.string(), input: z.record(z.string(), z.unknown()), tool_use_id: z.string().optional() }
  }, async ({ tool_name, input, tool_use_id }) => {
    let a = requestApproval(db, session, tool_name, input, tool_use_id)
    while (a.status === 'pending') {
      await new Promise((r) => setTimeout(r, 250))
      a = getApproval(db, a.id)
    }
    return { content: [{ type: 'text', text: a.result! }] }
  })
  await server.connect(new StdioServerTransport())
}
