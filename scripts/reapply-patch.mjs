// Re-apply the Electron compatibility patch to ssh-mcp: remove
// chacha20-poly1305@openssh.com from the negotiated cipher list.
//
// Why: ssh2's chacha20 needs its native sshcrypto binding OR node's plain
// 'chacha20' cipher. DSH runs plugin child processes as
// `ELECTRON_RUN_AS_NODE`, whose bundled OpenSSL ships neither (AES-GCM/CTR
// are all present, so dropping chacha20 only changes preference order —
// servers that offer AES negotiate normally; a chacha20-ONLY server would
// fail, which real sshd never is since GCM/CTR are OpenSSH defaults).
//
// Run this after every fresh install of this bundle's ssh-mcp dependency
// (works in both linked-checkout and packed/hoisted layouts):
//   ELECTRON_RUN_AS_NODE=1 <dsh-binary> scripts/reapply-patch.mjs
//   (or with any system node: node scripts/reapply-patch.mjs)
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function candidates() {
  const out = []
  // linked-checkout layout: package-local virtual store
  const pnpmDir = join(root, 'node_modules', '.pnpm')
  if (existsSync(pnpmDir)) {
    for (const d of readdirSync(pnpmDir)) {
      if (!d.startsWith('ssh-mcp@')) continue
      const p = join(pnpmDir, d, 'node_modules', 'ssh-mcp', 'build', 'ssh', 'algorithms.js')
      if (existsSync(p)) out.push(p)
    }
  }
  // both layouts: resolve through the module graph (hoisted or nested)
  try {
    const pkgJson = createRequire(import.meta.url).resolve('ssh-mcp/package.json')
    const p = join(dirname(pkgJson), 'build', 'ssh', 'algorithms.js')
    if (existsSync(p) && !out.includes(p)) out.push(p)
  } catch {}
  return out
}

const targets = candidates()
if (!targets.length) {
  console.error(
    'reapply-patch: ssh-mcp not resolvable from this package — install its dependencies first ' +
      '(README Setup step 3).',
  )
  process.exit(1)
}
for (const p of targets) {
  const src = readFileSync(p, 'utf8')
  if (!src.includes("'chacha20-poly1305@openssh.com',")) {
    console.log('already patched:', p)
    continue
  }
  let out = src.replace(/\n\s*'chacha20-poly1305@openssh\.com',/, '')
  out = out.replace(
    'cipher: [...FROZEN_ALGORITHMS.cipher.filter((c) => c !== CHACHA20), CHACHA20],',
    'cipher: [...FROZEN_ALGORITHMS.cipher],',
  )
  if (out.includes("'chacha20-poly1305@openssh.com',")) {
    console.error('reapply-patch: unexpected file layout, refusing to write:', p)
    process.exit(1)
  }
  writeFileSync(p, out)
  console.log('patched:', p)
}
