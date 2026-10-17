// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from 'vitest'
import { headlessArgs } from '../headless'
import { parseFound, repoOf, SETUP_PROMPT } from '../monitor-setup'

const found = {
  messaging: [{ app: 'Slack', mcp: 'claude.ai Slack', sendTool: 'slack_send_message', destinations: [{ kind: 'channel', name: '#lrs-reviews', id: 'C1' }], needs: ['channel id'] }],
  errors: [{ app: 'Scout', mcp: 'scout', tools: ['query_logs'], services: ['glomopay-api'], needs: [] }],
  ci: { provider: 'GitHub Actions', prChecks: ['lint', 'specs'], mainWorkflows: ['Build & Deploy to Staging Envs'] },
  deploy: { workflow: 'Deploy to Sandbox/Production', trigger: 'manual on a version tag', postDeploy: 'Cucumber Post-Deploy (Sandbox)' },
  notes: []
}

describe('monitor setup', () => {
  it('reads the profile between its markers, and refuses a missing or broken one', () => {
    expect(parseFound(`Here it is:\n<profile>${JSON.stringify(found)}</profile>\nDone.`)).toEqual(found)
    expect(() => parseFound('I could not find anything')).toThrow('the setup check did not return a profile')
    expect(() => parseFound('<profile>{nope</profile>')).toThrow('the setup check returned a profile that is not JSON')
    expect(() => parseFound(`<profile>${JSON.stringify({ ...found, errors: undefined })}</profile>`)).toThrow('the setup profile has no errors list')
    expect(() => parseFound(`<profile>${JSON.stringify({ ...found, ci: {} })}</profile>`)).toThrow('the setup profile has no ci part')
  })

  it('reads owner/name from ssh and https remotes', () => {
    expect(repoOf('git@github.com:glomopay/glomopay_service.git\n')).toBe('glomopay/glomopay_service')
    expect(repoOf('https://github.com/harshdigi/signoff-ai.git')).toBe('harshdigi/signoff-ai')
    expect(repoOf('https://gitlab.example.com/team/app')).toBe('team/app')
    expect(repoOf('not a remote')).toBeNull()
  })

  it('runs read-only: no edit tools, and the prompt forbids sending anything', () => {
    const a = headlessArgs(SETUP_PROMPT, { disallow: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] })
    expect(a.slice(a.indexOf('--disallowedTools'), a.indexOf('--disallowedTools') + 2)).toEqual(['--disallowedTools', 'Edit,Write,MultiEdit,NotebookEdit'])
    expect(SETUP_PROMPT).toContain('READ-ONLY: do not send, post, create')
  })
})
