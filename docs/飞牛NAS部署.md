# 飞牛 NAS（fnOS）部署指南

> 目标：在 NAS 上跑一个容器，浏览器 / 手机访问 `http://NAS的IP:8787`，数据全部落在 NAS 的 `data/` 目录。
> 不同 fnOS 版本的菜单名称略有差异，认准「Docker → Compose / 项目 / 堆栈」即可。

## 0. 准备

- 飞牛 NAS 已安装并启用 Docker 服务
- 确认一个用于存放项目的共享文件夹，本文用 `/vol1/docker/nestledger`（卷号以实际为准）
- 确认 8787 端口未被占用；占用就改 `.env` 里的 `PORT`

## 1. 把项目放到 NAS

### 方案 A：终端 / SSH（推荐，后续更新最方便）

在 NAS 的终端（或用 SSH 客户端）执行：

```bash
mkdir -p /vol1/docker && cd /vol1/docker
git clone https://github.com/<你的用户名>/nestledger.git
cd nestledger
cp .env.example .env
```

如果仓库是私有的，先配置访问令牌或改用「方案 B」上传本地 ZIP。

### 方案 B：图形界面上传

1. 直接使用交付时附带的 `nestledger-v1.0.0.zip`，或自己把 `nestledger` 文件夹打包成 ZIP
2. 在飞牛「文件管理」里进入 `/vol1/docker`，上传并解压，得到 `/vol1/docker/nestledger`
3. 把 `.env.example` 复制一份并重命名为 `.env`

> 只上传项目代码即可，`data/` 不用预先创建，Compose 首次启动会自动生成。

## 2. 启动

### 终端方式

```bash
cd /vol1/docker/nestledger
docker compose up -d --build
docker compose ps          # 状态应为 healthy / running
docker compose logs -f     # 首次可看一眼启动日志，Ctrl+C 退出日志
```

### 图形界面方式

1. 打开 NAS 的 Docker 应用 → **Compose**（有的版本叫「项目」或「堆栈」）→ **新增 / 创建项目**
2. 项目名称：`nestledger`
3. 路径选择 `/vol1/docker/nestledger`，或选择「导入 compose 文件」并指向 `docker-compose.yml`
4. 确认端口映射 `8787:8787`（若改了 `.env` 里的 PORT，以实际为准）
5. 点击 **启动 / 部署**，等待镜像构建完成（首次约 1–3 分钟，取决于网速）
6. 在容器详情里确认健康状态为 healthy

## 3. 访问

同一局域网内任意设备打开：

```
http://<NAS 的 IP>:8787
```

例如 `http://192.168.1.20:8787`。手机、平板、电脑访问这个地址，看到的都是同一份数据。

顶栏状态说明：

| 状态 | 含义 |
| --- | --- |
| 已保存到 NAS（绿） | 已连上服务端，数据权威副本在 `data/db.json` |
| 正在同步 / 待同步（黄） | 写入中，或离线暂存本机、稍后自动重试 |
| 待同步（离线）（红） | 服务端连不上，数据暂存浏览器，恢复后自动重试 |
| 本机浏览器存储（灰） | 未检测到同步服务，退回纯本地模式 |

## 4. 首次使用建议

1. 打开后如果显示示例数据，到「数据备份」→「清空全部数据」再开始录入
2. 如果之前用单文件版录过数据：在旧页面「导出完整数据（JSON）」，在新页面「导入备份」
3. 到「数据备份」页点一次「立即生成快照」，确认 `data/backups/` 里出现了文件
4. 在 NAS 上给 `/vol1/docker/nestledger/data` 所在共享文件夹开启定时快照

## 5. 更新

```bash
cd /vol1/docker/nestledger
git pull
docker compose up -d --build
```

若改用 GHCR 镜像（`.env` 中填 `IMAGE=ghcr.io/<用户名>/nestledger:latest`）：

```bash
docker compose pull && docker compose up -d
```

更新只替换容器与网页，**不会动 `./data`**。升级前顺手跑一次 `./scripts/backup.sh` 更稳妥。

## 6. 常用命令

| 目的 | 命令 |
| --- | --- |
| 启动 / 重建 | `docker compose up -d --build` |
| 停止 | `docker compose down` |
| 查看日志 | `docker compose logs --tail=100` |
| 查看状态 | `docker compose ps` |
| 健康检查 | `curl http://127.0.0.1:8787/api/health` |
| 备份数据 | `./scripts/backup.sh` |
| 恢复数据 | `./scripts/restore.sh ./backups/xxx.tar.gz` |
| 项目自检 | `node scripts/check.mjs` |

## 7. 排障

**容器起不来 / 端口冲突**：`docker compose logs` 看报错；改 `.env` 的 `PORT` 后重新 `up -d`。

**能打开页面但一直是「本机浏览器存储」**：说明 8787 端口进的不是本项目容器，或 Nginx / 反代把 `/api/*` 拦截了。直接访问 `http://<IP>:8787/api/health`，正常会返回一小段 JSON。

**写入报 413 / 附件传不上去**：`.env` 里调大 `MAX_BODY`，然后 `docker compose up -d`。

**`data/` 没有写入权限**：容器默认以 root 运行仍失败时，检查共享文件夹权限；或在 compose 里加 `user: "1000:1000"`，并先执行 `chown -R 1000:1000 ./data`。

**想从外网访问**：填 `.env` 的 `AUTH_USER` / `AUTH_PASS`（浏览器会弹登录框），并强烈建议在 NAS 反向代理上启用 HTTPS；不要把裸端口映射到公网。
