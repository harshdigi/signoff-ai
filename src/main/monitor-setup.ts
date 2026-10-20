// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from 'child_process'
import type { Store } from './store'
import { getSetup, saveSetup } from '../shared/monitors'
import { headlessArgs, runHeadless } from './headless'

// Monitor setup (SIGNOFF-23 step 2): a read-only headless Claude run finds, with the user's own tools, what this repo's
// monitoring can use (D6: any connected app, not only Slack):
// - messaging apps that can post (Slack, Teams, Zoho Cliq, …) and the channels and groups they can list;
// - tools that show production errors (Scout, Sentry, …) and the services that match this repo;
// - how the repo runs CI and deploys to production.
// You then choose in Ship; found and chosen are kept together per repo.
export type Destination = { kind: 'channel' | 'person' | 'group'; name: string; id?: string }
export type Found = {
  messaging: { app: string; mcp: string; sendTool: string; searchTool?: string | null; threadTool?: string | null; destinations: Destination[]; needs: string[] }[]
  errors: { app: string; mcp: string; tools: string[]; services: string[]; needs: string[] }[]
  ci: { provider: string; prChecks: string[]; mainWorkflows: string[] }
  deploy: { workflow: string | null; trigger: string; postDeploy: string | null }
  notes: string[]
}
export type Setup = { found: Found; foundAt: string; chosen: unknown }

const SHAPE = `{
  "messaging": [{ "app": "Slack", "mcp": "<server name>", "sendTool": "<tool that posts a message>",
    "searchTool": "<read-only tool that searches messages in a channel, or null>",
    "threadTool": "<read-only tool that reads the replies in a message thread, or null>",
    "destinations": [{ "kind": "channel|person|group", "name": "#lrs-reviews", "id": "<id if the tool gives one>" }],
    "needs": ["what a message needs, e.g. channel id, mention format <!subteam^ID>"] }],
  "errors": [{ "app": "Scout", "mcp": "<server name>", "tools": ["<read tools for errors, logs, traces>"],
    "services": ["<service names that match this repo>"], "needs": ["what a check needs"] }],
  "ci": { "provider": "GitHub Actions", "prChecks": ["<check names on pull requests>"], "mainWorkflows": ["<workflows on the main branch>"] },
  "deploy": { "workflow": "<workflow that deploys to production, or null>", "trigger": "<how it starts, in a few words: push, tag, manual>", "postDeploy": "<post-deploy test workflow, or null>" },
  "notes": ["at most 5, one short line each (under 15 words): only what the user must know or do"]
}`

export const SETUP_PROMPT = [
  'Set up release monitoring for the repository in the current folder. This is READ-ONLY: do not send, post, create,',
  'edit, comment, push or change anything, anywhere. Only list, search and read.',
  '1. Look at the MCP tools you have. For every app that can post a message (Slack, Microsoft Teams, Zoho Cliq, Google',
  '   Chat, …): its name, the MCP server, the tool that sends a message, and, using its read-only list or search tools,',
  '   up to 30 channels and up to 30 user groups the user can post to, with ids when available. Say what a message needs.',
  '2. For every tool that shows production errors, logs or traces (Scout, Sentry, Datadog, New Relic, …): the app, the',
  '   MCP server, the read tools, and the service names that match this repository.',
  '3. Read the CI and deploy configuration (.github/workflows, .gitlab-ci.yml, Jenkinsfile, …): the CI provider, the',
  '   checks on pull requests, the workflows on the main branch, the workflow that deploys to production and how it',
  '   starts, and any post-deploy test workflow.',
  'Use empty lists and null where nothing applies; never guess names. Reply with ONLY this JSON between <profile> and',
  `</profile>, nothing else:\n${SHAPE}`
].join('\n')

// Reads Claude's reply. A missing or malformed part is an error, never quietly filled in.
export function parseFound(out: string): Found {
  const m = /<profile>([\s\S]*?)<\/profile>/.exec(out)
  if (!m) throw new Error(`the setup check did not return a profile: ${out.slice(0, 200)}`)
  let f: Found
  try {
    f = JSON.parse(m[1]) as Found
  } catch (e) {
    throw new Error(`the setup check returned a profile that is not JSON: ${(e as Error).message}`)
  }
  const list = (v: unknown, what: string): void => { if (!Array.isArray(v)) throw new Error(`the setup profile has no ${what} list`) }
  list(f.messaging, 'messaging'); list(f.errors, 'errors'); list(f.notes, 'notes')
  if (!f.ci || !Array.isArray(f.ci.prChecks) || !Array.isArray(f.ci.mainWorkflows)) throw new Error('the setup profile has no ci part')
  if (!f.deploy || typeof f.deploy.trigger !== 'string') throw new Error('the setup profile has no deploy part')
  return f
}

// owner/name from the origin remote (GitHub, GitLab or similar, ssh or https).
export function repoOf(remote: string): string | null {
  const m = /[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(remote.trim())
  return m ? `${m[1]}/${m[2]}` : null
}

export function repoOfFolder(folder: string): string {
  let url: string
  try {
    url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: folder, encoding: 'utf8' })
  } catch {
    throw new Error(`${folder} has no origin remote, so there is no pull request to watch`)
  }
  const repo = repoOf(url)
  if (!repo) throw new Error(`cannot read owner/name from the origin remote: ${url.trim()}`)
  return repo
}

// Runs the check (a few minutes at most) and saves what it found, keeping any earlier choices.
export async function runSetup(db: Store, folder: string, env: NodeJS.ProcessEnv): Promise<{ repo: string } & Setup> {
  const repo = repoOfFolder(folder)
  const r = await runHeadless(headlessArgs(SETUP_PROMPT, { disallow: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] }), { cwd: folder, env, timeoutMs: 300_000 })
  if (r.code !== 0) throw new Error(`the setup check failed: ${r.out.slice(0, 300)}`)
  const setup: Setup = { found: parseFound(r.out), foundAt: new Date().toISOString(), chosen: getSetup<Setup>(db, repo)?.chosen ?? null }
  saveSetup(db, repo, setup)
  return { repo, ...setup }
}
