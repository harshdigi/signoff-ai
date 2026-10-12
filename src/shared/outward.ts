// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
// Tool calls that send something outside this machine (IDE/D16 I): messages, tickets, comments, pushes.
// They are shown as an editable draft and approved one at a time; "allow for this chat" never covers them.

const READ = /^(get|list|search|read|fetch|query|find|lookup|describe|view|show|check|count|download)/i
const WRITE = /(send|post|create|update|delete|remove|comment|reply|publish|schedule|transition|edit|upload|add|invite|merge|close|assign|write|draft|react|share|move|archive)/i

export function isOutward(tool: string, input: Record<string, unknown> = {}): boolean {
  if (tool.startsWith('mcp__')) {
    if (tool.startsWith('mcp__decide__')) return false
    const action = tool.split('__').pop() ?? ''
    const verb = action.replace(/^[a-z]+_/, '') // slack_send_message -> send_message
    return !READ.test(verb) && !READ.test(action) && WRITE.test(action)
  }
  if (tool === 'Bash' && typeof input.command === 'string')
    return /\b(git\s+push|gh\s+(pr|issue)\s+(create|merge|comment|close|edit)|gh\s+release\s+create)\b/.test(input.command)
  return false
}

// Which service a tool belongs to, for the card title: mcp__claude_ai_Slack__slack_send_message -> Slack.
export function serviceOf(tool: string): string {
  if (!tool.startsWith('mcp__')) return tool === 'Bash' ? 'git / GitHub' : tool
  return tool.split('__')[1].replace(/^claude_ai_/, '').replace(/_/g, ' ')
}
