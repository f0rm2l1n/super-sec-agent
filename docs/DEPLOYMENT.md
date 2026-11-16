# Superagent-sec 部署与升级

依赖：Docker、Docker Compose v2（支持 `up --wait`）、Python 3、Git。宿主不需要 Node、pnpm 或 DSH。

## 已经部署，当前在 b86114e

**不用重新初始化，不用重新复制源码，也不用重建工作区。** 保留现有 `deploy/.env`、运行数据和 `.6` runtime 镜像。

首次迁移到本脚本时，在应用仓库中运行：

```sh
git pull --ff-only
./scripts/deploy update --recreate-network
```

以后更新只需要：

```sh
./scripts/deploy update
```

它会拉取当前分支、构建应用镜像、暂停新研究轮次、等待当前轮次结束、重启并检查健康，再恢复更新前的调度开关。构建失败不会停止旧服务；新容器启动失败会尝试恢复旧应用镜像。如果当前研究在一分钟内还没完成，更新会退出并恢复调度，不会强杀研究。代码目录有未提交修改时拒绝自动 pull；不会覆盖本地修改。

脚本复用已有 Compose 项目名（包括旧文档中的 `deploy`），不会另起一套实例。token、SSH key、模型配置、会话、SQLite 和研究工作区都保留在原挂载目录。

如果原来使用的配置文件不在 `deploy/.env`，只需在命令前指定它：

```sh
./scripts/deploy --env-file /绝对路径/deploy.env update
```

只部署已下载的代码、不执行 Git 拉取（离线传输代码或开发验收）：

```sh
./scripts/deploy update --no-pull
```

## 全新部署

先 clone 应用分支，将下载的 `.6` amd64 runtime 镜像导入 Docker：

```sh
git clone -b feature/superagent-sec-deployment https://github.com/f0rm2l1n/super-sec-agent.git
cd super-sec-agent
sha256sum -c superagent-sec-runtime-v0.1.0-sec.6-linux-amd64.tar.gz.sha256
docker load < superagent-sec-runtime-v0.1.0-sec.6-linux-amd64.tar.gz
```

准备好目标项目资料目录，然后执行一条命令：

```sh
./scripts/deploy setup \
  --project-id my-project \
  --source-dir /绝对路径/项目资料 \
  --topic '项目安全机制与信任边界' \
  --runtime-image superagent-sec-runtime:v0.1.0-sec.6-linux-amd64
```

脚本会生成私有 `deploy/.env`，构建应用镜像，创建标准工作区，复制项目资料并登记为普通目录，固定基线，启动并等待健康检查，最后打印可直接打开的认证 URL。

慢启动环境：镜像健康检查启动宽限期为 600 秒，入口脚本等待后端启动最多 600 秒，部署脚本等待容器健康最多 900 秒；提前就绪即可继续。各层超时含义及验证见 [部署超时说明](../tests/deployment-timeouts.md)。

默认数据位置为 `.artifacts/instances/my-project/`，不进入 Git 或应用镜像。需要将数据放在仓库之外时，在 setup 命令加 `--data-dir /srv/superagent-sec/my-project`；目录需对当前用户可写。端口默认 3184，可加 `--port 3284`。`--scope-file /路径/SCOPE.md` 可以在固定基线前使用已经审阅的研究范围。

项目资料可包含多个仓库、普通文件、二进制和伪代码。首次 setup 按一个目录登记，不假设它是单个 Git。更细的来源登记在标准 `project.json` 中维护。

模型/API key 不在部署脚本中设置。网站打开后进入 DSH 全局模型设置配置提供商和模型，然后在 Superagent-sec 中提交问题或启动研究。没有配置模型时不要开启研究。

再次运行 setup 会检查已有基线，不会覆盖已登记资料。已部署的项目不应再运行 prepare 或 lock。修改研究范围、源码或登记后，必须按工作区审核流程明确更新基线，不能靠重新部署悄悄接受变更。

## 日常维护

```sh
./scripts/deploy status   # 容器与健康状态
./scripts/deploy url      # 认证浏览器链接
./scripts/deploy logs     # 最近日志
./scripts/deploy models   # 默认模型、可用提供商、角色与研究模型配置（不输出凭据）
./scripts/deploy check    # 校验已固定的项目资料
./scripts/deploy stop     # 停止服务，保留全部数据
./scripts/deploy start    # 从当前 checkout 构建并启动
```

## 自定义模型可列出，但对话仍使用官方适配器

新增自定义提供商不会自动改变 DSH 全局默认模型、已有会话的模型选择，或 Superagent-sec 的角色模型。`DeepSeek Messages transport failed` 来自 DeepSeek Messages 适配器；`[llm-deepseek-api-key] model listing ... failed` 则可能只是模型选择器枚举了已启用的官方提供商，不能单独用于判定对话路由。

先执行 `./scripts/deploy models`（非默认配置加 `--env-file /路径/deploy.env`）。该命令只读取模型目录和角色配置，不发送测试对话、不修改选择、不输出凭据：

- `globalDefault`：DSH 新会话的默认提供商与模型。
- `configuredProviders`：当前模型目录中可用的提供商及模型 ID；自定义模型能列出说明模型发现成功，不代表对话 POST 或流式响应一定成功。
- `roleOverrides`：Superagent-sec 的评估/执行模型覆盖，`null` 表示该角色未设置独立覆盖。
- `researchAllDay`、`researchWindows`：全天研究模型和时段覆盖，时段为 `null` 时继承全天模型。

如果 `globalDefault` 仍是 `deepseek-official`，在 DSH 对话输入框旁的模型选择器明确选择自定义提供商和模型，再新建会话测试；已有会话要单独切换。研究模型在「设置 → 研究调度」配置。该诊断输出不包含已有会话的实时模型选择或网关地址，仍需对照出错会话的模型选择器；不要把模型发现成功直接当成对话链路已验证。

## Docker 网段与内网代理冲突

默认 Docker 网段为 `192.168.240.0/24`，避免 Docker 自动分配的 `172.18.0.0/16` 抢占内网代理 `172.18.100.92` 的路由。部署前确认所选网段不与 LAN、VPN 或其他 Docker 网络重叠；同一宿主的多个实例必须分别选择不同网段。

已有部署在原来的 Compose env 文件（默认 `deploy/.env`）加入：

```dotenv
SUPERAGENT_DOCKER_SUBNET=192.168.240.0/24
```

然后执行一次：

```sh
./scripts/deploy update --recreate-network
```

非默认 env 文件仍用 `./scripts/deploy --env-file /路径/deploy.env update --recreate-network`。已拉取代码或离线部署时可加 `--no-pull`。脚本先构建、暂停研究并等待当前轮结束，再重建当前 Compose 项目的网络与容器；沿用旧项目名（如 `deploy`）并保留全部挂载数据，不删除卷。网络重建期间网站会短暂离线。之后日常更新继续使用 `./scripts/deploy update`。

全新部署可在 `setup` 命令加 `--subnet 192.168.240.0/24`，脚本会把它写入 env 文件。不要只运行 `up -d` 来修改已有网络的子网；Docker 必须先移除旧网络。此设置仅影响本项目，不修改 Docker 全局网络配置。

远程浏览器通过 SSH 转发，例如远端发布端口为 3184：

```sh
ssh -N -L 3184:127.0.0.1:3184 user@部署主机
```

在笔记本打开 `scripts/deploy url` 输出的链接。若宿主端口改为 3284，转发和浏览器也使用 3284。代理应绕过 `127.0.0.1`。后端 3182 不需要发布。

## 镜像、配置和数据

- runtime image 保存锁定的依赖；应用 image 从当前 checkout 构建。日常改代码不必重发 runtime image。
- `.6` 镜像仍可复用；锁文件变化时构建会明确要求匹配的新 runtime image，不会在内网偷偷下载依赖。
- Compose env 文件由 Docker 解析，不作为 shell 脚本执行。默认 `deploy/.env` 可继续使用；运行目录、模型配置和密钥不要提交。
- 现有外部 patch 和模型 secret 文件继续复用。普通部署不需要创建 patch；默认使用 `/dev/null`。
- HTTP/HTTPS 构建与运行代理可在 env 文件设置 `SUPERAGENT_HTTP_PROXY`、`SUPERAGENT_HTTPS_PROXY`、`SUPERAGENT_NO_PROXY`。本地应用构建只复用已导入的依赖。
- 容器首次运行自动生成持久 SSH key。设备、HDC、其他 runtime 的可达性需要单独提供；在网页批准动作不会自动连接设备。
- 备份整个数据目录和 projects 工作区；不要执行 `docker compose down -v` 来做更新。容器以 root 写入数据，Linux 主机上部分产物可能属于 root。

发布依赖镜像使用 `scripts/export-docker-release.sh`；维护该镜像时再参考 [发布说明](RELEASE-v0.1.0-sec.6.md)。本页的 setup/update 是运行者日常使用的入口。
