# Chatbox

> 一个可自托管的私人 AI 聊天工作空间：多用户账户、模型权限、每日积分、供应商管理、跨设备会话同步与完整的运营后台。

简体中文 | [English](README.en.md)

本项目基于 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 二次开发。上游是一个纯前端静态聊天页；本仓库把它改造成**前后端一体、可多用户运营**的自托管版本：浏览器不再直接持有上游 API Key，所有模型请求、账户、额度和附件都由自己的 Node 服务转发与保存。

## 功能

### 聊天体验

- 流式回复、深度思考、停止/继续生成、重新生成、编辑提问与消息分支切换。
- Markdown、代码高亮、KaTeX 公式、Mermaid 图表。
- 图片、PDF、DOCX、文本等附件上传与解析；支持粘贴和拖拽，可一次多选图片或文件。
- 原生联网搜索（OpenAI / Anthropic 兼容模式）与来源引用展示。
- AI 返回的 SVG 代码可在隔离沙箱中直接预览动画，支持重播、全屏和下载。
- 会话搜索（`Ctrl/Cmd + K`）、置顶、分类（可折叠、可在分类内直接新建对话）。
- 公开只读分享链接（可撤销）、Markdown / JSON 导出。

### 智能体与工作区

- 联网智能体：多轮工具调用、内网搜索与工作区读写；搜索后端、搜索模型、轮数、并发与超时可在管理后台配置，`AGENT_ENABLED=0` 可整体回退到单次模型调用。
- 工作区任务：耗时生成任务在服务端执行，`/files` 页面查看进度、下载产物、重试或删除；产物默认保留 15 天。
- 斜杠命令与插件：内置解题、规划、写作、翻译、代码、总结、PPT、Word、Excel、数学、Mermaid、SVG、HTML 等模板，可在后台启停和调整。
- Office 输出：支持生成并下载 Word（docx）、PPTX 和 Excel；PPT 可选原生 SVG → PPTX 渲染（PPT Master），未配置时自动回退到 PptxGenJS。
- 富内容预览：HTML / SVG 沙箱预览、图片查看器、文件任务卡片与会话自动压缩。

### 账户与额度

- 管理员创建账号；设置 `ALLOW_REGISTRATION=1` 可临时开放公开注册。角色分为普通用户、VIP、管理员。
- 按自然日（北京时间）发放积分，按 token × 模型倍率计费；支持每日限额与不限量账号。
- 生成前预留、生成后结算，异常中断会回收预留积分。
- 积分与用量中心：今日额度、重置时间、最近 7 天趋势、按模型统计与请求明细。
- 登录 Cookie 与服务端会话有效期 90 天，并在访问时滑动续期。

### 管理后台

- 独立的 `/admin` 全屏管理界面，仅管理员可进入。
- 用户管理：创建账号、调整角色/VIP、每日积分、不限量、停用、重置密码。
- 供应商管理：OpenAI / Anthropic 兼容接口，API Key 使用 AES-GCM 加密后存入数据库。
- 模型管理：发现并导入模型，设置显示名、高级模型标记、倍率、图片/文件/思考/搜索能力。
- 智能体设置：搜索后端、搜索模型、轮数、搜索次数、文件数与超时；提供连通性探测。
- 提示词与插件：编辑系统提示词、恢复默认，管理内置/自定义斜杠命令插件。
- 用量统计与用户用量明细。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18、TypeScript、Rspack、Zustand、CSS Modules |
| 后端 | Node.js 24+、Fastify 5、better-sqlite3 |
| 数据 | SQLite（会话、消息、附件索引、账户、积分账本、分享）|
| 模型接入 | OpenAI / Anthropic 兼容 API（流式 SSE）|
| 部署 | PM2 或 Docker，可配合 Nginx / FRP |

## 快速开始

要求：**Node.js 24+**、**pnpm 10+**。

```bash
pnpm install
cp .env.example .env
```

编辑 `.env`，至少设置一个足够随机的 `CONFIG_SECRET`（≥ 32 个字符）：

```bash
openssl rand -hex 32
```

默认不开放公开注册：先在服务器上创建首个管理员，之后由管理员在后台创建其他账号。如需临时开放注册，在 `.env` 中设置 `ALLOW_REGISTRATION=1`。

创建首个管理员（密码至少 12 位）：

```bash
pnpm admin:create admin 管理员 '替换成你的强密码'
```

构建并启动：

```bash
pnpm build
pnpm server:build
pnpm server
```

打开 <http://127.0.0.1:3006>，使用刚创建的管理员登录，然后进入 **管理后台 → 供应商** 添加模型接口。

> `pnpm dev` 只启动前端开发服务器（8090），接口需要自行配置代理；日常本地运行直接使用上面的构建 + `pnpm server` 即可。
>
> `better-sqlite3` 自带各平台预编译二进制，因此本仓库跳过它的构建脚本，`pnpm install` 时出现 `Ignored build scripts: better-sqlite3` 属正常现象。如果你的平台没有对应预编译包，执行 `pnpm approve-builds` 允许本地编译。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `development` | 生产环境设为 `production` |
| `HOST` | `127.0.0.1` | 监听地址；公网部署应保持仅本机监听，由反向代理转发 |
| `PORT` | `3006` | 服务端口 |
| `DATA_DIR` | `./data` | SQLite 与附件的持久化目录 |
| `STATIC_DIR` | `./dist` | 前端构建产物目录 |
| `COOKIE_SECURE` | `false` | HTTPS 部署时设为 `true` |
| `TRUST_PROXY` | `false` | 位于反向代理之后时设为 `true` |
| `CONFIG_SECRET` | 无 | **必填**，用于加密数据库中的供应商 API Key；设置后不要更换 |
| `ALLOW_REGISTRATION` | 未设置 | 空值表示关闭公开注册（由管理员创建账号）；设为 `1` 临时开放 |
| `AGENT_ENABLED` | `1` | 设为 `0` 关闭联网智能体，回退到单次模型调用 |
| `PPTMASTER_PYTHON` | 无 | 可选，PPT Master 虚拟环境中的 Python 路径 |
| `PPTMASTER_HOME` | 无 | 可选，PPT Master 的 `skills/ppt-master` 目录；未配置时使用 PptxGenJS |

## 部署

### PM2

```bash
pnpm install --frozen-lockfile --prod
pm2 start ecosystem.config.cjs
pm2 save
curl http://127.0.0.1:3006/api/health
```

### Docker

```bash
cp .env.example .env   # 设置 CONFIG_SECRET 等
docker compose up -d --build
```

`compose.yaml` 默认只绑定 `127.0.0.1:3006`，并把 `./data` 挂载为持久化目录。

### 反向代理

生产环境建议在前面放 Nginx/Caddy 并启用 HTTPS。流式回复需要关闭代理缓冲，例如 Nginx：

```nginx
location / {
    proxy_pass http://127.0.0.1:3006;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

更多运维细节（备份、恢复、FRP、Nginx 示例、常见问题）见 [DEPLOY.md](DEPLOY.md)。

## 备份

```bash
pnpm backup
```

备份包含一致性快照的 `chat.db` 和全部附件，写入 `backups/<时间>/`，服务无需停止。`data/` 与 `backups/` 均不会进入 Git。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm server` | 以 tsx 直接启动后端（读取 `.env`） |
| `pnpm build` | 构建前端到 `dist/` |
| `pnpm server:build` | 编译后端到 `build/` |
| `pnpm type` / `pnpm server:type` | 前端 / 后端类型检查 |
| `pnpm lint` | oxlint 检查 |
| `pnpm format` | oxfmt 格式化 |
| `pnpm test:integration` | 后端集成测试（本地 mock 上游，不消耗真实额度） |
| `pnpm mock:upstream` | 启动本地 OpenAI 兼容 mock（默认 3901） |
| `pnpm admin:create` | 创建首个管理员 |
| `pnpm backup` | 备份数据库与附件 |

## 目录结构

```text
src/                 前端（React）
  app/               页面框架、路由与主题
  components/        聊天、侧栏、账户、管理后台、用量页、文件工作区等
  services/          认证、聊天状态、工作区任务、插件、模型、上传、分享等
server/              Fastify 后端
  providers/         OpenAI / Anthropic 适配（含多轮与推理）
  routes*.ts         账户、聊天、模型、管理、分享、用量、工作区、插件、智能体接口
  agent-loop.ts      智能体工具循环
  workspace.ts       工作区任务与产物（15 天清理）
  pptmaster.ts       可选的原生 PPTX 渲染
  quota.ts           积分预留与结算
  db.ts              SQLite 表结构与迁移
shared/              前后端共享类型、自动技能与北京时间工具
scripts/             备份与本地 mock 上游
```

## 安全说明

- 上游 API Key 只保存在服务端数据库，使用 `CONFIG_SECRET` 加密；不会返回给浏览器。
- 生产环境必须设置 `CONFIG_SECRET`，并通过 HTTPS 访问（`COOKIE_SECURE=true`）。
- 密码使用 scrypt 哈希；用户被停用、角色变更或修改密码后，旧会话立即失效。
- 公开注册默认关闭；开放期间仍受 IP 注册频率限制。
- 写操作会校验 `Origin`，附件按用户隔离，分享链接只暴露只读快照。
- 不要把 `.env`、`data/`、`backups/` 提交到 Git。

## 与上游的差异

- 增加完整的账户、角色、积分与用量体系。
- 增加供应商/模型管理后台与加密密钥存储。
- 聊天、附件、会话从浏览器本地迁移到服务端 SQLite，并支持跨设备同步。
- 增加分类、置顶、全文会话搜索、分享、导出和 SVG 沙箱预览。
- 增加联网智能体、工作区任务、斜杠命令插件、提示词管理、会话压缩与 Office 文档生成。
- 前端重做为 Chatbox 品牌的中文界面，适配桌面与移动端。

## 推送到自己的仓库

本目录保留了上游的提交历史，原仓库远端已命名为 `upstream`，避免误推到上游。把代码放到自己的 GitHub fork 时：

```bash
git remote add origin https://github.com/<你的用户名>/chat-demo.git
git push -u origin main
```

后续同步上游：

```bash
git fetch upstream
git merge upstream/main
```

## 许可证

[MIT](LICENSE)。上游项目同样使用 MIT 许可证；使用和分发时请保留原始版权声明。
