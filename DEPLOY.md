# Chatbox 部署与运维

Chatbox 基于 `deepseek-ai/chat-demo` 改造，包含公开注册、普通/VIP/管理员角色、多供应商模型管理、每日积分、私有附件和跨设备聊天同步。

## 运行结构

```text
浏览器
  → https://chat.example.com（云服务器 Nginx + 证书）
  → 云服务器 127.0.0.1:20005（frps 映射）
  → 内网服务器 127.0.0.1:3006（Node + SQLite）
```

Node 服务同时提供 `/api/*` 和构建后的 `dist/` 静态页面。数据和 API Key 只保存在 内网服务器的 `data/` 中。

## 环境要求

- Node.js 24 或更高版本（PDF 文本提取依赖 `unpdf` 的 Node 24+ 支持）
- pnpm 10
- 约 250 MB 可用内存；建议 Node 进程上限 350 MB
- 可持久化 `data/` 目录的磁盘

## 首次部署（PM2，推荐）

以下命令均在 内网服务器执行。项目目录示例为 `~/chatbox`。

```bash
cd ~/chatbox
npm install -g pnpm@10
pnpm install --frozen-lockfile --prod
mkdir -p data/attachments
cp .env.example .env
openssl rand -hex 32
```

把 `openssl rand -hex 32` 的输出填入 `.env` 的 `CONFIG_SECRET`，并设置 `chmod 600 .env`。该值必须保密；更换后，数据库里已有的供应商密钥将无法解密。

创建首个管理员（密码至少 12 位，建议使用密码管理器生成）：

```bash
node build/server/create-admin.js <用户名> <显示名称> <强密码>
```

启动并设置开机恢复：

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
curl http://127.0.0.1:3006/api/health
```

若系统尚未配置 `pm2 startup`，按 `pm2 startup` 输出的提示执行一次。

管理员登录后进入 `/admin`，添加 OpenAI 或 Anthropic 兼容供应商，获取并导入模型，再设置显示名称、高级模型标记、积分倍率、图片/思考能力。供应商 API Key 由服务器加密保存，不会返回给浏览器。

## 构建与更新

可在本机构建后上传 `dist/`、`build/`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`，避免占用服务器内存：

```bash
# 构建机
pnpm install --frozen-lockfile
pnpm build
pnpm server:build
# 上传后，在 Ubuntu 项目目录
pnpm install --frozen-lockfile --prod
pm2 reload ecosystem.config.cjs
```

数据库结构在服务启动时自动补齐。升级前建议先备份。

## 备份与恢复

```bash
pnpm backup
```

备份会写入 `backups/<时间>/`，包含一致性快照 `chat.db` 和全部附件；服务无需停止。

恢复时先停止服务，将备份的 `chat.db` 和 `attachments/` 放回 `data/`，再启动：

```bash
pm2 stop chatbox
cp backups/<时间>/chat.db data/chat.db
rm -rf data/attachments
cp -a backups/<时间>/attachments data/attachments
pm2 start ecosystem.config.cjs
```

## Nginx（云服务器）

`chat.example.com` 必须有独立证书和 `server_name`，不能复用其他子域名站点。示例：

```nginx
server {
    listen 80;
    server_name chat.example.com;
    location /.well-known/acme-challenge/ { root /www/wwwroot/chatbox; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name chat.example.com;

    ssl_certificate     /path/to/chat.example.com.pem;
    ssl_certificate_key /path/to/chat.example.com.key;

    client_max_body_size 40m;

    location / {
        proxy_pass http://127.0.0.1:20005;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 聊天流式响应不能被 Nginx 缓冲
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

修改现有 Nginx 前先备份并执行 `nginx -t`，只改动 chat 域名对应站点，不触碰其他站点。

## FRP（内网服务器）

在 `/etc/frpc.toml` 的 `[[proxies]]` 末尾增加：

```toml
[[proxies]]
name = "chatbox"
type = "tcp"
localIP = "127.0.0.1"
localPort = 3006
remotePort = 20005
```

先备份配置，再重启并检查日志：

```bash
sudo cp /etc/frpc.toml /etc/frpc.toml.bak
sudo systemctl restart frpc
sudo systemctl status frpc --no-pager
ss -lnt | grep 3006
```

云服务器上的 frps 需要允许 20005；Nginx 再代理到 `127.0.0.1:20005`。不要修改其他已有隧道。

## 日常检查

```bash
pm2 logs chatbox --lines 100
curl -I https://chat.example.com
curl http://127.0.0.1:3006/api/health
pm2 monit
```

- 服务只监听 `127.0.0.1:3006`，不要直接暴露公网端口。
- `COOKIE_SECURE=true` 只能在 HTTPS 正常访问时使用。
- 上游 API Key 只在管理后台录入；不要写入源码、Git、聊天或日志。
- 注册是公开的；如需关闭注册，可在后续版本增加注册开关或反滥用验证。
- 用户被禁用、角色改变或修改密码后，旧登录会话会立即失效。

## 本版新增能力

- 模型支持自定义下拉、原生联网搜索模式、能力标签和倍率显示。
- 用户侧新增 `/usage` 积分与用量中心；账号面板可进入。
- 会话支持置顶、文件夹、Ctrl/Cmd+K 全局搜索。
- 会话菜单新增公开可撤销的只读分享与 Markdown/JSON 导出。
- AI 返回的 `svg` 代码可直接在隔离沙箱中预览动画，支持重播、全屏和下载。
- 登录 Cookie 与服务器会话延长到 90 天，并在每次访问时滑动续期。
- 管理后台支持模型删除、供应商模型数量、PC 管理表格和手机卡片布局。

## Ubuntu 20.04 原生 SQLite 依赖

`better-sqlite3` 的预编译二进制要求较新的 glibc。在 Ubuntu 20.04 上首次安装如出现 GLIBC 错误，需要用 GCC 10 编译：

```bash
cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3
CC=gcc-10 CXX=g++-10 \
NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node \
npm_config_disturl=https://npmmirror.com/mirrors/node \
node $HOME/.npm-global/lib/node_modules/pnpm/dist/node_modules/node-gyp/bin/node-gyp.js rebuild --release --force_build=1
```

之后保持 `node_modules` 不删除即可。升级 Node 主版本时需要重新编译。
