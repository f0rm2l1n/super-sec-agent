# 开发起点：Super-agent fork 与安全专家定制

部署请先阅读[部署速查](DEPLOYMENT.md)。本文件保留完整的开发、升级、工作区和研究协议说明；内部 Agent 不需要从长篇背景中自行推断启动步骤。

本项目直接 fork DeepSeek Super-agent，在定制分支修改正式源码。来源和许可证见[第三方说明](../THIRD_PARTY.md)。上游原型的默认角色是处理开发任务的工程师，需要逐步改造成懂攻也懂防、能积累知识并与用户共同研究的驻项目安全专家。

## 仓库与分支

- `origin`：[f0rm2l1n/brainafk-super](https://github.com/f0rm2l1n/brainafk-super)。
- `upstream`：[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)。
- `main`：初始与 fork 的 `origin/main` 对齐。
- `brainafk/security-expert`：产品定制分支，从上游 `6337fc823ce20251c8de8085948165c81aaa701e` 开始。
- `project-definition`：保留此前首次产品文档提交 `a9020df` 的本地分支。

直接维护 fork，按产品需要修改角色、流程、来源和知识能力。上游后续更新需要评估后选取或合并，不承诺兼容所有上游功能。原先被忽略的参考 checkouts 不再作为本项目的开发位置。

## 换机开发

克隆产品定制分支；`main` 仍保留上游基线：

```sh
git clone --branch brainafk/security-expert https://github.com/f0rm2l1n/brainafk-super.git
cd brainafk-super
pnpm install --frozen-lockfile
pnpm build
```

然后按下文“本地运行”准备标准研究工作区，按“启动本地研究服务与交互”创建独立 DSH Web profile、配置模型并启动网页。前端源码位于 `src/client/`；DSH 的整体聊天外壳由其前端插件提供，进一步定制时可保留后端执行能力。

Git 包含产品源码、提示词、工作区模板和测试；`workspaces/`、`.artifacts/`、真实源码、研究知识、会话状态、日志及模型凭据不随克隆迁移。新机器应配置自己的模型提供方和绝对路径，不依赖原机器忽略的启动器或 OpenCode 配置。

若要继续使用已有研究知识，另行同步对应 `workspaces/<project>/`，在新机器运行 `pnpm expert check`、`pnpm expert prepare`，并为它创建新的 profile 和 stateDir。工作区知识可迁移；旧聊天历史与自动调度状态还依赖 DSH 会话存储和绑定原绝对路径的 SQLite，不会仅凭复制工作区自动恢复。

## 当前增量

| 路径 | 用途 |
| --- | --- |
| `src/security/project.ts` | 将本地 Git ref 解析为确定 SHA，不修改目标仓库 |
| `src/security/security-profile.ts` | 利用现有 prompt 接口生成安全专家配置 |
| `src/security/workspace.ts` | 标准项目工作区、多个源码仓库的版本锁与校验、完整研究上下文 |
| `src/security/cli.ts` | 工作区初始化、锁定、检查、准备与角色提示词预览入口 |
| `src/security/local-research.ts` | 本地工作区绑定、请求/纠正接入、持久回复与会话视图 |
| `src/client/research.tsx` | 管理面板中的提问、纠正、回复历史和研究会话入口 |
| `templates/security-workspace/` | 可复用的项目安全工作区模板 |
| `prompts/security/` | 懂攻也懂防的角色、研究过程和研究技能 |
| `tests/security-profile.spec.ts` | 配置校验、持久化与版本解析的集成测试 |
| `tests/security-workspace.spec.ts` | 多仓库、整体迁移、版本漂移与项目数据保护的集成测试 |

本增量已接通本地工作区与现有 DSH 引擎、执行器、会话和持久回复，支持用户问答与持续自主研究。持续选题与跨轮推进已完成真实模型连通性验收，长期知识质量与专家效果仍需验证。框架内部的包名和插件 ID 暂沿用 `dsh-superagent`。

飞书不属于产品需求，默认 bundle 已移除该插件入口。上游遗留的相关实现尚未逐项裁剪。GitHub 是可选的上游工作模式：指定 `workspace` 时直接研究本地资料，不探测 GitHub/飞书账号、不要求推送权限、不启用外部来源；未指定时才沿用上游 GitHub 启动检查。

## 本地运行

需要 Node.js 22.19+ 或 24+ 和 pnpm 10.15.1。

```sh
pnpm install --frozen-lockfile
pnpm exec tsx src/security/cli.ts --help
```

正式研究对象使用[标准项目安全工作区](WORKSPACES.md)，一个对象可以包含多个源码仓库：

```sh
pnpm expert init --workspace ./workspaces/example \
  --id example --topic '项目权限与隔离机制'
# 填写 project.json、SCOPE.md，并准备 sources/ 下的源码后：
pnpm expert lock --workspace ./workspaces/example
pnpm expert check --workspace ./workspaces/example
pnpm expert prepare --workspace ./workspaces/example
```

模板、格式和命令进入产品 Git；真实项目源码、知识、交互、运行及可选的 evaluation 均保留在忽略的工作区中。配置使用相对路径，工作区迁移后重新 check、prepare；不需要针对每个研究对象编写准备脚本。

工作区按安全研究人员的初始目录组织，包含 docs/、vulnerabilities/、exploits/、experiments/ 和 reports/。runtime/ 用于研究目标的环境、构建、部署与真实路径验证；prepare 只生成 .agent/ 中的专家配置，不覆盖目标启动资料或启动目标。agent 可以继续扩展目录。

低层单仓库接口仍可用于临时配置生成；以下只预览输入，不创建标准工作区：

```sh
pnpm exec tsx src/security/cli.ts profile \
  --project . \
  --ref HEAD \
  --topic '项目权限与隔离机制：保护目标、实现、配置条件及潜在绕过' \
  --knowledge-dir ./artifacts/knowledge
```

`profile` 向标准输出写出 JSON。换成 `preview` 可查看执行会话的完整提示词；加 `--role orchestrator` 可查看主会话。生成和预览不会启动服务、调用模型或创建知识目录。

ref 会解析为确定 SHA 并写入配置。研究其他版本需要重新生成；本入口尚不监听分支、不准备 checkout。配置中的目标版本必须与实际执行时读取的代码一致。

## 启动本地研究服务与交互

服务和前端由 DSH Web profile 承载，不是独立的前后端开发服务器。每个项目使用独立 profile、`DSH_HOME`、`stateDir` 和端口。`DSH_HOME` 必须是该项目专用目录；直接使用默认 `~/.dsh` 会把日常 Harness 的 Session、附件、凭据和设置混入项目界面。需要兼容版本的 DSH 和模型提供方；若机器上安装的是旧 DSH，可用下列固定版本命令，不修改全局安装。

只对**不存在的新 profile** 执行初始化命令；`--from-default-profile` 会重建同名配置，不能用于升级已有实例。

```sh
pnpm build
# 确认 ~/.dsh/profiles/brainafk-hmdfs 尚不存在，再执行：
pnpm dlx @deepseek-ai/dsh@0.2.1-rc.3 brainafk-hmdfs --from-default-profile web --dump-config > /dev/null
pnpm dlx @deepseek-ai/dsh@0.2.1-rc.3 plugin --profile brainafk-hmdfs add "link:$PWD"
```

将 [本地模式配置模板](../examples/local-workspace.cordis.patch.yml) 的内容填入该新 profile 的 `cordis.patch.yml`，例如：

```yaml
- id: webserver
  config:
    host: 127.0.0.1
    port: 3082
- id: dsh-superagent
  config:
    stateDir: /home/me/.dsh/state/brainafk-hmdfs
    workspace: /absolute/path/to/workspaces/hmdfs
- id: dsh-superagent-github
  disabled: true
```

`workspace` 必须是已通过 `pnpm expert check` 的标准工作区。`stateDir` 保存 SQLite、DSH 编排身份与执行环境；首次绑定后不可复用于其他项目，也不要沿用旧 GitHub 任务的 stateDir。

```sh
export DSH_SUPERAGENT_HOME="$HOME/.dsh-superagent/hmdfs"
DSH_HOME="$DSH_SUPERAGENT_HOME" \
DSH_AGENTS_HOME="$DSH_SUPERAGENT_HOME/agents" \
pnpm dlx @deepseek-ai/dsh@0.2.1-rc.3 --profile brainafk-hmdfs
```

启动脚本 `scripts/dsh-superagent` 会把已有 profile 复制到 `DSH_SUPERAGENT_HOME` 后再启动，并且不会复制默认 Harness 的 `.credentials.yaml`、Session 或附件目录。模型凭据应通过项目实例自己的环境变量或 Web 设置写入；不要把默认 `~/.dsh` 作为项目运行目录。

### 可迁移运行布局与 Web 鉴权

每个被测项目使用一个独立的运行根目录，不把项目状态混进代码 checkout，也不复用日常 DSH profile：

```text
/srv/superagent-sec/
├── app/                         # 本仓库 checkout，容器内只读
├── projects/<project-id>/
    ├── workspace/               # 标准安全研究工作区，可迁移、可写
    │   ├── sources/             # 被测项目源码 checkout
    │   ├── knowledge/ reports/  # 研究产物
    │   └── runtime/             # 构建、启动和环境记录
└── runtime/<project-id>/
    ├── state/                   # SQLite、worker-bin、gitconfig
    ├── dsh-home/                # 该项目专用 DSH profile、Session、附件
    ├── logs/                    # 启动和代理日志
    └── secrets/                 # token、模型凭据，权限 0700
```

代码 checkout 可以挂载为 `/app:ro`；`workspace/`、`state/` 和 `dsh-home/` 必须是独立的可写卷。迁移时复制 `workspace/` 和必要的 `state/` 备份，重新构建 `/app`，不要复制日常 `~/.dsh`，也不要把 secrets 放进 Git 或镜像。

后端只绑定回环地址，前端通过项目内置的双层鉴权代理启动：

```sh
export DSH_SUPERAGENT_HOME=/srv/superagent-sec/projects/tinyproxy/dsh-home
export DSH_SUPERAGENT_ACCESS_TOKEN_FILE=/srv/superagent-sec/projects/tinyproxy/secrets/web-token
DSH_HOME="$DSH_SUPERAGENT_HOME" DSH_AGENTS_HOME="$DSH_SUPERAGENT_HOME/agents" \
  scripts/dsh-superagent start --profile super-sec-agent-tinyproxy --url http://127.0.0.1:3182
DSH_HOME="$DSH_SUPERAGENT_HOME" \
  DSH_SUPERAGENT_ACCESS_TOKEN_FILE="$DSH_SUPERAGENT_ACCESS_TOKEN_FILE" \
  node scripts/dsh-superagent-web-auth.mjs
```

换机后推荐使用统一入口，避免手动记住多个进程和端口：

```sh
export SUPERAGENT_PROFILE=super-sec-agent-tinyproxy
export DSH_SUPERAGENT_HOME=/srv/superagent-sec/projects/tinyproxy/dsh-home
export DSH_SUPERAGENT_ACCESS_TOKEN_FILE=/srv/superagent-sec/projects/tinyproxy/secrets/web-token
./scripts/superagent start    # 首次安装依赖（锁定版本）并构建，然后启动前后端
./scripts/superagent status
./scripts/superagent update   # 暂停持续研究 → git pull --ff-only → install/build → 重启 → 恢复原状态
```

内网无法直接访问包仓库时，在执行入口前显式设置 `SUPERAGENT_HTTP_PROXY`、`SUPERAGENT_HTTPS_PROXY`、`SUPERAGENT_ALL_PROXY`、`SUPERAGENT_NO_PROXY` 或 `SUPERAGENT_PNPM_REGISTRY`；脚本会将它们传给 Git 和 pnpm，并对回环管理 API 强制绕过代理。`update` 要求 checkout 干净，失败会尝试启动旧服务并恢复持续研究状态；本地改动应先提交或 stash。

### 特殊内网：交付 Docker image

在可联网机器构建一次镜像并导出：

```sh
docker build -t superagent-sec-runtime:stable \
  --build-arg DSH_VERSION=0.2.1-rc.3 -f deploy/Dockerfile .
docker save superagent-sec-runtime:stable | gzip > superagent-sec-runtime-stable.tar.gz
```

把 `superagent-sec-runtime-stable.tar.gz`、`deploy/compose.yaml`、`deploy/App.Dockerfile`、`deploy/.env.example` 和一个不入 Git 的运行环境文件带入内网；复制并填写 `deploy/.env.example`（例如 `/srv/superagent-sec/runtime.env`）后，在内网执行：

```sh
docker load < superagent-sec-runtime-stable.tar.gz
docker compose --env-file /srv/superagent-sec/runtime.env -f deploy/compose.yaml build
docker compose --env-file /srv/superagent-sec/runtime.env -f deploy/compose.yaml up -d
docker compose --env-file /srv/superagent-sec/runtime.env -f deploy/compose.yaml logs -f
```

运行时镜像包含 Node、pnpm、DSH、锁定依赖和 `openssh-client`，但不包含应用源码。Compose 从当前 checkout 构建应用镜像，构建时生成 `lib/`；运行中的容器只挂载目标项目和运行状态，不挂载源码、`node_modules` 或 `lib`。因此内网主机不需要安装 Node 依赖，也不会修改 checkout。普通源码更新只需在 host 上 `git pull`，再执行 `docker compose build && docker compose up -d`；若 `package.json` 或 lockfile 改变，则先重建并重新导出运行时镜像。

端口和挂载约定如下：

| 宿主机 | 容器 | 用途 | 持久化方式 |
| --- | --- | --- | --- |
| `SUPERAGENT_HOST_WEB_PORT`（默认 `3184`） | `3184` | 带 token 的前端和 WebSocket | 只发布宿主机回环地址 |
| 不发布 | `3182` | DSH 后端管理 API | 仅容器内部回环访问 |
| Compose build context | `/opt/superagent-sec`（应用镜像内） | 当前 checkout 的源码和 `lib/` | 应用镜像层，不运行时挂载 |
| `SUPERAGENT_PROJECTS_DIR` | `/var/lib/superagent/projects` | 多个项目根；每个项目可有自己的 workspace、repo 和 runtime 目录 | host bind mount，可写 |
| `SUPERAGENT_DATA_DIR/state` | `/var/lib/superagent/state` | SQLite、worker 状态 | host bind mount，可写 |
| `SUPERAGENT_DATA_DIR/dsh-home` | `/var/lib/superagent/dsh-home` | 隔离 profile、Session、附件 | host bind mount，可写 |
| `SUPERAGENT_DATA_DIR/secrets` | `/var/lib/superagent/secrets` | Web token、SSH key、known_hosts | host bind mount，权限 0700 |

首次启动会在持久化的 `secrets/ssh/id_ed25519` 自动生成一把新的 ED25519 key，并复制到容器 `/root/.ssh/id_ed25519`；镜像更新不会更换它。entrypoint 会打印公钥指纹，公钥文件位于 `secrets/ssh/id_ed25519.pub`，将该公钥加入目标 runtime 的 `authorized_keys` 后，agent 才能通过 SSH 连接。默认 `StrictHostKeyChecking=accept-new`，需要严格校验时可将 `SUPERAGENT_SSH_STRICT_HOST_KEY_CHECKING` 设为 `yes`，并预置 `secrets/ssh/known_hosts`。也可用 `SUPERAGENT_SSH_KEY_FILE` 注入另一把 key；私钥不进入镜像构建上下文。

将公钥部署到目标 runtime：

```sh
cat "$SUPERAGENT_DATA_DIR/secrets/ssh/id_ed25519.pub"
# 把输出追加到目标机 ~/.ssh/authorized_keys
```

`SUPERAGENT_PROJECTS_DIR` 是可扩展的项目根，不预设项目数量、项目名称或 Git 数量。每个 `projects/<project-id>/` 可以包含 `workspace/`、多个 repo checkout 和其他项目资料；默认 active workspace 是其中的 `workspace/`，可同时包含 `sources/` 下的多个 repo checkout，以及 docs、knowledge、reports、experiments、runtime、interactions 等其他目录，也可以按项目自身约定组织。当前 active workspace 通过 `SUPERAGENT_PROJECT_ID` 或显式的 `SUPERAGENT_WORKSPACE` 选择。需要并行运行多个项目时，为每个实例设置不同的 `SUPERAGENT_PROJECT_ID`、`SUPERAGENT_PROFILE`、`SUPERAGENT_STATE_DIR`、`DSH_HOME` 和宿主机端口，并使用不同的 Compose project name；不要让多个实例共享同一个 state 或 dsh-home。

首次部署示例（源码在 host，数据单独存放）：

```sh
export SUPERAGENT_PROJECTS_DIR=/srv/superagent-sec/projects
export SUPERAGENT_PROJECT_ID=tinyproxy
export SUPERAGENT_DATA_DIR=/srv/superagent-sec/runtime/tinyproxy
export DEEPSEEK_API_KEY='通过内网 secret 注入'
docker compose -f deploy/compose.yaml build
docker compose -f deploy/compose.yaml up -d
docker compose -f deploy/compose.yaml logs -f
```

镜像默认只把宿主机回环地址映射到前端端口；若必须提供给内网其他机器，显式设置 `SUPERAGENT_BIND_HOST`，并在前面放置 TLS、网络 ACL 或 SSH tunnel。后端管理端口不会发布到宿主机，所有 Web 请求都必须通过 token 代理。

容器只需要对外发起 SSH 连接，不运行 SSH server，因此不映射宿主机 `22` 端口。

代理首次启动时生成 32 字节随机 access token，写入权限 0600 的 token 文件，并在每次启动时输出带 token 的 URL。访问者必须先通过该 token；代理随后才使用隔离 DSH home 的 browser-session grant 访问后端，并把 token URL 重定向为不含 token 的地址。不要把 `3182` 或 `3184` 绑定到 `0.0.0.0`；需要远程验收时使用 SSH tunnel 或已有的 TLS 反向代理，并把 token 作为 secret 注入。

打开日志中的本地 URL，在 DSH 中配置模型提供方和默认模型，选择侧栏 **Superagent → 概览 → 项目安全专家**。可提交问题或“专家纠正”，查看持久回复，并打开研究 Session 查看实时过程。提问成功仅表示接收和持久化成功；实际研究仍需可用模型与资源。模型失败会显示在执行工单/系统问题中。

一个 `superagent-sec` 实例只绑定一个目标项目（一个标准 workspace，内部可包含多个仓库和普通目录）。需要研究其他项目时，为它创建独立的 workspace、stateDir、DSH home、profile 和端口；当前页面不会在多个项目之间切换。

启动自动检查工作区并装载专家 profile；执行会话直接在工作区根目录运行，可使用所有 `sources/` 及知识、文档、历史研究。明确用户请求直接进入引擎；后续追问与纠正进入同一项目线程和会话。完成一个回答不会自动结束项目研究线程，暂停、停止、重试继续复用现有管理能力。请求与纠正分别写入 `interactions/requests/`、`interactions/corrections/`；消息、回复、工单保存在 stateDir，DSH 自己保存会话。

消息接口沿用回环和同源限制：`GET /orchestrator/api/research` 查看上下文与回复，`POST /orchestrator/api/research/messages` 提交 `{id: UUID, text, kind: "question" | "correction"}`，请求头 `x-orchestrator-request: 1`。同一 ID 的相同内容可安全重试，不同内容返回冲突。源码、scope 或版本锁改变后拒绝新请求，需先检查/更新基线并重启加载上下文；不会自动切换版本。工作区变化若同时遇到人工修改过的 prompts，会要求先协调两者，避免覆盖人工配置。

源文件和已有目录中的 Markdown 不会自动变成消息；目前通过此入口发送的纠正才会送达会话。知识的归纳、落盘与读取仍由 agent 的研究过程完成，没有新增自动索引、知识一致性引擎或 commit 监听。持续研究调度见下文。`runtime/` 继续只存目标环境资料，启动专家不会启动研究目标。

## 与上游提示词和工具的连接

生成结果采用现有 `PromptConfig`：团队段落、研究技能，以及 `runtime/worker` 和 `runtime/work` 的覆盖。覆盖记录原文的版本标识，便于升级时发现行为变化。

主会话暂沿用路由职责。配置中的执行会话以研究和回答为默认交付，可以解释有效防护，也可以调查风险；不默认要求提交代码或打开 PR。策略、工具和事件处理仍由现有运行时执行，提示词中的约束不是工具权限或操作系统隔离。

低层配置仍可以通过 `PUT /orchestrator/api/prompts` 写入 `{"config": <生成结果>, "baseRevision": <当前修订号>}`，请求头包含 `x-orchestrator-request: 1`；修订号从 `GET /orchestrator/api/prompts` 获取。本地工作区模式会自动装载配置，不需要手动调用该接口。

GitHub 工作模式的继承部署说明见[原型部署说明](006-deployment.md)。其中账号与写权限要求不适用于本地模式。提示词和 CLI 包装不是操作系统隔离；沿用 DSH 的执行权限，不新增沙箱。

## 检查与已知限制

```sh
pnpm typecheck
pnpm test:security
pnpm test
pnpm build
```

`test:security` 检查本增量的集成；`test` 检查当前产品范围，排除名称包含 Feishu/feishu 的上游可选来源用例。`test:upstream` 保留包含这些遗留用例的完整测试入口。

在引入原始版本时，上游 1197 项测试中有一项飞书消费状态用例在全量运行时失败、单独运行通过，与启动就绪和解析错误的异步处理顺序有关。该可选能力不属于产品范围，本轮不修复，不将筛选后的结果描述为上游全部测试通过。

集成测试覆盖无 GitHub 账号启动、用户问答和纠正、本地执行目录、会话复用、回复持久化、幂等重试、重启恢复及源码基线变化拒绝。测试中的模型由 fixture 模拟，不证明专家能力。真实研究、专家订正和跨轮知识利用仍按 [v0.1 草案](V0.1.md)逐步检验。


## 持续研究

在项目安全专家面板点“开始 / 恢复研究”。首次启用作为用户授权保存到同一会话；专家确认后，宿主自动开始研究，不需要另一个 AI 发送聊天消息。默认不启用。

宿主复用现有 Engine.note、DSH worker、收件箱、效果队列及每两秒一次的编排 pass。宿主只提供项目章程、安全边界、资源预算和证据要求，不预设具体安全问题。专家先根据项目现况建立研究前沿，再为每轮提出问题、理由、假设、证据计划和停止条件，自主选择阅读与验证路径，写入知识目录，通过 orchestrator_research_checkpoint 提交证据和更新后的研究前沿。默认只有一个 research lane；特殊时间窗按 `maxWorkers`（1–256）建立独立 Ticket/Session/round，主 lane 之外的产物必须写入 `research/rounds/<round-id>/`，避免多个 worker 覆盖共享知识。宿主等待各 lane 真正空闲，间隔至少 10 秒再推进下一轮，并按影响、未知程度和可行性选择候选方向。没有额外的 AI 调度员；当前版本仍由每个专家 worker 完成选题、研究和自我反思，未来可将这些接口交给不同模型或 Agent。

检查点校验工作区与源码锁、产物路径/文件存在及相对轮次开始的 SHA256 变化、源码路径/行号可用性；保留版本与文件哈希。SQLite 是恢复依据，runs/continuous-research/<round-id>.json 是可阅读的导出。研究调度和检查点原子提交，同轮检查点可幂等重试；重启沿用轮次编号，不重新开一轮。

用户提问/纠正通过已有 steer 在下一模型步骤送达主 lane；主 lane 未完成回答时不投递新的主 lane 轮次，其他并发 lane 可以继续交付各自已开始的研究。当前自主研究可以在回答后接着完成。“本轮后暂停”停止后续调度，允许当前轮完成并保存，服务重启保留此状态。系统全局暂停也抑制自主调度；502、429、限流和网络错误会按 lane 持久退避后重试，主 lane 的不可恢复错误阻塞调度，次要 lane 只暂停该 lane。源码漂移、连续两次空闲仍不交检查点时停止并显示原因，处理后显式恢复。默认研究轮次不限时；只有特殊调度明确设置了时限时，宿主才会在该时限后取消当前 worker 并停止自动调度。时限由宿主看门狗执行，不作为 agent 的工具次数或 token 配额。

研究提示词不估算工具调用次数，也不要求在某个模型步骤或分钟数内完成。`orchestrator_research_checkpoint` 是交付条件：本轮必须留下可验证的知识增量，或明确记录 blocked/exhausted；它不限制调查深度。命令等待、后台作业、源码检查和模型请求的超时属于 DSH 或宿主的故障保护，各自只约束对应的 I/O，不代表研究轮次预算。

API：POST /orchestrator/api/research/continuous，JSON {"enabled":true|false}，请求头 x-orchestrator-request: 1。GET research 的 continuous 字段包含状态、当前问题、前沿和最近 30 个检查点。源码和研究资产仍留在独立工作区，不进入产品历史。

### 持续研究后续 TODO

- 用真实项目重复验收研究质量：记录新颖性、证据质量、有效的负结果、重复问题、专家介入次数和模型成本；当前自动化测试只证明调度与持久化闭环。
- 为研究前沿增加确定性去重、依赖关系、过期处理和假设状态更新，避免 Agent 反复选择同一个已确认或已削弱的问题。
- 增加独立 Reviewer 模型，在下一轮调度前检查研究提案、源码证据、反证和停止条件；Reviewer 的判断不能替代原始证据。
- 保持现有检查点协议，后续再拆分更强模型的 Planner 与较便宜 Researcher：Planner 负责选题和排序，Researcher 负责受限调查和产物交付。
- 在源码版本变化、专家纠正或新的运行证据出现时，自动重新打开受影响的研究前沿项。
- 单项目研究质量稳定后，再评估多项目队列、并行工作区和多 Agent 共享知识的合并规则。

文件确实变化与引用位置存在，不等于内容正确或有安全价值。当前仍需人工评审知识质量、推理和引用是否支撑结论。当前增量也没有实现新 commit 监听、自动动态验证、硬 token 配额或文件系统沙箱。


2026-11-02 本机真实模型验收：DeepSeek-V4.1-Flash-1017 在 HMDFS 连续完成 3 轮、NVIDIA 连续完成 2 轮，产出与更新知识文件，自主从未决问题推进后续研究。另验证用户插话优先答复后接回同一轮、暂停后不再投递、重启保留检查点与暂停状态、恢复后不需要新的聊天消息。原始记录位于各工作区 runs/2026-11-02-continuous-research/，不进入产品 Git。该验收证明执行闭环和知识落盘，不等于研究结论或专家质量通过评审。限流验收期间还修复了上游长期会话复用重试消息 ID 的问题；本机提供方采用有上限的慢速退避，不无限重试。
