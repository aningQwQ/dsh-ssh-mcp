# dsh-ssh-mcp

Give your [DeepSeek Harness](https://github.com/deepseek-ai) agent SSH access to your Linux servers — safely.

A DSH bundle that connects [ssh-mcp](https://www.npmjs.com/package/ssh-mcp) as a stdio MCP server, using DSH's own Node runtime (no system node/npm needed), and adds the approval layer DSH lacks by default:

- **16 remote tools** appear as `mcp__ssh__*`: allowlisted reads, arbitrary commands, stateful interactive sessions, background sessions, SFTP transfers, process signals.
- **Native approval prompts.** DSH's MCP bridge has no elicitation support, so ssh-mcp runs in `client-tool` mode and this bundle's guard plugin turns destructive calls (`destructive-command`, `privileged-command`, uploads, interactive sessions) into DSH's standard "allow this tool call?" card — the same UI as workspace-write approvals. Reject means the command never reaches your server.
- **No secrets in the patch.** Password auth resolves through env vars or DSH's credential store; key/agent auth needs nothing at all.

## Setup (3 steps)

### 1. Write the ssh-mcp config

`~/.config/ssh-mcp/config.toml` (permissions matter — the server refuses a loose mode):

```sh
mkdir -p ~/.config/ssh-mcp && chmod 700 ~/.config/ssh-mcp
cat > ~/.config/ssh-mcp/config.toml <<'EOF'
[defaults]
approvalMode = "client-tool"     # required with DSH (no elicitation)

[[profiles]]
name = "web1"
host = "10.0.0.5"
user = "deploy"
auth = "agent"                   # or "key" with keyRef = "~/.ssh/id_ed25519"
role = "operator"
group = "dev"
trustedHostKey = "SHA256:..."    # ssh-keyscan -t ed25519 HOST | ssh-keygen -lf -
EOF
chmod 600 ~/.config/ssh-mcp/config.toml
```

Password auth: the ssh-mcp server reads `SSH_MCP_PASSWORD` / `SSH_MCP_<PROFILE>_PASSWORD` from its environment — add it to the `ssh-mcp-server` row's `env`, ideally with `expandTemplates: true` and a whole-value token `${credential:my_ref}` (reference names must be POSIX-style identifiers: letters/digits/underscores, starting with a letter or underscore) so the secret lives in DSH's credential store (`$DSH_HOME/.credentials.yaml`, `refs:` section) instead of the patch file.

### 2. Install the bundle

Plugins → Add plugin → point at a clone of this repo, or have your agent run `install_bundle` with the repo path (or `github:aningQwQ/dsh-ssh-mcp`).

### 3. Initialize dependencies (one time, in the bundle directory)

Local-directory bundles are **linked**, not copied, and pnpm does not auto-install a linked package's dependencies. Run, in this repo's directory:

```sh
pnpm install --ignore-scripts
node scripts/reapply-patch.mjs
```

If you don't have system node/pnpm, paste this to your DSH agent:

> In the dsh-ssh-mcp bundle directory (find it with plugin_manager `list_bundles` / `list_plugins`), run `pnpm install --ignore-scripts` and then `node scripts/reapply-patch.mjs`, using DSH's own runtime: prefix both commands with `ELECTRON_RUN_AS_NODE=1` and use the `dsh-desktop-next` binary as the interpreter, with the bundled `pnpm.mjs` from `app.asar.unpacked/node_modules/pnpm/bin/`. Do not approve native build scripts; the pure-JS fallback is what the patch expects.

Then enable/reload the bundle and ask your agent to call `mcp__ssh__list-connections`.

## Why the cipher patch exists

DSH launches MCP stdio servers with `ELECTRON_RUN_AS_NODE`, and Electron's bundled OpenSSL has no chacha20-poly1305 (AES-GCM/CTR are fine). ssh-mcp pins chacha20 first in its negotiation list and ssh2 rejects it outright, so connections to modern OpenSSH servers fail before authentication. `scripts/reapply-patch.mjs` removes that one entry; every other algorithm in ssh-mcp's frozen list is available. This is also why `--ignore-scripts` is safe here: without the patch you don't need (and shouldn't grant) any native build.

## Security notes

- `client-tool` mode is weaker than elicitation by design: **"Always allow" on `destructive-command` makes that profile behave like `auto`.** Use grants deliberately.
- In `danger-full-access` sessions DSH suppresses approval cards; the guard's gated tools then fail closed (denied), not open.
- Pin `trustedHostKey` per profile; host key changes break the connection on purpose.
- Interactive-session commands run inside a long-lived shell and are classified one by one; background sessions and `sftp-download` are *not* treated as approval carriers by ssh-mcp.

## Known limits

- Sessions don't survive bundle reloads, DSH restarts, or the 15-minute idle timeout (configurable).
- Inside interactive sessions, `$(...)` / `&&` chains can make completion detection time out even though the command ran — prefer short commands; the timeout is cosmetic, verify state instead of retrying blindly.

MIT © aningQwQ
