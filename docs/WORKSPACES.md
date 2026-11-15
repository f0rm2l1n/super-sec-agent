# 标准项目安全工作区 v1

每个待研究对象都是一个独立的项目安全工作区。工作区是产品输入，承载长期的项目身份、源码集合、安全知识及人机协作记录；验收是它的一种用途。一个项目不等于一个 Git 仓库：框架、内核、服务、依赖和对标实现可以共同构成一个研究对象。

## 初始目录，允许扩展

```text
<workspace>/
  project.json
  sources.lock.json
  SCOPE.md
  sources/<source-id>/
  docs/
  vulnerabilities/
  exploits/
  knowledge/{mechanisms,attack-surface,history,questions}/
  research/
  runtime/{configs,scripts,artifacts}/
  experiments/
  reports/
  interactions/{requests,corrections}/
  runs/<run-id>/
  .agent/
  evaluation/                   可选
```

目录职责见[模板说明](../templates/security-workspace/README.md)。`SCOPE.md` 是专家的长期职责；具体用户请求和订正独立记录，不需要每次修改长期职责。`research/` 保存正在推进的问题，`knowledge/` 保存有来源、状态和版本条件的可复用认识。知识按问题和机制组织，不要求为每个源码仓库单独建立互不关联的知识库。

这是安全研究人员的初始模板。`docs/` 收集额外文档；`vulnerabilities/` 保存历史漏洞根因与修复研究；`exploits/` 保存历史利用链、约束及材料；`experiments/` 保留真实实验，`reports/` 保存向用户交付的结果。案例、知识和实验按稳定 ID 互相引用，避免复制成多套结论。agent 可以添加模块、专题及工具目录；校验不会因额外目录而拒绝工作区。

## 研究如何真正运行目标

`runtime/` 专用于被研究项目，包含 environment.md、build.md、run.md，以及 configs/、scripts/、artifacts/。agent 自身的配置放 `.agent/`，研究会话记录放 runs/，避免二者混淆。

运行条件属于安全理解的一部分：哪些软硬件和配套版本必需，身份与设备信任如何建立，哪些内核/产品开关实际启用，以及如何证明真实用例经过目标模块。可以按问题需要先完成最小子系统实验，再逐步补足完整场景；容器、模拟器是否覆盖真实内核和硬件边界需要证据。

逐步区分“有构建文档”“构建成功”“组件启动”和“真实用例跑通”。每步记录命令、环境、产物、实际结果及阻塞，不因存在脚本或配置就宣称可运行。动态验证和利用复现仍接入已有能力，模板不要求重建验证平台，也不会自动安装或启动目标。

通用模板、格式、初始化及校验代码进入产品 Git。实际项目配置、源码、专家知识、用户记录、运行和验收数据存放在工作区，默认不进入产品 Git；产品仓库内约定位置是已忽略的 `workspaces/<project-id>/`，也可使用任何外部目录。工作区自身是否需要独立版本管理由所在项目决定，不由初始化器自动创建 Git 仓库。

## 配置示例

`project.json` 描述项目及关注的 ref，所有源码路径相对于工作区根目录：

```json
{
  "schemaVersion": 1,
  "id": "example",
  "name": "示例项目",
  "topic": "框架与底层模块之间的身份、授权和数据隔离",
  "primarySource": "core",
  "sources": [
    {
      "id": "core",
      "kind": "git",
      "path": "sources/core",
      "url": "https://github.com/example/core.git",
      "ref": "main",
      "role": "subject",
      "purpose": "核心实现"
    },
    {
      "id": "framework",
      "kind": "git",
      "path": "sources/framework",
      "url": "https://github.com/example/framework.git",
      "ref": "release-v1",
      "role": "dependency",
      "purpose": "上层调用、身份与权限约束"
    }
  ]
}
```

`role` 为 `subject`、`dependency` 或 `reference`；`primarySource` 是当前上游单仓库执行接口的主锚点，不限制专家只研究这个仓库。所有 source 都注入同一份正式 profile，避免依赖验收脚本临时补充多仓库上下文。

`kind` 可以是 `git`、`directory`、`binary` 或 `pseudocode`，默认省略时按 `git` 处理。Git source 需要 `url` 和 `ref`，锁文件记录 commit SHA；其他 source 只需要 `path`、`role` 和 `purpose`，锁文件记录内容 SHA256 基线。`directory` 表示未版本化的源码、配置或资料集合；`binary` 表示可执行文件、库或二进制包（可以是单文件或目录）；`pseudocode` 表示反编译、反汇编或提取的伪代码资料。它们都属于项目证据输入，不假设一定有 Git 历史，也不把伪代码当作源码事实。研究页面会同时显示来源类型、相对路径和基线。

`sources.lock.json` 记录每个 source 的确定 SHA、登记信息、浅克隆状态及稀疏检出范围。Git 的 `ref` 表示关注目标，目录 source 没有 ref；SHA 表示此次研究基线。当前没有自动监听分支。锁定多个仓库或目录也不等于证明它们来自某款产品的完整构建，产品配置和版本兼容性证据需另行收集。

## 初始化与使用

从产品仓库运行：

```sh
pnpm expert init --workspace ./workspaces/example \
  --id example --name '示例项目' --topic '权限与隔离机制'
```

初始化生成统一目录和说明，不下载源码、不调用模型，已有非空目录会被拒绝覆盖。随后准备 `sources/` 下的 Git checkout，按示例填写 project.json 和 SCOPE.md，再运行：

```sh
pnpm expert lock --workspace ./workspaces/example
pnpm expert check --workspace ./workspaces/example
pnpm expert prepare --workspace ./workspaces/example
pnpm expert preview --workspace ./workspaces/example --role orchestrator
```

`lock` 要求指定 ref 与当前 HEAD 一致且工作区干净，再显式写入版本锁；它不 fetch 或 checkout。`check` 核对目录、登记、锁文件、Git 根路径、源码版本、origin、未提交改动及稀疏检出范围。`prepare` 先检查，再生成 `.agent/profile.json` 与 `.agent/session-input.md`，保留目标 runtime/ 的研究记录和启动资料。profile 继续使用上游 PromptConfig，无需新的运行时配置格式。

实际研究服务可在 DSH 插件配置中指定绝对路径 `workspace` 和专属 `stateDir`，启动时自动检查并装载 profile，无需 GitHub 账号。通过管理面板提交的问题/纠正会保存到 interactions/ 并送达同一研究会话；见[本地运行说明](DEVELOPMENT.md)。手动放进目录的文件不会自动变成运行时消息；`runs/` 不会自行记录日志，知识也不会自行被检索。

## 迁移与版本演进

复制整个工作区到新路径或新机器，保留 source ID、相对路径及 Git 元数据，然后重新 `check` 和 `prepare`。`.agent/` 的生成配置可重建，runtime/ 的目标环境资料、研究和知识需要保留，并核对新宿主的适用性。源仓库使用独立 clone，避免引用工作区外部的 worktree 或链接。凭证由新宿主配置，不放进 project.json。

更新版本时明确选择新 checkout/ref，再执行 lock；保留旧知识的来源 SHA，按变化复查。运行前可将 project.json、锁文件、profile 和输入快照保存进对应 runs，记录实际模型、成本、专家时间和产品代码版本。

可选的 `evaluation/` 存放评估者题库、变更样本、评分与验收运行记录。专家 profile 不装载这些材料；目录分开不是访问控制，正式盲测需由运行环境单独隔离。没有 evaluation 的工作区也能正常初始化、检查和准备。

## 当前两个实例

本机 `workspaces/hmdfs/` 和 `workspaces/nvidia/` 使用同一格式。HMDFS 的多个框架/服务/内核仓库属于同一对象；NVIDIA 暂为一个源码主体，后续可补充匹配的外部组件与背景。两者均是已准备的研究对象，尚未进行真实模型专家验收。
