# Superagent-sec 部署速查

这份文档给内部 Agent 使用。目标是：普通网络用一个脚本启动；受限内网把镜像带进去；项目源码和研究工作区始终留在 host 上。

## 选择运行方式

| 环境 | 方式 |
| --- | --- |
| 可安装 Node、pnpm、DSH | `scripts/superagent` 本机运行 |
| 不能安装依赖或不能联网 | Docker image + Compose |
| 多个项目 | 每个项目使用独立 `PROJECT_ID`、state、DSH home 和端口 |

不要使用日常 `~/.dsh`。每个项目必须有独立的 `DSH_SUPERAGENT_HOME`，否则普通 Harness Session 会混入研究页面。

## 本机一键启动

```sh
cd /path/to/super-sec-agent
export SUPERAGENT_PROFILE=super-sec-agent-tinyproxy
export DSH_SUPERAGENT_HOME=$HOME/.dsh-super-sec-agent-tinyproxy
export SUPERAGENT_WORKSPACE=/srv/projects/tinyproxy/workspace
export DEEPSEEK_API_KEY='从 secret 注入，不写入文件'
./scripts/superagent start
./scripts/superagent status
```

脚本会安装锁定依赖、构建、启动隔离 DSH profile 和 token 代理。打开它打印的 URL；token 位于 `$DSH_SUPERAGENT_HOME/secrets/web-token`。更新代码后运行 `./scripts/superagent update`，它会暂停研究、拉取、构建、重启并恢复原状态。

## 受限内网镜像

在可联网机器构建并导出：

```sh
docker build -t superagent-sec:stable -f deploy/Dockerfile .
docker save superagent-sec:stable | gzip > superagent-sec.tar.gz
```

内网准备源码 checkout、项目根和运行数据，然后复制 `deploy/.env.example` 为 `deploy/.env`：

```sh
export SUPERAGENT_SOURCE_DIR=/srv/superagent-sec/app
export SUPERAGENT_PROJECTS_DIR=/srv/superagent-sec/projects
export SUPERAGENT_PROJECT_ID=tinyproxy
export SUPERAGENT_DATA_DIR=/srv/superagent-sec/runtime/tinyproxy
export DEEPSEEK_API_KEY='从内网 secret 注入'
docker load < superagent-sec.tar.gz
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --no-build
docker compose --env-file deploy/.env -f deploy/compose.yaml logs -f
```

镜像提供 Node、pnpm、DSH、依赖、构建工具和 OpenSSH client；源码以只读方式挂载，`node_modules` 与 `lib` 使用独立 volume。源码更新后在 host 执行 `git pull`，再 `docker compose restart`；锁文件或 `package.json` 改动时重新构建镜像。

## 挂载和 SSH

每个项目可以包含多个 repo、普通目录、`workspace/`、`knowledge/`、`reports/`、`runtime/` 和其他资料；不要假设一个项目只有一个 Git。`SUPERAGENT_DATA_DIR` 保存 SQLite、隔离 DSH Session、token 和 SSH key。

首次容器启动会在 `secrets/ssh/id_ed25519` 自动生成持久 ED25519 key，并打印指纹。把 `id_ed25519.pub` 加到目标 runtime 的 `authorized_keys`；容器只发起 SSH，不运行 SSH server，也不映射宿主机 22 端口。

默认前端只绑定宿主机回环地址。远程访问必须使用 SSH tunnel 或已认证的 TLS 反向代理；不要直接暴露后端 3182，也不要把 token 提交到 Git。

## 并发与模型使用边界

当前持续研究是**单项目、单研究 Ticket、单 worker Session、单模型路由**。每轮只投递一个研究提案，不会同时调用多个 DeepSeek API，也不会自动把一个问题拆给多个算力。通用 DSH Executor 仍支持多个独立 Ticket，但本地研究工作区刻意串行，以免多个 worker 同时写入 `knowledge/` 和 `reports/` 造成证据冲突。

未来的 Planner、Researcher、Reviewer 多 Agent 方案尚未启用。不要通过提高 `maxWorkers` 来开启研究并发；那只影响通用 Ticket，不会让同一个研究前沿安全地并行执行。并发研究需要独立 round 目录、证据合并和冲突处理，属于后续里程碑。

## 验收

```sh
./scripts/superagent status
curl --noproxy '*' -H 'x-orchestrator-request: 1' http://127.0.0.1:3182/orchestrator/api/state
```

面板打开后，先确认项目工作区和来源基线，再提交一个具体问题；需要长期研究时在 Superagent-sec 页面启动持续研究。
