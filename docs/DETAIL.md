# SSH 远程控制 (ssh-mcp)

通过 MCP 接入 [ssh-mcp](https://www.npmjs.com/package/ssh-mcp),让 agent 管理你的 Linux 主机。stdio 服务器用 DSH 自带 Node 运行时启动(无需安装 node/npm)。

## 能力

- 16 个远程工具,以 `mcp__ssh__*` 出现:`read-command`(只读白名单)、`run-command`、有状态交互会话(`open-session` + `session=`)、后台会话、SFTP 传输、进程信号、`list-connections`。
- 审批:服务端跑 `client-tool` 模式(DSH 的 MCP 桥不支持 elicitation),本 bundle 的守卫行在 `tools/pre-execute` 把 `destructive-command`、`privileged-command`、上传类与交互式会话转成 DSH 原生确认弹窗;拒绝 = 命令不触达服务器。
- 补丁:自动为 ssh-mcp 去除 chacha20-poly1305 协商项(Electron OpenSSL 无此算法,否则连不上现代 OpenSSH)。

## 使用前提(一次性)

1. `~/.config/ssh-mcp/config.toml`:目录 700 / 文件 600,`[defaults] approvalMode = "client-tool"`;未知键是启动错误。profile 建议 `auth = "agent"` 或 `"key"`,并钉 `trustedHostKey`。密码认证走 `SSH_MCP_PASSWORD` 环境变量,推荐 `expandTemplates: true` + `${credential:REF}` 把密码存进 DSH 凭据库。
2. 在 bundle 目录执行 `pnpm install --ignore-scripts` + `node scripts/reapply-patch.mjs`(本地目录安装是链接式,pnpm 不会替你装依赖)。详见仓库 README。

## 验证方式

新会话里让 agent 调 `mcp__ssh__list-connections`;首次危险命令应弹出"SSH 远程审批"确认卡。

## 限制

- 会话不抗重启/重载;空闲超时默认随 profile 配置。
- "总是允许" `destructive-command` = 该 profile 等效 `auto`,请慎重。
- `danger-full-access` 会话中确认框不可用,被门控工具按 fail-closed 拒绝。
- 交互会话内 `$(...)`/`&&` 长命令可能误报超时(命令实际已执行),建议短命令。
