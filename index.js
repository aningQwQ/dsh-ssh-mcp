// dsh-ssh-mcp — approval guard + path resolver for the ssh-mcp MCP server.
//
// Two jobs:
// 1. Provide the `ssh-mcp-entry` service so the patch rows stay free of
//    machine-specific absolute paths: entryPath is resolved from this
//    package's own directory, configPath from XDG defaults (or row config).
// 2. Gate destructive SSH calls. DSH's mcp-client has no elicitation support,
//    so ssh-mcp must run in `client-tool` approval mode and relies on the
//    MCP client to prompt before the call. DSH does not prompt MCP tools by
//    default — this plugin adds exactly that: a `tools/pre-execute` listener
//    returns `ask`, and the DSH approval card (the same UI as sandbox
//    escapes) becomes the approval. Reject = the call never reaches ssh-mcp.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const inject = ['tools']

const DEFAULT_GATED = [
  'destructive-command',
  'privileged-command',
  'sftp-upload',
  'sftp-upload-file',
  'sftp-download-file',
]

const root = path.dirname(fileURLToPath(import.meta.url))

function resolveEntry() {
  const link = path.join(root, 'node_modules', 'ssh-mcp', 'build', 'index.js')
  try {
    return fs.realpathSync(link)
  } catch {
    console.error(
      '[dsh-ssh-mcp] ssh-mcp dependency not found — in this package directory run `pnpm install` ' +
        'then `node scripts/reapply-patch.mjs` (details: README.md), then reload the bundle.',
    )
    return link
  }
}

function defaultConfigPath() {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(xdg, 'ssh-mcp', 'config.toml')
}

export function apply(ctx, config = {}) {
  const {
    serverName = 'ssh',
    gatedTools = DEFAULT_GATED,
    gateInteractiveSession = true,
    enabled = true,
    configPath = defaultConfigPath(),
    entryPath = resolveEntry(),
  } = config

  ctx.provide('ssh-mcp-entry', {
    entryPath,
    configPath,
    // pre-joined CLI arg: keeps the patch YAML free of quoting tricks
    // (`--config=` would otherwise parse as a JS decrement-assignment)
    configArg: `--config=${configPath}`,
  })

  if (!enabled || !Array.isArray(gatedTools)) return
  const prefix = `mcp__${serverName}__`

  ctx.on('tools/pre-execute', async (exec, next) => {
    const name = exec && exec.name
    if (typeof name !== 'string' || !name.startsWith(prefix)) return next()
    const tool = name.slice(prefix.length)
    const args = (exec && (exec.arguments ?? exec.args)) || {}
    const interactiveSession =
      gateInteractiveSession === true && tool === 'open-session' && args.type === 'interactive'
    if (!gatedTools.includes(tool) && !interactiveSession) return next()

    const target = String(args.host ?? args.profile ?? serverName)
    const command = typeof args.command === 'string' ? args.command.slice(0, 500) : ''
    const remotePath = typeof args.remotePath === 'string' ? args.remotePath : ''
    const detail = command
      ? `${tool} @ ${target}: ${command}`
      : `${tool} @ ${target}${remotePath ? ` ${remotePath}` : ''}`

    return {
      kind: 'ask',
      reason: `ssh-mcp client-tool approval (${tool} on ${target})`,
      displayReason: {
        en: `SSH remote approval — ${detail}`,
        zh: `SSH 远程审批 — ${detail}`,
      },
    }
  })
}
