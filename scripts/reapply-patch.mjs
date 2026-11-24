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
// Run this after every `pnpm install` in this package directory:
//   ELECTRON_RUN_AS_NODE=1 <dsh-binary> scripts/reapply-patch.mjs
//   (or with any system node: node scripts/reapply-patch.mjs)
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pnpmDir = join(root, 'node_modules', '.pnpm')
const targets = readdirSync(pnpmDir)
  .filter((d) => d.startsWith('ssh-mcp@'))
  .map((d) => join(pnpmDir, d, 'node_modules', 'ssh-mcp', 'build', 'ssh', 'algorithms.js'))
  .filter((p) => existsSync(p))

if (!targets.length) {
  console.error('reapply-patch: ssh-mcp not installed yet — run `pnpm install` first')
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
