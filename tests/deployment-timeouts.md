# 部署超时说明

内部环境启动较慢时，各层等待时间必须配套：

| 位置 | 设置 | 含义 |
| --- | --- | --- |
| `deploy/Dockerfile`、`deploy/App.Dockerfile` | `--start-period=600s` | 镜像健康检查的启动宽限期；期间失败不累计为不健康，成功仍会立即标记健康。 |
| 同上 | `--interval=30s --timeout=5s --retries=3` | 每 30 秒探测一次，单次最多 5 秒；宽限期结束后连续 3 次失败才标记不健康。 |
| `deploy/entrypoint.sh` | 后端启动等待 600 秒 | 防止后端慢启动时入口脚本提前退出、触发容器重启。单次探测最多 2 秒，循环边界可略超出期限。 |
| `scripts/deploy` | `--wait-timeout 900` | Compose 等待容器健康的总上限，适用于 setup、start、update 及更新失败后的恢复启动。 |
| `scripts/deploy` | 当前研究轮次等待 60 秒 | 更新前等待研究结束，独立于容器启动时间；超时不重启服务。 |

600 秒不是单次健康检查的请求超时，也不是固定等待时间；服务提前就绪即可继续。900 秒不包含镜像构建时间。Docker 提前报告不健康时，Compose 也可能提前失败。

验证：`python3 tests/deploy-script.test.py` 或 `./node_modules/.bin/vitest run tests/deploy-script.spec.ts --maxWorkers=1`。其中 `test_start_waits_up_to_fifteen_minutes_for_slow_startup` 验证部署脚本传给 Compose 的实际等待参数，无需真的等待 15 分钟。

镜像参数修改在重新构建应用镜像并重建容器后生效；日常部署运行 `./scripts/deploy update` 即可，现有 `.6` runtime 仍可复用，应用层会覆盖其健康检查和入口脚本。
