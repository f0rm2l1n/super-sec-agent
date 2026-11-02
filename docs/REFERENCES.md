# 相关项目、差异与复用方向

状态：根据代码阅读与产品讨论整理。以下区分已有能力、拟借鉴方向与待验证的价值；不代表已经完成集成或效果对照。

当前产品定位见 [驻项目安全专家](VISION.md)：持续积累攻防两方面的项目安全理解，与用户共同研究问题。具体工具集成根据原型需要选择。

## DeepSeek Super-agent 与 Harness

计划基于 DeepSeek Super-agent 构建长期参与项目工作的安全专家。

公开原型面向一个 GitHub 仓库，可监听 GitHub 和可选的飞书事件，接收获准请求，建立工单，并在独立会话和工作目录中执行工作、回复结果。其 Source、Trigger、Eval、Ticket、Assignment 等模型，以及任务上下文延续、人工追问与持久化机制，可以作为研究和用户合作的基础。

公开仓库明确标注为研究原型，且与内部版本和设计文章不完全相同。不能将设计方向直接当成已实现能力。

本项目仍需设计并验证攻防研究方向的选择、安全机制与风险知识的组织、专家订正的传播、版本变化后的知识复查，以及与现有安全能力的连接。框架本身不会自动获得这些领域能力。

## Sashiko

Sashiko 已能进行 commit/patch 审查，并支持常驻接入、用户提交范围、多模型、项目代码笔记、历史反馈和多阶段分析。不能用“持续运行”“用户可交办任务”或“具有记忆”单独宣称本项目的优势。

| 已有能力 | 阅读入口 | 可借鉴或复用的方向 |
| --- | --- | --- |
| 本地 commit/range 审查、机器输出与恢复 | `src/local_review.rs` | 专家调查某段变更时的执行能力 |
| 常驻接入、队列和人工提交 | `docs/daemon.md`、`src/reviewer.rs` | 事件接入和任务管理经验，避免重复建设 |
| 目标版本、相关源码与历史、多阶段分析 | `src/workflows/linux_patch_review.rs` | 带上下文的安全研究及分析执行 |
| 代码笔记、维护者知识与历史反馈 | `src/notes/`、`src/workflows/code_notes.rs`、`src/workflows/prior_feedback.rs` | 知识留存、反馈利用与减少重复研究 |
| 已知漏洞与多版本样本 | `docs/benchmarking.md`、`projects/linux/benchmarks/` | 小规模可复查案例与对照设计 |

本项目要验证的重点是：长期形成和维护项目攻防知识，解释保护机制及其局限，利用积累回答问题，并与用户共同解决新问题。单次 commit 审查是可能调用的能力之一。

这不构成 Sashiko 无法扩展实现的能力清单，也不预设必须集成 Sashiko。应根据原型所需能力和实际收益选择复用方式。

## 已有内部能力

| 项目或能力 | 可以利用什么 | 本项目关注什么 |
| --- | --- | --- |
| 内部项目知识挖掘 | 项目结构、代码语义、文档、专家反馈等已有成果；具体接口和 agent loop 尚待确认 | 围绕安全目标、防护机制、攻击面、历史漏洞与风险形成专业理解 |
| BrainAFK Next | 全量及 commit 审计、验证、PoC、修复回归与环境管理等能力 | 在调查需要时调用，并将结果作为有版本和条件的研究证据 |
| LKEV | 持续选题、历史记录、代码研究与验证衔接的经验 | 长期维护调查与知识，同时服务用户提问和共同研究 |

保护具体项目时，公开漏洞也可能是高价值线索；不直接继承以新颖性为目标的“已公开就跳过”规则。

动态验证、PoC 和专门的准确率提升流程不在本项目重新开发。具体集成方式需要实际检查接口后决定。

项目已有的安全设计文档、配置说明、加固指南、威胁模型和机制测试也是重要输入。外部同类项目既能提供漏洞线索，也能提供安全设计与防护运用的对照；需要结合实现和运行条件判断是否适用。

## 外部相关角色与产品

| 参考 | 公开定位或案例 | 对本项目的启发 |
| --- | --- | --- |
| [Devin](https://docs.devin.ai/integrations/overview) | 从团队沟通与项目工具接收开发工作 | 将用户合作放到实际团队工作流中 |
| [Resolve AI](https://docs.resolve.ai/) | 连接代码、基础设施与观测信息，调查告警和事故 | 围绕长期责任对象组织上下文与调查 |
| [XBOW](https://xbow.com/platform) | 自主渗透测试，公开描述常驻协调者和短期执行 agents | 常驻与 multi-agent 并不互斥，不能只凭架构名称建立差异化 |
| [Google Big Sleep](https://projectzero.google/2024/10/from-naptime-to-big-sleep.html) | 从 commit 出发，在 SQLite 中研究相关漏洞的公开案例 | 变更可以成为深入旧代码的研究线索；该案例本身不证明常驻或长期知识维护能力 |

以上是官方描述或公开研究案例，不是本项目完成的独立性能评测。产品效果需要在相同项目、可比材料和资源预算下验证。

## 需要证明的增量价值

用户应能从持续积累中获得对现有防护更可靠的理解、更有依据的设计与配置建议、更有效的调查入口，以及能够吸收反馈并跟随项目变化的合作伙伴。

衡量时需要与已有 agent 或 multi-agent 方案比较，而非仅与没有上下文的单轮问答比较。积累更多文字、运行更多轮次或调用更多工具，都不能单独证明价值。

## 阅读版本与本地入口

以下提交是此前本地阅读的固定版本，不保证是上游最新版本。

| 项目 | 阅读提交 | 上游入口 |
| --- | --- | --- |
| DeepSeek Super-agent | `6337fc823ce20251c8de8085948165c81aaa701e` | [README](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/README.md) |
| DeepSeek Harness | `ce7073d51254c26cd63b22a60835b8f948deb447` | [README](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/README.md) |
| Sashiko | `eeaab1c7b144dcb912ada42d842098bcb965631e` | [审查工作流](https://github.com/sashiko-dev/sashiko/blob/eeaab1c7b144dcb912ada42d842098bcb965631e/src/workflows/linux_patch_review.rs)、[代码笔记](https://github.com/sashiko-dev/sashiko/blob/eeaab1c7b144dcb912ada42d842098bcb965631e/src/workflows/code_notes.rs) |

本地参考位置：

- `deepseek-harness/`、`dsh-superagent-prototype/`：独立 Git checkout，由根仓库忽略。
- Sashiko：`/home/linmalin/aiaiai/innovation/commits-as-inputs/sashiko`。
- BrainAFK Next：`/home/linmalin/aiaiai/brainafk-next`。
- LKEV：`/home/linmalin/aiaiai/brainafk-linux-workdir/goals/lkev`。

本仓库从 DeepSeek Super-agent fork，在定制分支直接修改源码。来源与许可见[第三方说明](../THIRD_PARTY.md)。原始参考 checkouts 保留为独立仓库；本项目的正式源码在 `src/`，不再使用 vendor 包装结构。其他项目尚未集成。
