# 开发起点：Super-agent fork 与安全专家定制

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

服务和前端由 DSH Web profile 承载，不是独立的前后端开发服务器。每个项目使用独立 profile、stateDir 和端口。需要兼容版本的 DSH 和模型提供方；若机器上安装的是旧 DSH，可用下列固定版本命令，不修改全局安装。

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
pnpm dlx @deepseek-ai/dsh@0.2.1-rc.3 --profile brainafk-hmdfs
```

打开日志中的本地 URL，在 DSH 中配置模型提供方和默认模型，选择侧栏 **Superagent → 概览 → 项目安全专家**。可提交问题或“专家纠正”，查看持久回复，并打开研究 Session 查看实时过程。提问成功仅表示接收和持久化成功；实际研究仍需可用模型与资源。模型失败会显示在执行工单/系统问题中。

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

宿主复用现有 Engine.note、DSH worker、收件箱、效果队列及每两秒一次的编排 pass。每轮研究一个有价值的问题；专家自主选择阅读路径，研究攻击与防护，写入 knowledge/、research/ 或 reports/，通过 orchestrator_research_checkpoint 提交文件、源码证据及带优先级的下一步问题。宿主等待本轮真正空闲、用户请求已回答，间隔至少 10 秒再推进下一轮。研究前沿由专家更新，调度器选取最高优先级问题。没有额外的 AI 调度员。

检查点校验工作区与源码锁、产物路径/文件存在及相对轮次开始的 SHA256 变化、源码路径/行号可用性；保留版本与文件哈希。SQLite 是恢复依据，runs/continuous-research/<round-id>.json 是可阅读的导出。研究调度和检查点原子提交，同轮检查点可幂等重试；重启沿用轮次编号，不重新开一轮。

用户提问/纠正通过已有 steer 在下一模型步骤送达同一专家；未完成回答时不投递新自主轮次。当前自主研究可以在回答后接着完成。“本轮后暂停”停止后续调度，允许当前轮完成并保存，服务重启保留此状态。系统全局暂停也抑制自主调度；问题阻塞、模型/投递失败、源码漂移、连续两次空闲仍不交检查点时停止并显示原因，处理后显式恢复。每轮设 15 分钟墙钟看门狗（用户优先期间延期，系统暂停期间不检查），超时取消当前 worker 并停止自动调度。5–15 次工具操作只是提示词建议，不是强制调用/token 配额。

API：POST /orchestrator/api/research/continuous，JSON {"enabled":true|false}，请求头 x-orchestrator-request: 1。GET research 的 continuous 字段包含状态、当前问题、前沿和最近 30 个检查点。源码和研究资产仍留在独立工作区，不进入产品历史。

文件确实变化与引用位置存在，不等于内容正确或有安全价值。当前仍需人工评审知识质量、推理和引用是否支撑结论。当前增量也没有实现新 commit 监听、自动动态验证、硬 token 配额或文件系统沙箱。


2026-11-02 本机真实模型验收：DeepSeek-V4.1-Flash-1017 在 HMDFS 连续完成 3 轮、NVIDIA 连续完成 2 轮，产出与更新知识文件，自主从未决问题推进后续研究。另验证用户插话优先答复后接回同一轮、暂停后不再投递、重启保留检查点与暂停状态、恢复后不需要新的聊天消息。原始记录位于各工作区 runs/2026-11-02-continuous-research/，不进入产品 Git。该验收证明执行闭环和知识落盘，不等于研究结论或专家质量通过评审。限流验收期间还修复了上游长期会话复用重试消息 ID 的问题；本机提供方采用有上限的慢速退避，不无限重试。
