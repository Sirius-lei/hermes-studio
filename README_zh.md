<p align="center">
  <strong>DiTing Studio</strong>
  <a href="./README.md">English</a>
</p>

<p align="center">
  面向 <a href="https://github.com/NousResearch/diting-agent">DiTing Agent</a> 的桌面应用、本地运行时和 Web 控制台。<br/>
  聊天、模型与 Profile 管理、平台渠道接入、任务自动化、<br/>
  文件查看、Coding Agent 和本地运行环境都在一个界面中完成。
</p>

<p align="center">
  <a href="https://github.com/EKKOLearnAI/DiTing-studio/releases/latest">下载 DiTing Studio 桌面版</a>
  ·
  <code>npm install -g diting-web-ui && diting-web-ui start</code>
</p>

<p align="center">
  <img src="https://github.com/EKKOLearnAI/DiTing-studio/blob/main/packages/client/src/assets/image.gif" alt="DiTing Web UI 演示" width="680"/>
</p>

<p align="center">
  <strong>移动端</strong>
</p>

<p align="center">
  <video src="https://github.com/EKKOLearnAI/DiTing-studio/blob/main/packages/client/src/assets/video.mp4?raw=true" width="360" controls></video>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/diting-web-ui"><img src="https://img.shields.io/npm/v/diting-web-ui?style=flat-square&color=blue" alt="npm 版本"/></a>
  <a href="https://github.com/EKKOLearnAI/DiTing-studio/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/diting-web-ui?style=flat-square" alt="许可证"/></a>
  <a href="https://github.com/EKKOLearnAI/DiTing-studio/stargazers"><img src="https://img.shields.io/github/stars/EKKOLearnAI/DiTing-studio?style=flat-square" alt="Star"/></a>
</p>

## 核心能力

| 模块 | DiTing Studio 能做什么 |
|---|---|
| Agent 聊天 | 运行 DiTing Agent 对话，支持流式回复、工具调用轨迹、文件上传下载和本地持久化会话。 |
| 本地控制台 | 在一个仪表盘中管理 Profile、Provider、模型、凭证、记忆、技能、插件、日志和运行时设置。 |
| 自动化 | 围绕同一套 DiTing Profile 配置平台渠道、Cron 任务、Kanban 任务、群聊房间和 MCP Server。 |
| 工作区工具 | 提供文件浏览器、Web 终端、语音输入输出、Coding Agent、设备发现和性能视图。 |
| 分发形态 | 支持 Windows/macOS/Linux 桌面应用、npm CLI 包和 Docker 镜像。 |

## 功能特性

### AI 聊天

- 聊天前端通过 Socket.IO `/chat-run` 实时流式更新；聊天运行通过 DiTing agent bridge 执行
- 多会话管理 — 创建、重命名、删除、切换会话
- **自建会话数据库** — Web UI 会话使用本地 SQLite；DiTing state.db 仅作为只读来源用于 DiTing 历史 API
- 按来源分组会话（Telegram、Discord、Slack 等），可折叠手风琴面板
- 活跃会话实时指示器 — 正在进行的会话置顶并显示旋转图标
- 按最新消息时间排序会话列表
- Markdown 渲染，支持语法高亮和代码复制
- 工具调用详情展开（参数 / 结果）
- 按 Profile 隔离的文件上传
- 文件下载支持 — 按解析后的路径下载用户上传文件和 Agent 生成文件，兼容 local、Docker、SSH、Singularity 等多种 terminal backend
- 会话搜索 — Ctrl+K 搜索 Web UI 本地会话库；不包含只读 DiTing 历史会话
- 按账号授权 Profile 汇总模型选择器 — 只展示当前账号可访问的 DiTing Profile 中可用的模型
- 每个会话显示模型标签和上下文 Token 用量

### 平台渠道

在一个页面统一配置 **8 个平台**：

| 平台 | 功能 |
|---|---|
| Telegram | Bot Token、提及控制、表情回应、自由回复聊天 |
| Discord | Bot Token、提及、自动线程、表情回应、频道白名单/黑名单 |
| Slack | Bot Token、提及控制、Bot 消息处理 |
| WhatsApp | 启用/禁用、提及控制、提及模式 |
| Matrix | Access Token、Homeserver、自动线程、私信提及线程 |
| 飞书 | App ID / Secret、提及控制 |
| 微信 | 扫码登录（浏览器扫码，自动保存凭证） |
| 企业微信 | Bot ID / Secret |

- 凭证管理写入 `~/.diting/.env`
- 渠道行为设置写入 `~/.diting/config.yaml`
- 每个平台已配置/未配置状态检测

### 用量分析

- Token 总用量明细（输入 / 输出）
- 会话数及日均统计
- 预估费用追踪及缓存命中率
- 模型使用分布图
- 30 天每日趋势（柱状图 + 数据表格）

### 定时任务

- 创建、编辑、暂停、恢复、删除 Cron 任务
- 立即触发执行
- Cron 表达式快捷预设

### Kanban

- 按 Profile 管理的 Kanban 看板，用于规划和跟踪 Agent 工作
- 可在仪表盘中创建任务、更新任务并移动状态
- 复用 Web UI 本地状态和认证体系

### 模型管理

- 从凭证池自动发现模型（`~/.diting/auth.json`）
- 从每个 Provider 端点获取可用模型（`/v1/models`）
- 添加、更新、删除 Provider（预设 & 自定义 OpenAI 兼容）
- OpenAI Codex 和 Nous Portal OAuth 登录
- Provider URL 自动检测，支持非 v1 API 版本（如 `/v4`）
- Provider 级别模型分组，支持切换默认模型

### 多配置文件

- 创建、重命名、删除、切换 DiTing 配置文件（Profile）
- 克隆现有配置文件或从归档导入（`.tar.gz`）
- 导出配置文件用于备份或分享
- 按 Profile 隔离配置、缓存、上传、会话、任务、用量、记忆、技能、插件、Provider 和模型可见性
- 账号绑定 Profile 权限：超级管理员可以管理全部 Profile；普通管理员只能查看和使用分配给自己的 Profile

### 文件浏览器

- 浏览远程后端文件（local、Docker、SSH、Singularity）
- 上传、下载、重命名、复制、移动和删除文件
- 上传文件保存到当前选择/请求的 DiTing Profile 目录下；下载按真实路径解析，支持下载上传目录外的 Agent 产物
- 创建目录
- 查看文件内容，支持语法高亮

### 群聊

- 多 Agent 聊天房间，通过 Socket.IO 实时通信
- @提及路由 — 提及 Agent 触发上下文回复
- 上下文压缩 — 历史消息超过 Token 阈值时自动摘要压缩
- 输入状态和回复进度指示器
- 房间创建、删除和邀请码管理
- Agent 管理 — 添加/移除房间中的 Agent，支持独立 Profile
- SQLite 消息持久化
- 移动端响应式布局，可折叠侧边栏

### Coding Agents

- 在 Web 仪表盘中启动和监控本地 Coding Agent 会话
- 为 Codex 和 Claude Code 集成提供独立代理路由
- 持久化 Agent 输出和 reasoning 元数据，便于后续查看

### 技能与记忆

- 浏览和搜索已安装的技能
- 查看技能详情和附件
- 用户笔记和档案管理

### 日志

- 查看 Agent / Server / Error 日志
- 按日志级别、日志文件和关键词过滤
- 结构化日志解析，HTTP 访问日志高亮

### 管理与运行时

- 设备和局域网 Peer 页面，用于本地网络发现和 Peer 工具能力
- MCP 管理器，用于托管的 `DiTing-studio` MCP Server 和 Profile 自动注入
- Runtime Version 和 Version Preview 工具，用于隔离测试新版本
- 面向超级管理员的性能监控视图

### 认证

- 基于 Token 的认证（首次运行自动生成或通过 `AUTH_TOKEN` 环境变量设置）
- 用户名/密码登录，并在设置页提供账户管理
- 默认登录名/密码为 `admin` / `123456`；登录后会提示尽快修改默认账户和密码
- 超级管理员可以管理用户和 Profile 绑定；普通管理员只能管理自己的账户信息

CLI 维护命令：

```bash
# 删除持久化的登录 IP 锁记录
diting-web-ui clear-login-locks

# 删除登录锁并重启正在运行的 Web UI 进程
diting-web-ui clear-login-locks --restart

# 创建或重置默认超级管理员登录名/密码为 admin / 123456
diting-web-ui reset-default-login
```

`clear-login-locks` 会删除 `${DiTing_WEB_UI_HOME:-~/.diting-web-ui}/.login-lock.json`。如果服务正在运行，需要重启服务才能清理内存中的锁定状态。`reset-default-login` 会更新 Web UI 账户数据库；如果已存在 `admin` 用户，则会把密码重置为 `123456`，并启用为超级管理员账户。

### 设置

- 显示（流式输出、紧凑模式、推理过程、费用显示）
- Agent（最大轮次、超时时间、工具强制执行）
- 记忆（启用/禁用、字符限制）
- 会话重置（空闲超时、定时重置）
- 隐私（PII 脱敏）
- 模型设置（默认模型 & Provider）
- Profile 和 Provider 配置

### 语音 / TTS / STT

- 可在聊天和群聊消息中朗读 Assistant 回复。
- Provider 支持：浏览器 Web Speech、内置 Edge TTS、OpenAI 兼容 `/audio/speech`、自定义 OpenAI 兼容 TTS 端点、MiMo。
- MiMo 支持预置音色、音色设计提示词、音色复刻参考音频（`.mp3`/`.wav`，最大 10 MB），并可选择鉴权请求头模式（`Authorization`、`api-key` 或两者同时发送）。
- Edge / OpenAI 兼容 / 自定义 / MiMo 播放统一走 Web UI 后端 `/api/DiTing/tts/synthesize`，停止/暂停状态一致，并会在可行时中断进行中的 fetch。
- Provider API Key 和 MiMo 复刻参考音频保存在服务端 TTS 设置中，浏览器只显示脱敏后的 secret 状态。
- 使用 OpenAI / 自定义 / MiMo 播放前，先在 Settings → Voice 保存 provider 设置。消息播放只发送文本和非敏感播放参数，后端合成时读取当前用户保存的私钥。
- 聊天输入框支持回合制语音输入：通过麦克风按钮开始/停止一轮录音，转写结果会先填入当前输入框，用户可以编辑后再用普通发送按钮发送。
- 语音输入 / STT 可在支持时使用浏览器语音识别，也可使用在 Settings → Voice 中配置的服务端 provider。
- 当 Assistant 音频正在播放时，开始新的语音输入会先停止播放。这个 barge-in 只打断音频，不会隐式取消正在运行的 Agent；停止 run 仍然需要显式操作。
- 支持的设置项、安全边界和当前非目标范围见 [`docs/voice-dialogue.md`](./docs/voice-dialogue.md)。
- 限制：浏览器/服务端中断后，外部 TTS Provider 仍可能继续处理请求；自定义 / OpenAI 兼容 / MiMo base URL 必须是公网 `http`/`https` 端点，不能指向 localhost 或私网。

### Web 终端

- 集成终端，基于 node-pty 和 @xterm/xterm
- 多会话支持 — 创建、切换、关闭终端会话
- 通过 WebSocket 实时传输键盘输入和 PTY 输出
- 支持窗口大小调整

### 桌面应用与自动更新

- Windows、macOS 和 Linux 原生 Electron 桌面壳
- 内置 Web UI 运行时，并自动启动本地 DiTing Studio 服务
- 桌面自动更新优先使用 Cloudflare 下载端点获取更新元数据和安装包
- 如果 Cloudflare 更新源不可用，会回退到 GitHub Releases `latest` 资源
- Windows 升级时会先尝试关闭已有 DiTing Studio 进程，再替换文件

---

## 快速开始

### 桌面应用（推荐）

从 [GitHub Releases](https://github.com/EKKOLearnAI/DiTing-studio/releases/latest)
下载最新的 **DiTing Studio** 桌面安装包。

桌面版会发布 macOS、Windows 和 Linux 构建；适用时会区分不同 CPU 架构。
桌面应用内置 Web UI 运行时，DiTing Agent 数据会保存到原生 DiTing 目录：

- Windows：`%LOCALAPPDATA%\DiTing`（找不到时回退到 `%APPDATA%\DiTing`）
- macOS/Linux：`~/.diting`

桌面壳自身的 Web UI 状态会单独保存到 `~/.diting-web-ui`，除非设置了
`DiTing_WEB_UI_HOME`。

打包后的桌面应用启动后，会安装受管命令 shim，避免桌面应用、内置 DiTing Agent CLI
和内置 Web UI CLI 的命令互相冲突：

| 命令 | 说明 |
|---|---|
| `DiTing-studio` | 打开 DiTing Studio 桌面应用 |
| `DiTing-studio cli ...` | 运行内置 DiTing Agent CLI |
| `DiTing-studio web ...` | 运行内置 `diting-web-ui` 命令 |
| `DiTing-studio -h` | 显示 wrapper 帮助 |
| `diting-studio-mcp` | 运行受管 Web UI MCP bridge |

使用 `DiTing-studio cli -h` 查看 DiTing Agent CLI 帮助，使用
`DiTing-studio web -h` 查看 Web UI CLI 帮助。

桌面自动更新会优先读取 `https://download.ekkolearnai.com/latest`。
如果该端点不可用，更新器会回退到
`https://github.com/EKKOLearnAI/DiTing-studio/releases/latest/download`。

### npm 安装

```bash
npm install -g diting-web-ui
diting-web-ui start
```

打开 **http://localhost:18648**

### Docker Compose

单容器部署，内置 DiTing Agent 运行时：

```bash
# 先准备宿主机映射出来的 DiTing 配置目录
docker compose run --rm diting-webui prepare-diting-home

# 使用预构建镜像（推荐）
WEBUI_IMAGE=ekkoye8888/diting-web-ui docker compose up -d

# 或从源码构建
docker compose up -d --build

docker compose logs -f diting-webui
```

打开 **http://localhost:6060**

- DiTing 持久化数据目录：`./diting_data`
- Web UI 认证 Token 存储在 `./diting_data/diting-web-ui/.token`
- 当 `DiTing_DOCKER_REQUIRE_PROFILE_CONFIG=1` 时，首次启动前先编辑 `./diting_data/config.yaml`
- 首次启动并开启认证时，Token 会打印到容器日志中
- 运行参数全部由 `docker-compose.yml` 环境变量驱动

更详细的说明与排错见：[`docs/docker.md`](./docs/docker.md)

Docker 镜像会把 DiTing Agent runtime 放在同一个容器内，入口脚本会在
Web UI 启动前自动发现并导出容器内的 DiTing CLI / bridge Python。

### DiTing Agent 运行时发现

Web UI 启动后端聊天能力时，会优先使用包含 `run_agent.py` 的源码目录，例如
`~/.diting/diting-agent`。如果找不到源码目录，会退回到已安装 `DiTing` 命令所使用
的 Python 环境，再退到系统 Python。因此源码安装和 `pip install diting-agent` 这类
包安装方式都可以兼容。

## Web UI 环境变量

这些变量用于配置 DiTing Web UI、本地 DiTing runtime 集成以及开发/预览辅助能力。Provider API Key 和 DiTing Agent 相关设置通常仍通过 DiTing profile 管理；这里列出的变量是进程级覆盖项。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `18648` | Web UI 监听端口。 |
| `BIND_HOST` | `0.0.0.0` | Web UI 绑定地址。如需 IPv6，可显式设置为 `::`。 |
| `DiTing_WEB_UI_HOME` | `~/.diting-web-ui` | Web UI 数据目录，用于认证 token、登录凭据、日志、数据库和默认上传目录。兼容支持 `DiTing_WEBUI_STATE_DIR` 作为别名。 |
| `DiTing_WEBUI_STATE_DIR` | 未设置 | `DiTing_WEB_UI_HOME` 的兼容别名。 |
| `DiTing_WEB_UI_DISABLE_MCP_AUTOINJECT` | 未设置 | 关闭启动时向 DiTing profile 配置自动注入托管的 `DiTing-studio` MCP server。 |
| `DiTing_WEB_UI_ALLOW_TRANSIENT_MCP_AUTOINJECT` | 未设置 | 当 `DiTing_WEB_UI_HOME` 位于临时目录（例如 Version Preview runtime）时，仍允许托管 MCP 自动注入。 |
| `UPLOAD_DIR` | `$DiTing_WEB_UI_HOME/upload` | 覆盖上传根目录。文件会保存在按 Profile 隔离的子目录下。 |
| `CORS_ORIGINS` | 仅同 host | HTTP、Socket.IO、WebSocket 跨源 allowlist，支持逗号或空格分隔。只有明确需要旧版 wildcard CORS 时才设置为 `*`。 |
| `AUTH_TOKEN` | 自动生成 | 显式指定 bearer token。未设置时，Web UI 会在 `DiTing_WEB_UI_HOME` 下自动生成。 |
| `AUTH_JWT_SECRET` | `AUTH_TOKEN` | 用户名/密码会话的 JWT 签名密钥覆盖。 |
| `PROFILE` | `default` | 启动/默认 DiTing profile。运行时请求使用前端当前选择且当前账号有权限访问的 Profile。 |
| `LOG_LEVEL` | `info` | Server 日志级别。 |
| `BRIDGE_LOG_LEVEL` | `$LOG_LEVEL` 或 `info` | Bridge 日志级别。 |
| `MAX_DOWNLOAD_SIZE` | `200MB` | 最大文件下载大小。 |
| `MAX_EDIT_SIZE` | `10MB` | 最大可编辑文件大小。 |
| `WORKSPACE_BASE` | 当前用户 Home 目录 | Workspace 浏览根目录。 |
| `DiTing_HOME` | 平台默认值 | DiTing 数据目录。Windows 使用 `%LOCALAPPDATA%\DiTing`；macOS/Linux 使用 `~/.diting`。 |
| `DiTing_BIN` | `diting` | 自定义 DiTing CLI 二进制路径。 |
| `DiTing_AGENT_ROOT` | 自动发现 | 包含 `run_agent.py` 的 DiTing Agent 源码目录。 |
| `DiTing_AGENT_BRIDGE_PYTHON` | 自动发现 | 用于启动 agent bridge 的 Python 解释器。 |
| `DiTing_AGENT_BRIDGE_UV` | 自动发现 | 可用时用于启动 agent bridge 的 `uv` 可执行文件。 |
| `UV` | 自动发现 | `uv` 可执行文件 fallback。 |
| `PYTHON` | 自动发现 | agent bridge 的 Python 可执行文件 fallback。 |
| `DiTing_AGENT_BRIDGE_ENDPOINT` | 平台默认值 | Agent bridge broker endpoint。Windows 默认 `tcp://127.0.0.1:28765`；macOS/Linux 默认 `ipc:///tmp/diting-agent-bridge.sock`。 |
| `DiTing_AGENT_BRIDGE_TIMEOUT_MS` | `120000` | Node 请求 bridge broker 的响应超时。 |
| `DiTing_AGENT_BRIDGE_CONNECT_RETRY_MS` | `5000` | 连接 bridge socket 失败时的短重试窗口。 |
| `DiTing_AGENT_BRIDGE_STARTUP_TIMEOUT_MS` | `120000` | 等待 Python bridge ready 的超时。 |
| `DiTing_AGENT_BRIDGE_STOP_ON_SHUTDOWN` | 开启 | Web UI 关闭和重启时是否停止 bridge broker；设为 `0`、`false`、`no` 或 `off` 才会在重启时保留 broker。 |
| `DiTing_AGENT_BRIDGE_AUTO_RESTART` | 开启 | bridge broker 意外退出后是否自动重启；设为 `0`、`false`、`no` 或 `off` 可关闭。 |
| `DiTing_AGENT_BRIDGE_RESTART_DELAY_MS` | `1000` | bridge 自动重启退避的基础延迟。 |
| `DiTing_AGENT_BRIDGE_PLATFORM` | `cli` | 传给 DiTing Agent 的 platform 标识。 |
| `DiTing_AGENT_BRIDGE_WORKER_TRANSPORT` | 平台默认值 | Profile worker transport。设为 `tcp` 使用 loopback TCP；设为 `ipc`/`unix` 使用 Unix domain socket；默认 Windows TCP、macOS/Linux IPC。 |
| `DiTing_AGENT_BRIDGE_WORKER_PORT_BASE` | `28780` | TCP worker endpoint 起始端口。 |
| `DiTing_AGENT_BRIDGE_WARM_PROFILES` | 未设置（Docker 中默认为 `active`） | 启动时预热指定 profile worker。支持 `active`、`default` 或逗号分隔 profile 名。 |
| `DiTing_AGENT_BRIDGE_WORKER_IDLE_TIMEOUT_SECONDS` | `1800`（Docker 中默认为 `86400`） | worker 空闲多久后由 broker 卸载。 |
| `DiTing_AGENT_BRIDGE_SESSION_IDLE_TIMEOUT_SECONDS` | `1800`（Docker 中默认为 `86400`） | session 空闲多久后由 worker 卸载。 |
| `DiTing_BRIDGE_PROVIDER` | profile/默认值 | bridge 运行时的 provider 覆盖。 |
| `DiTing_BRIDGE_TOOLSETS` | profile/默认值 | bridge 运行时的 toolset 覆盖。 |
| `DiTing_BRIDGE_MAX_TURNS` | profile/默认值 | bridge 运行时的最大轮数覆盖。 |
| `DiTing_BRIDGE_SUPPRESS_PLATFORM_HINT` | `cli` | 控制传给 DiTing Agent 的 bridge platform hint suppression。 |
| `DiTing_OPENROUTER_APP_REFERER` | `https://DiTing-studio.ai` | bridge 运行发送给 OpenRouter 的 attribution referer。 |
| `DiTing_OPENROUTER_APP_TITLE` | `DiTing Web UI` | bridge 运行发送给 OpenRouter 的 attribution title。 |
| `DiTing_OPENROUTER_APP_CATEGORIES` | `cli-agent,personal-agent` | bridge 运行发送给 OpenRouter 的 attribution categories。 |
| `DiTing_WEB_UI_MANAGED_GATEWAY` | 默认开启 | 控制 Web UI 托管 DiTing gateway 进程；设为 `0`、`false`、`no` 或 `off` 时改用 `DiTing gateway start`。 |
| `DiTing_WEB_UI_REQUIRE_AGENT_BRIDGE` | 未设置（Docker 中默认为 `1`） | bridge 启动失败时让 Web UI 直接启动失败，适合集成式容器部署。 |
| `DiTing_WEB_UI_DISABLE_GATEWAY_AUTOSTART` | 未设置 | 跳过启动时的 gateway 检查/自动启动；dashboard-only 部署中如果由其它服务管理 DiTing gateway，可设为 `1`、`true`、`yes` 或 `on`。 |
| `DiTing_WEB_UI_DISABLE_SKILL_INJECTION` | 未设置 | 跳过启动时的内置 skill 注入；如果内置 skills 由 DiTing Web UI 外部管理，可设为 `1`、`true`、`yes` 或 `on`。启用注入时，Web UI 只更新自己此前安装的 skills 或内容完全相同的既有内置副本；本地修改和用户拥有的同名 skills 会跳过。 |
| `DiTing_WEB_UI_STOP_GATEWAYS_ON_SHUTDOWN` | 生产环境默认开启 | Web UI 关闭时是否同时停止托管的 gateway 进程；设为 `0` 或 `false` 可让 gateway 分离运行。 |
| `GATEWAY_HOST` | `127.0.0.1` | 旧 gateway 兼容配置中写入 profile 的默认 gateway host。 |
| `DiTing_WEB_UI_PREVIEW_REPO` | package repository | Version Preview 使用的 GitHub 仓库。 |
| `DiTing_WEB_UI_PREVIEW_AGENT_BRIDGE_TRANSPORT` | 平台默认值 | Version Preview broker transport。设为 `tcp` 可让预览环境在 macOS/Linux 上也使用 loopback TCP；未设置时会跟随 `DiTing_AGENT_BRIDGE_WORKER_TRANSPORT=tcp`。 |
| `DiTing_WEB_UI_PREVIEW_AGENT_BRIDGE_ENDPOINT` | 隔离的预览 endpoint | 直接覆盖 Version Preview 的 broker endpoint。 |
| `DiTing_WEB_UI_BACKEND_PORT` | `18647` | Vite dev proxy 使用的后端端口。 |
| `DiTing_WEB_UI_FRONTEND_PORT` | `8649` | 前端 Vite dev server 端口。 |

### CLI 命令

| 命令 | 说明 |
|---|---|
| `diting-web-ui start` | 后台启动（守护进程模式） |
| `diting-web-ui start --port 9000` | 自定义端口启动 |
| `diting-web-ui stop` | 停止后台进程 |
| `diting-web-ui restart` | 重启后台进程；默认会关闭 bridge broker |
| `diting-web-ui status` | 查看运行状态 |
| `diting-web-ui update` | 更新到最新版本并重启 |
| `diting-web-ui upgrade` | `update` 的别名 |
| `diting-web-ui -v` | 显示版本号 |
| `diting-web-ui -h` | 显示帮助信息 |

`restart`、`update` 和 `upgrade` 默认会停止 Agent Bridge broker，避免重启或更新后的服务复用旧 Python bridge 进程。只有明确希望保留 broker 和正在运行的 bridge session 时，才在重启前设置 `DiTing_AGENT_BRIDGE_STOP_ON_SHUTDOWN=0`。

`update` / `upgrade` 会先尝试执行 `npm cache clean --force`，再执行 `npm install -g diting-web-ui@latest` 并重启。缓存清理是 best-effort；如果清理失败，只提示 warning，升级安装会继续执行。

### 自动配置

启动时 BFF 服务器会自动：

- 初始化 Web UI 数据目录、本地数据库和内置技能
- 启动 `/chat-run` 使用的 DiTing agent bridge
- 启动成功后自动打开浏览器

---

## 开发

```bash
git clone https://github.com/EKKOLearnAI/DiTing-studio.git
cd diting-web-ui
npm install
npm run dev
```

- 前端：http://localhost:8649
- BFF 服务器：http://localhost:8647

```bash
npm run build   # 构建输出到 dist/
```

项目开发规范见：[DEVELOPMENT.md](./DEVELOPMENT.md)。

## 架构

```
浏览器 → BFF (Koa, :18648) → Socket.IO /chat-run
                ↓
        DiTing agent bridge → DiTing Agent runtime
                ↓
           DiTing CLI / profiles
           profile config.yaml    (渠道/Provider 配置)
           profile auth.json      (凭证池)
           腾讯 iLink API         (微信扫码登录)
```

前端采用 **多 Agent 可扩展架构** — 所有 DiTing 相关代码都按命名空间组织在 `DiTing/` 目录下（API、组件、视图、Store），可以方便地并行接入新的 Agent。

BFF 层负责：Socket.IO 聊天流式推送、DiTing agent bridge、按 Profile 隔离的上传和按路径解析的下载（多 Backend 支持：local/Docker/SSH/Singularity）、会话 CRUD、分账户分 Profile 管理、配置/凭证管理、微信扫码登录、模型发现、技能/记忆/插件管理、TTS/STT、Coding Agent 代理、MCP/Runtime 管理、日志读取和静态文件服务。

## 技术栈

**前端：** Vue 3 + TypeScript + Vite + Naive UI + Pinia + Vue Router + vue-i18n + SCSS + markdown-it + highlight.js

**后端：** Koa 2（BFF 服务器）+ node-pty（Web 终端）

## Star 历史

[![Star 历史图表](https://api.star-history.com/svg?repos=EKKOLearnAI/DiTing-studio&type=Date)](https://star-history.com/#EKKOLearnAI/DiTing-studio&Date)

<!-- 如上方图表未加载，可访问 https://star-history.com/#EKKOLearnAI/DiTing-studio -->

## 许可证

[BSL-1.1](./LICENSE)

该许可证覆盖 DiTing Studio、原 DiTing Web UI 名称、`diting-web-ui` npm 包和
CLI、桌面应用、固件、发布产物、文档以及本仓库内的关联文件。
