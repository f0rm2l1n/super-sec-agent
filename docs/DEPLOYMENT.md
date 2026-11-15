# Superagent-sec 部署速查

这份文档给内部 Agent 使用。目标是：普通网络用一个脚本启动；受限内网把稳定运行时镜像带进去；当前 checkout 在 Compose 构建应用镜像；项目工作区和研究状态始终留在 host 上。

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

发布的镜像只承担依赖和运行时的稳定层，不包含 Superagent-sec 的应用源码或 `lib/` 构建产物。Compose 使用当前 checkout 构建一个本地应用镜像，应用源码和 `lib/` 都在这个镜像层中；目标项目工作区和运行状态仍由 host 提供。这样代码更新只需重新构建应用层，依赖变化才需要新的运行时 Release。镜像按 CPU 架构发布，不能把 arm64 镜像直接搬到 amd64 主机（反之亦然）。在可联网机器上执行下面的导出脚本：

```sh
./scripts/export-docker-release.sh v0.1.0-sec.6
ls -lh .artifacts/releases/v0.1.0-sec.6/
```

脚本会根据 Dockerfile 的锁定依赖层导出对应架构的 Docker archive，并为每个 archive 生成 `.sha256` 和构建元数据。当前内网使用 `SUPERAGENT_RELEASE_PLATFORMS=linux/amd64`。发布前应确认 checkout 干净，并把 commit SHA 记录在 Release 说明中。

导出前先运行本地容器 smoke check，验证运行时镜像能作为基础层，并且当前 checkout 会在应用镜像中完成构建：

```sh
SUPERAGENT_RUNTIME_IMAGE=superagent-sec-runtime:smoke \
SUPERAGENT_APP_IMAGE=superagent-sec-app:smoke \
./scripts/container-smoke.sh
```

上传到 GitHub Release（联网机器需已安装并登录 `gh`）：

```sh
git push origin feature/superagent-sec-deployment
git tag v0.1.0-sec.6
git push origin v0.1.0-sec.6
gh release create v0.1.0-sec.6 .artifacts/releases/v0.1.0-sec.6/* \
  --prerelease --title 'superagent-sec v0.1.0-sec.6' \
  --notes-file docs/RELEASE-v0.1.0-sec.6.md
```

如果联网机器没有 `gh`，可在 GitHub 网页的该 tag Release 页面上传同一目录中的 `.tar.gz`、`.sha256` 和 `.json` 文件。不要把 API key、web token 或 `deploy/.env` 上传为 Release asset。

内网准备源码 checkout、项目根和运行数据，然后复制 `deploy/.env.example` 为 `deploy/.env`。源码 checkout 只作为 Compose build context，不挂载进运行中的容器：

```sh
export SUPERAGENT_PROJECTS_DIR=/srv/superagent-sec/projects
export SUPERAGENT_PROJECT_ID=tinyproxy
export SUPERAGENT_DATA_DIR=/srv/superagent-sec/runtime/tinyproxy
docker load < superagent-sec-runtime-v0.1.0-sec.6-linux-amd64.tar.gz
docker compose --env-file deploy/.env -f deploy/compose.yaml build
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
docker compose --env-file deploy/.env -f deploy/compose.yaml logs -f
```

部署前只做网页健康检查时，项目目录可以为空；要开始真实研究，则按下面顺序准备一个标准工作区。只准备 `sources/` 不够，`project.json`、`SCOPE.md` 和 `sources.lock.json` 共同定义研究对象与固定版本。`knowledge/`、`reports/`、`runtime/`、`interactions/` 等空目录由 `expert init` 自动生成，后续按实际研究填写。

先只创建项目容器目录，不要先创建 `workspace/`，因为 `init` 要求工作区为空：

```sh
install -d -m 0750 /srv/superagent-sec/projects/tinyproxy
install -d -m 0750 /srv/superagent-sec/runtime/tinyproxy
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm --no-deps \
  --entrypoint pnpm superagent-sec expert init \
  --workspace /var/lib/superagent/projects/tinyproxy/workspace \
  --id tinyproxy --topic '项目安全机制与信任边界'
```

然后把一个或多个 Git checkout、普通目录、二进制或伪代码资料放入 `workspace/sources/`，编辑 `project.json` 登记它们并选择 `primarySource`，补充 `SCOPE.md`，再固定和检查工作区：

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm --no-deps --entrypoint pnpm superagent-sec expert lock --workspace /var/lib/superagent/projects/tinyproxy/workspace
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm --no-deps --entrypoint pnpm superagent-sec expert check --workspace /var/lib/superagent/projects/tinyproxy/workspace
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm --no-deps --entrypoint pnpm superagent-sec expert prepare --workspace /var/lib/superagent/projects/tinyproxy/workspace
```

如果已有完整工作区，可以直接复制它，不要再次运行 `init`；确认 `expert check` 通过后再启动持续研究。目标动态运行所需的环境、构建和启动信息放入 `workspace/runtime/`，不需要为了首次启动预先安装所有工具。

`SUPERAGENT_EXTERNAL_ENV_FILE` 默认是 `/dev/null`，所以首次健康检查不需要额外的 secret 文件。若运行者要通过环境变量提供模型凭据或完整 DSH patch，先创建一个只允许运行者读取的文件，再把 `.env` 中的路径改到它：

```sh
install -m 600 /dev/null /srv/superagent-sec/runtime/tinyproxy/external.env
# 写入需要的环境变量后再执行 docker compose build/up
```

如果使用完整的外部 patch，设置 `SUPERAGENT_DSH_PATCH_FILE=/run/superagent/dsh.patch.yml`；对应的 host 文件由 `SUPERAGENT_DSH_PATCH_HOST_FILE` 只读挂载。未设置外部 patch 时，入口脚本会把 DSH 首次生成的空 patch（`[]`）替换为隔离 web、state、workspace 的默认 patch。模型/provider 仍由 DSH 全局设置或外部 patch 管理，部署脚本不会写死任何模型。

若使用完整外部 patch，先确保 host 文件已经存在且权限为 600：`install -m 600 /path/to/patch.yml /srv/superagent-sec/runtime/tinyproxy/dsh.patch.yml`。自定义 `SUPERAGENT_SSH_KEY_FILE` 只能填写容器内可见的路径；默认留空，由持久化 `secrets/ssh` 自动生成 key。

从 Release 下载后先校验并导入对应架构：

```sh
sha256sum -c superagent-sec-runtime-v0.1.0-sec.6-linux-amd64.tar.gz.sha256
docker load < superagent-sec-runtime-v0.1.0-sec.6-linux-amd64.tar.gz
sed -i 's#^SUPERAGENT_RUNTIME_IMAGE=.*#SUPERAGENT_RUNTIME_IMAGE=superagent-sec-runtime:v0.1.0-sec.6-linux-amd64#' deploy/.env
docker compose --env-file deploy/.env -f deploy/compose.yaml build
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
```

升级时先下载并校验新 archive，再执行 `docker load`、`docker compose build` 和 `docker compose up -d`；回滚只需把 `SUPERAGENT_RUNTIME_IMAGE` 改回旧版本并重新构建应用层。源码 checkout 更新后执行 `git pull`、`docker compose build` 和 `docker compose up -d`。只有 `package.json`、`pnpm-lock.yaml`、Dockerfile 或依赖层改变时才构建新的 Release runtime image。

运行时镜像提供 Node、pnpm、DSH、锁定依赖、OpenSSH client，以及 agent 常用的 `bash`、`python3`、`ripgrep`、`jq`、`curl`、`file`、`binutils`、`sqlite3`、`unzip`、`xxd`、`procps` 等分析工具；它不包含目标项目源码。应用镜像由 Compose 从当前 checkout 构建，包含 Superagent-sec 源码和生成的 `lib/`。容器启动时不向 checkout、`node_modules` 或 `lib` 写入任何内容，也不依赖 host 上的 Node 依赖。需要编译大型目标项目或安装项目专属依赖时，连接目标 runtime 或使用项目自己的构建容器，不把编译器和任意 pip 包塞进稳定 runtime 镜像。

## 挂载和 SSH

每个项目可以包含多个 repo、普通目录、二进制/库文件、反编译伪代码、`workspace/`、`knowledge/`、`reports/`、`runtime/` 和其他资料；不要假设一个项目只有一个 Git，也不要把所有研究输入都称为源码。`sources/` 是受锁定基线管理的项目证据入口，`runtime/artifacts/` 保存构建、镜像和运行产物，`knowledge/` 与 `reports/` 保存研究输出。`SUPERAGENT_DATA_DIR` 保存 SQLite、隔离 DSH Session、token 和 SSH key。

Compose 默认以容器 root 运行，以保证 DSH、工具链和目标工作区都能正常读写；Linux host 上新生成的 state、知识文件和 SSH 目录可能因此属于 root。内网部署请使用专用 host/runtime 账号，备份或清理这些目录时通过该账号的 Docker 权限执行容器内命令，并把项目资料与运行状态分开备份。不要把 `SUPERAGENT_DATA_DIR` 指向日常用户的 home 配置目录。

首次容器启动会在 `secrets/ssh/id_ed25519` 自动生成持久 ED25519 key，并打印指纹。把 `id_ed25519.pub` 加到目标 runtime 的 `authorized_keys`；容器只发起 SSH，不运行 SSH server，也不映射宿主机 22 端口。

默认前端只绑定宿主机回环地址。远程访问必须使用 SSH tunnel 或已认证的 TLS 反向代理；不要直接暴露后端 3182，也不要把 token 提交到 Git。

## 并发与模型使用边界

持续研究仍是**单项目实例**，但特殊时间窗可以配置多个独立 research lane。每个 lane 是独立的 Engine Ticket、DSH worker Session 和 round ID；宿主按当前时间窗的 `maxWorkers` 创建 lane，日常没有特殊时间窗时默认只运行一个 lane。全局 `executor.maxWorkers` 是普通工单池上限；研究调度的 `maxWorkers` 是研究池上限（当前可配置 1–256），并通过总容量门控，避免研究并发把普通工单池偷偷扩大。

并发 lane 不共享可写知识目录：主 lane 可以写 `knowledge/`、`reports/` 或 `research/`，其他 lane 必须写入 `research/rounds/<round-id>/`，检查点也会拒绝越界产物。源码和锁定版本仍由所有 lane 只读共享，检查点和 SQLite 状态由宿主提交。窗口结束后已经开始的 lane 可以完成当前 round，但不会在窗口外新开 round。

502、429、限流和网络错误使用宿主持久退避后再重试；主 lane 的不可恢复错误会阻塞调度，次要 lane 的错误只暂停该 lane 并保留面板错误。模型路由在每个新 round 开始前重新选择，因此白天/夜间可以使用不同的 provider、model 和凭据。Planner、Reviewer 和跨项目队列仍未启用。

## 研究设置

持续研究的调度时区、时间段、研究 worker 数量、模型选择和单轮研究时限可在平台的“设置 → 研究调度”中修改，不需要编辑部署文件。默认调度不限单轮时限；只有特殊调度明确选择时限时，单轮研究时限才会从宿主投递本轮研究提案开始计时，并在 agent 提交检查点前由宿主看门狗执行。它不是模型 API 的请求 timeout，也不是 agent 的工具次数或 token 配额。每条调度拥有自己的时区，模型选择直接引用 DSH 全局设置中已经配置的 provider/model；API 地址、凭据和模型 token/采样参数不在 Superagent-sec 中复制维护。

研究 round 创建时绑定当前时间段的模型选择；切换时间段不会中断已经运行的 round。上下文上限、输出上限和 temperature 统一由 DSH 全局模型设置负责，研究调度不重复覆盖。Superagent-sec 的镜像、Compose 和入口脚本不配置 provider、模型名或 API key；provider route 必须由 DSH 全局模型设置或运行者提供的完整 `SUPERAGENT_DSH_PATCH_FILE` 注册。外部 patch 通过 `SUPERAGENT_DSH_PATCH_HOST_FILE` 只读挂载，凭据放在 `SUPERAGENT_EXTERNAL_ENV_FILE` 指向的运行者 secret 文件中，两个文件都留在运行目录并保持 600 权限。

## 验收

```sh
./scripts/superagent status
curl --noproxy '*' -H 'x-orchestrator-request: 1' http://127.0.0.1:3182/orchestrator/api/state
```

上面是本机脚本模式的后端检查。Compose 模式只发布带 token 的 3184 网关，使用 `docker compose ... exec -T superagent-sec curl --fail -H 'x-orchestrator-request: 1' http://127.0.0.1:3182/orchestrator/api/state`，或打开容器日志中打印的已认证 URL；URL 中的主机名由 `SUPERAGENT_WEB_ADVERTISE_HOST` 控制，默认是 `127.0.0.1`。

面板打开后，先确认项目工作区和来源基线，再提交一个具体问题；需要长期研究时在 Superagent-sec 页面启动持续研究。
