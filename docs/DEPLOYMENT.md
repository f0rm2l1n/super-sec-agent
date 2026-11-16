# Superagent-sec 部署与升级

依赖：Docker、Docker Compose v2（支持 `up --wait`）、Python 3、Git。宿主不需要 Node、pnpm 或 DSH。

## 已经部署，当前在 b86114e

**不用重新初始化，不用重新复制源码，也不用重建工作区。** 保留现有 `deploy/.env`、运行数据和 `.6` runtime 镜像。

首次迁移到本脚本时，在应用仓库中运行：

```sh
git pull --ff-only
./scripts/deploy update
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

默认数据位置为 `.artifacts/instances/my-project/`，不进入 Git 或应用镜像。需要将数据放在仓库之外时，在 setup 命令加 `--data-dir /srv/superagent-sec/my-project`；目录需对当前用户可写。端口默认 3184，可加 `--port 3284`。`--scope-file /路径/SCOPE.md` 可以在固定基线前使用已经审阅的研究范围。

项目资料可包含多个仓库、普通文件、二进制和伪代码。首次 setup 按一个目录登记，不假设它是单个 Git。更细的来源登记在标准 `project.json` 中维护。

模型/API key 不在部署脚本中设置。网站打开后进入 DSH 全局模型设置配置提供商和模型，然后在 Superagent-sec 中提交问题或启动研究。没有配置模型时不要开启研究。

再次运行 setup 会检查已有基线，不会覆盖已登记资料。已部署的项目不应再运行 prepare 或 lock。修改研究范围、源码或登记后，必须按工作区审核流程明确更新基线，不能靠重新部署悄悄接受变更。

## 日常维护

```sh
./scripts/deploy status   # 容器与健康状态
./scripts/deploy url      # 认证浏览器链接
./scripts/deploy logs     # 最近日志
./scripts/deploy check    # 校验已固定的项目资料
./scripts/deploy stop     # 停止服务，保留全部数据
./scripts/deploy start    # 从当前 checkout 构建并启动
```

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
