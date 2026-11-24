// dsh-ssh-mcp — approval guard + path resolver for the ssh-mcp MCP server.
//
// Three jobs:
// 0. Self-heal a freshly installed ssh-mcp's cipher list at activation
//    (Electron OpenSSL lacks chacha20-poly1305; see selfHealCiphers).
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
import { createRequire } from 'node:module'
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

// Locate the ssh-mcp entry across install layouts:
//  - linked-checkout dev: <pkg>/node_modules/ssh-mcp (pnpm virtual store)
//  - packed/hoisted install: ssh-mcp hoisted beside the package (profile root)
export function resolveSshMcpRoot(fromUrl) {
  const local = path.join(root, 'node_modules', 'ssh-mcp')
  if (fs.existsSync(path.join(local, 'build', 'index.js'))) return local
  try {
    const req = createRequire(fromUrl || import.meta.url)
    return path.dirname(req.resolve('ssh-mcp/package.json'))
  } catch {
    return null
  }
}

// Electron's bundled OpenSSL has no chacha20-poly1305 (AES-GCM/CTR are fine)
// and ssh2 rejects the pinned list entry before the handshake even starts.
// The guard row activates strictly before the server row (row `inject`
// guarantees the order), so we repair the freshly installed dependency here.
// Idempotent; refuses to touch unexpected file layouts; logs every outcome.
function selfHealCiphers(mcpRoot) {
  const p = path.join(mcpRoot, 'build', 'ssh', 'algorithms.js')
  let src
  try {
    src = fs.readFileSync(p, 'utf8')
  } catch {
    return // non-standard package layout: resolveEntry will surface it
  }
  if (!src.includes("'chacha20-poly1305@openssh.com',")) return // already good
  let out = src.replace(/\n\s*'chacha20-poly1305@openssh\.com',/, '')
  out = out.replace(
    'cipher: [...FROZEN_ALGORITHMS.cipher.filter((c) => c !== CHACHA20), CHACHA20],',
    'cipher: [...FROZEN_ALGORITHMS.cipher],',
  )
  if (out.includes("'chacha20-poly1305@openssh.com',")) {
    console.error('[dsh-ssh-mcp] unexpected algorithms.js layout, leaving untouched:', p)
    return
  }
  try {
    fs.writeFileSync(p, out)
    console.error('[dsh-ssh-mcp] applied Electron cipher patch:', p)
  } catch (e) {
    console.error('[dsh-ssh-mcp] cipher patch write failed:', e.message)
  }
}

function resolveEntry() {
  const mcpRoot = resolveSshMcpRoot()
  if (mcpRoot) {
    selfHealCiphers(mcpRoot)
    try {
      return fs.realpathSync(path.join(mcpRoot, 'build', 'index.js'))
    } catch {}
  }
  console.error(
    '[dsh-ssh-mcp] ssh-mcp dependency not found — see README Setup step 3 (dependency init), ' +
      'then reload the bundle.',
  )
  return path.join(root, 'node_modules', 'ssh-mcp', 'build', 'index.js')
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
