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

镜像只承担依赖和运行时的稳定层，不包含 Superagent-sec 的应用源码或 `lib/` 构建产物；项目 checkout、研究工作区和运行状态仍由 host 提供。Compose 启动时用 host checkout 构建当前 `lib/`，因此普通代码更新不需要重建镜像。镜像按 CPU 架构发布，不能把 arm64 镜像直接搬到 amd64 主机（反之亦然）。在可联网机器上执行下面的导出脚本：

```sh
./scripts/export-docker-release.sh v0.1.0-sec.2
ls -lh .artifacts/releases/v0.1.0-sec.2/
```

脚本会根据 Dockerfile 的锁定依赖层导出对应架构的 Docker archive，并为每个 archive 生成 `.sha256` 和构建元数据。当前内网使用 `SUPERAGENT_RELEASE_PLATFORMS=linux/amd64`。发布前应确认 checkout 干净，并把 commit SHA 记录在 Release 说明中。

上传到 GitHub Release（联网机器需已安装并登录 `gh`）：

```sh
git push origin feature/superagent-sec-deployment
git tag v0.1.0-sec.2
git push origin v0.1.0-sec.2
gh release create v0.1.0-sec.2 .artifacts/releases/v0.1.0-sec.2/* \
  --prerelease --title 'superagent-sec v0.1.0-sec.2' \
  --notes-file docs/RELEASE-v0.1.0-sec.2.md
```

如果联网机器没有 `gh`，可在 GitHub 网页的该 tag Release 页面上传同一目录中的 `.tar.gz`、`.sha256` 和 `.json` 文件。不要把 API key、web token 或 `deploy/.env` 上传为 Release asset。

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

从 Release 下载后先校验并导入对应架构：

```sh
sha256sum -c superagent-sec-v0.1.0-sec.2-linux-amd64.tar.gz.sha256
docker load < superagent-sec-v0.1.0-sec.2-linux-amd64.tar.gz
sed -i 's/^SUPERAGENT_IMAGE_TAG=.*/SUPERAGENT_IMAGE_TAG=v0.1.0-sec.2-linux-amd64/' deploy/.env
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --no-build
```

升级时先下载并校验新 archive，再执行 `docker load` 和 `docker compose up -d --no-build`；回滚只需把 `SUPERAGENT_IMAGE_TAG` 改回旧版本。源码 checkout 更新不需要重建镜像；只有 `package.json`、`pnpm-lock.yaml`、Dockerfile 或依赖层改变时才构建新的 Release image。

镜像提供 Node、pnpm、DSH、锁定依赖、构建工具和 OpenSSH client；应用 checkout 以只读方式挂载，`node_modules` 与生成的 `lib` 使用独立 volume。源码更新后在 host 执行 `git pull`，再 `docker compose restart`；只有锁文件、`package.json`、Dockerfile 或依赖层改动时才重新构建镜像。

## 挂载和 SSH

每个项目可以包含多个 repo、普通目录、二进制/库文件、反编译伪代码、`workspace/`、`knowledge/`、`reports/`、`runtime/` 和其他资料；不要假设一个项目只有一个 Git，也不要把所有研究输入都称为源码。`sources/` 是受锁定基线管理的项目证据入口，`runtime/artifacts/` 保存构建、镜像和运行产物，`knowledge/` 与 `reports/` 保存研究输出。`SUPERAGENT_DATA_DIR` 保存 SQLite、隔离 DSH Session、token 和 SSH key。

首次容器启动会在 `secrets/ssh/id_ed25519` 自动生成持久 ED25519 key，并打印指纹。把 `id_ed25519.pub` 加到目标 runtime 的 `authorized_keys`；容器只发起 SSH，不运行 SSH server，也不映射宿主机 22 端口。

默认前端只绑定宿主机回环地址。远程访问必须使用 SSH tunnel 或已认证的 TLS 反向代理；不要直接暴露后端 3182，也不要把 token 提交到 Git。

## 并发与模型使用边界

持续研究仍是**单项目实例**，但特殊时间窗可以配置多个独立 research lane。每个 lane 是独立的 Engine Ticket、DSH worker Session 和 round ID；宿主按当前时间窗的 `maxWorkers` 创建 lane，日常没有特殊时间窗时默认只运行一个 lane。全局 `executor.maxWorkers` 是普通工单池上限；研究调度的 `maxWorkers` 是研究池上限（当前可配置 1–256），并通过总容量门控，避免研究并发把普通工单池偷偷扩大。

并发 lane 不共享可写知识目录：主 lane 可以写 `knowledge/`、`reports/` 或 `research/`，其他 lane 必须写入 `research/rounds/<round-id>/`，检查点也会拒绝越界产物。源码和锁定版本仍由所有 lane 只读共享，检查点和 SQLite 状态由宿主提交。窗口结束后已经开始的 lane 可以完成当前 round，但不会在窗口外新开 round。

502、429、限流和网络错误使用宿主持久退避后再重试；主 lane 的不可恢复错误会阻塞调度，次要 lane 的错误只暂停该 lane 并保留面板错误。模型路由在每个新 round 开始前重新选择，因此白天/夜间可以使用不同的 provider、model 和凭据。Planner、Reviewer 和跨项目队列仍未启用。

## 研究设置

持续研究的调度时区、时间段、研究 worker 数量、模型选择和单轮研究时限可在平台的“设置 → 研究调度”中修改，不需要编辑部署文件。默认调度不限单轮时限；只有特殊调度明确选择时限时，单轮研究时限才会从宿主投递本轮研究提案开始计时，并在 agent 提交检查点前由宿主看门狗执行。它不是模型 API 的请求 timeout，也不是 agent 的工具次数或 token 配额。每条调度拥有自己的时区，模型选择直接引用 DSH 全局设置中已经配置的 provider/model；API 地址、凭据和模型 token/采样参数不在 Superagent-sec 中复制维护。

研究 round 创建时绑定当前时间段的模型选择；切换时间段不会中断已经运行的 round。上下文上限、输出上限和 temperature 统一由 DSH 全局模型设置负责，研究调度不重复覆盖。provider route 必须已由 DSH adapter 注册，API 地址和凭据的 wire-level 配置由 DSH 全局设置负责。

## 验收

```sh
./scripts/superagent status
curl --noproxy '*' -H 'x-orchestrator-request: 1' http://127.0.0.1:3182/orchestrator/api/state
```

面板打开后，先确认项目工作区和来源基线，再提交一个具体问题；需要长期研究时在 Superagent-sec 页面启动持续研究。
