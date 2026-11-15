# 项目安全工作区

本目录是一位安全研究人员或驻项目安全专家的初始工作台。`project.json` 标识项目、主题及相关仓库；`sources.lock.json` 固定每个仓库的研究版本；`SCOPE.md` 描述长期研究范围和需要人类补充的背景。以下是基础目录，agent 可以按模块、案例和实验增加更多目录，不要求把研究限制在预设分类里。

```text
project.json              项目身份、范围摘要、源码登记和关注 ref
sources.lock.json         本轮研究的确定 SHA 和源码可用性限制
SCOPE.md                  长期职责、重点安全问题、产品与部署前提
sources/<source-id>/      Git checkout、普通目录、二进制文件/目录或反编译伪代码资料
docs/                     项目文档、协议、设计、部署与外部资料
vulnerabilities/          历史漏洞、根因、修复与同类问题研究
exploits/                 历史利用链、利用条件、PoC 材料与分析
knowledge/                有证据的安全理解与未决问题
research/                 进行中的研究、假设、证据及后续步骤
runtime/                  目标环境、构建、部署、启动与功能验证方法
experiments/              实际实验输入、命令、日志及结果
reports/                  对用户交付的解释、研究总结和问题报告
interactions/requests/     用户需求及处理情况
interactions/corrections/  专家反馈、采纳情况和受影响结论
runs/<run-id>/            agent 会话、工具结果、输入快照和成本
.agent/                   可重新生成的 agent 配置与会话输入
evaluation/               可选；由评估者维护的题库、评分与验收记录
```

`docs/` 保留材料，`vulnerabilities/` 和 `exploits/` 保留案例研究，`knowledge/` 提炼可复用结论；用稳定 ID 和相对路径关联，避免维护多套重复事实。历史漏洞不一定有完整利用，利用分析也不等于实际复现。

让目标跑起来本身也是研究：从 [runtime/environment.md](runtime/environment.md)、[build.md](runtime/build.md) 和 [run.md](runtime/run.md) 开始，记录依赖、硬件、配套版本、有效配置及最小用例。它们初始标记为未搭建/未运行；需要实际环境和证据后才能更新状态。

这是文件组织与配置入口，不代表自动研究、知识检索、消息消费、目标启动和持续监控已经实现。用户需求与订正的具体写入和读取必须由实际运行入口负责。`evaluation/` 不属于专家默认研究输入，盲测需要另外提供访问隔离。

从 BrainAFK 产品仓库运行，`<workspace>` 可以位于产品仓库外：

```sh
pnpm expert lock --workspace <workspace>
pnpm expert check --workspace <workspace>
pnpm expert prepare --workspace <workspace>
```

先填写配置与范围并准备源码，再执行 `lock`。该操作将已 checkout 的指定 ref 解析为 SHA，写入锁文件，不会获取远端代码或切换版本。`check` 和 `prepare` 使用锁定 SHA，发现源码漂移或未提交改动会报错。改变研究版本后应明确更新锁文件并复查旧知识，不覆盖旧知识的适用版本。

配置与知识引用使用相对路径及 source ID。迁移时复制整个工作区，包括各源码仓库的 `.git`、二进制和伪代码资料，然后重新执行 `check` 和 `prepare`。不要依赖工作区外的 worktree Git 元数据或目录链接；运行记录中的历史绝对路径可以保留为历史信息，`.agent/` 的绝对路径必须重新生成。目标的 runtime/ 资料需要保留，并按新环境复核。模型密钥使用宿主环境配置，不写入工作区模板。
