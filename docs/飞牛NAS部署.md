# 飞牛 NAS（fnOS）部署指南

> 目标：在 NAS 上跑一个容器，浏览器 / 手机访问 `http://NAS的IP:8787`，数据全部落在 NAS 的 `data/` 目录。
> 不同 fnOS 版本的菜单名称略有差异，认准「Docker → Compose / 项目 / 堆栈」即可。

---

## 0. 如果你已经报错了，先看这一段

部署日志里出现：

```text
failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory
```

**唯一原因**：`docker-compose.yml` 里写的是 `build: { context: . }`，Docker 会在 **compose 文件所在的那个目录** 里找 `Dockerfile`。找不到就报这个错。YAML 本身完全正确，问题是**同目录缺少源码文件**。

日志里同时出现的另一行：

```text
nestledger Pulling
nestledger Warning Get "https://registry-1.docker.io/v2/": context deadline exceeded
```

是旧版 compose 同时写了 `image:` 和 `build:`，Compose 会先去 Docker Hub 找同名镜像，国内 NAS 连不上就超时警告。**v1.1.1 起主 compose 已移除 `image:` 字段**，这条警告不会再出现。

### 最快修复：跑一次自检

SSH 进 NAS（或在飞牛的「终端」里）：

```bash
cd /vol1/docker/nestledger          # 换成你的实际项目路径
bash scripts/predeploy.sh
```

脚本会逐项检查 `Dockerfile`、`server/index.js`、`web/index.html` 是否齐全，并识别两种最常见的情况，直接给出可复制执行的修复命令：

- **ZIP 解压多套了一层**：完整项目藏在 `nestledger/` 之类的子目录里 → 提示你 `cd` 进去，或把内容上移一层
- **飞牛 GUI 只导入了 YAML**：目录里只有 compose 文件 → 提示重新放完整文件夹，或改用纯镜像模式

> 如果连 `scripts/predeploy.sh` 都找不到，说明项目文件根本没传全，直接看第 2 节重新放一次。

---

## 1. 三种部署方式怎么选

| 方式 | 需要 NAS 上有源码文件 | 适合谁 | 更新方式 |
| --- | --- | --- | --- |
| **A · SSH + git clone** | 是（仓库自带） | 已推 GitHub，想要最省心的长期维护 | `git pull && docker compose up -d --build` |
| **B · 文件管理上传完整目录** | 是 | 不想用 GitHub | 重新上传 + `up -d --build` |
| **C · 图形界面粘贴 YAML（纯镜像）** | **否** | 只想在 GUI 里点几下 | 在 Compose 项目里点「拉取 / 更新」 |

### ⚠️ 飞牛图形界面最容易踩的坑

「Docker → Compose → 新增项目」有两种创建方式，行为完全不同：

| 创建方式 | 飞牛实际做了什么 | 用 `docker-compose.yml`（构建版） |
| --- | --- | --- |
| **粘贴 YAML / 导入 compose 文件** | 只把这段 YAML 存成项目配置，**不会**把 `Dockerfile`、`server/`、`web/` 一起放进来 | ✗ 必然报 `failed to read dockerfile` |
| **选择已有路径 / 指定项目目录** | 使用该目录下已有的 compose 文件 | ✓ 前提是目录里已有完整源码 |

**结论**：想在 GUI 里粘贴 YAML，请用**方式 C（纯镜像版 `docker-compose.image.yml`）**；想用构建版，就必须先把完整文件夹放到 NAS 上。

### 正确的目录长这样

```text
/vol1/docker/nestledger/          ← Compose 的项目路径指到这里
├─ docker-compose.yml
├─ docker-compose.image.yml
├─ Dockerfile                     ← 必须与 compose 同层
├─ .env.example
├─ .env                           ← 可选，从 .env.example 复制
├─ server/
│  ├─ index.js
│  └─ package.json
├─ web/
│  └─ index.html
├─ scripts/
│  └─ predeploy.sh
└─ data/                          ← 首次启动自动生成，不用手动建
```

常见的**错误**结构（ZIP 解压时多套了一层）：

```text
/vol1/docker/nestledger/
├─ docker-compose.yml             ← 项目路径指到这里，但文件不全
└─ nestledger/                    ← 真正的项目都在这层
   ├─ Dockerfile
   ├─ server/
   └─ web/
```

ZIP 包解开后是 `nestledger/` 这一层；如果又新建了一个同名文件夹再解压，就会变成双层。**把 `nestledger/` 里的内容放到项目路径下即可**，或者把项目路径直接指向内层 `nestledger/`。

---

## 2. 把项目放到 NAS

### 方式 A · SSH + git clone（推荐）

在 NAS 终端或 SSH 客户端：

```bash
mkdir -p /vol1/docker && cd /vol1/docker
git clone https://github.com/<你的用户名>/nestledger.git
cd nestledger
cp .env.example .env
bash scripts/predeploy.sh          # 确认文件齐全
```

私有仓库需先配置访问令牌，或改用方式 B。

### 方式 B · 图形界面上传

1. 使用交付的 `nestledger-v1.1.1.zip`（或最新版本包），在飞牛「文件管理」里进入 `/vol1/docker`
2. 上传并解压，得到 `/vol1/docker/nestledger`
3. **确认** `Dockerfile`、`server/`、`web/` 与 `docker-compose.yml` 在同一层（对照上一节的目录示意）
4. 把 `.env.example` 复制一份重命名为 `.env`
5. 在终端跑 `bash scripts/predeploy.sh` 确认通过

> `data/` 不用预先创建，Compose 首次启动会自动生成。

### 方式 C · 纯镜像，GUI 粘贴 YAML（零源码文件）

前提：仓库已推到 GitHub，Actions 构建完成，`ghcr.io/<用户名>/nestledger:latest` 可用且 Packages 可见性为 Public。

1. 把 `docker-compose.image.yml` 的**全部内容**复制下来
2. 把 `image: ghcr.io/yourname/nestledger:latest` 里的 `yourname` 换成你的 GitHub 用户名（全小写）
3. 飞牛 Docker → **Compose** → 新增项目 → 选择「粘贴 YAML / 编辑 compose」→ 粘贴 → 项目名 `nestledger` → 启动
4. 端口默认 `8787:8787`，需要改就直接改 YAML 里的 `ports`

这个模式**不执行 `docker build`**，只拉一个已构建好的镜像，因此不依赖 NAS 上任何源码文件，也不会出现 `failed to read dockerfile`。数据依然落在 Compose 项目目录的 `./data`。

---

## 3. 启动（方式 A / B）

```bash
cd /vol1/docker/nestledger
bash scripts/predeploy.sh          # 强烈建议先跑
docker compose up -d --build
docker compose ps                  # 状态应为 healthy / running
docker compose logs -f             # 首次看一眼启动日志，Ctrl+C 退出日志
```

图形界面方式（方式 A / B 已放好完整目录的情况）：

1. Docker → **Compose / 项目 / 堆栈** → 新增项目
2. 项目名称 `nestledger`，**路径选择 `/vol1/docker/nestledger`**（选路径，不是粘贴 YAML）
3. 确认端口映射 `8787:8787`；改了 `.env` 里的 `PORT` 就以实际为准
4. 点启动 / 部署，首次构建约 1–3 分钟
5. 容器详情里确认健康状态为 healthy

---

## 4. 访问

同一局域网内任意设备打开：

```text
http://<NAS 的 IP>:8787
```

例如 `http://192.168.1.20:8787`。手机、平板、电脑访问这个地址，看到的都是同一份数据。

| 顶栏状态 | 含义 |
| --- | --- |
| 已保存到 NAS（绿） | 已连上服务端，数据权威副本在 `data/db.json` |
| 正在同步 / 待同步（黄） | 写入中，或离线暂存本机、稍后自动重试 |
| 待同步（离线）（红） | 服务端连不上，数据暂存浏览器，恢复后自动重试 |
| 本机浏览器存储（灰） | 未检测到同步服务，退回纯本地模式 |

---

## 5. 首次使用建议

1. 打开后如果显示示例数据，到「数据备份」→「清空全部数据」再开始录入
2. 如果之前用单文件版录过数据：在旧页面「导出完整数据（JSON）」，在新页面「导入备份」
3. 到「数据备份」页点一次「立即生成快照」，确认 `data/backups/` 里出现了文件
4. 在 NAS 上给 `/vol1/docker/nestledger/data` 所在共享文件夹开启定时快照

---

## 6. 更新

**方式 A / B（源码构建）**

```bash
cd /vol1/docker/nestledger
git pull                          # 方式 B 改为重新上传解压
docker compose up -d --build
```

**方式 C（纯镜像）**

在飞牛 Compose 项目里点「拉取 / 更新」，或 SSH 执行：

```bash
docker compose -f docker-compose.image.yml pull
docker compose -f docker-compose.image.yml up -d
```

更新只替换容器与网页，**不会动 `./data`**。升级前顺手跑一次 `./scripts/backup.sh` 更稳妥。

> 注意：旧文档里提到的「在 `.env` 设 `IMAGE=ghcr.io/...` 然后 `docker compose pull`」已不再适用 —— 主 compose 现在不含 `image:` 字段，请直接用 `docker-compose.image.yml`。

---

## 7. 常用命令

| 目的 | 命令 |
| --- | --- |
| 部署前自检 | `bash scripts/predeploy.sh` |
| 启动 / 重建 | `docker compose up -d --build` |
| 停止 | `docker compose down` |
| 查看日志 | `docker compose logs --tail=100` |
| 查看状态 | `docker compose ps` |
| 健康检查 | `curl http://127.0.0.1:8787/api/health` |
| 备份数据 | `./scripts/backup.sh` |
| 恢复数据 | `./scripts/restore.sh ./backups/xxx.tar.gz` |
| 项目自检 | `node scripts/check.mjs` |

---

## 8. 排障

### `failed to read dockerfile: open Dockerfile: no such file or directory`

**根因**：构建上下文（`context: .`）里没有 `Dockerfile`。按顺序排查：

1. `bash scripts/predeploy.sh` —— 会直接指出缺什么、是不是双层目录
2. 若只上传了 compose 文件 → 按第 2 节重新放完整项目，或改用方式 C
3. 若 GUI 是「粘贴 YAML」创建的 → 改用「选择已有路径」，或改用方式 C
4. 若 ZIP 解压多套一层 → `cd` 到含 `Dockerfile` 的那一层再启动

### `Get "https://registry-1.docker.io/v2/": context deadline exceeded` / 构建卡在拉基础镜像

**根因**：国内 NAS 访问 Docker Hub 超时。这影响两处：旧版 compose 的 `Pulling`（v1.1.1 已移除）、以及 `Dockerfile` 的 `FROM node:22-alpine`。

1. **首选**：飞牛 Docker → 设置 → 镜像加速，填入你 NAS 能用的加速器地址，保存后重启 Docker 服务，再 `docker compose up -d --build`
2. **备选**：在 `.env` 里把 `BASE_IMAGE` 改成 NAS 能拉到的 `node:22-alpine` 完整地址（例如 `BASE_IMAGE=你的加速地址/library/node:22-alpine`），然后重新构建
3. **彻底绕开**：改用方式 C 纯 GHCR 镜像，NAS 上不需要任何构建

### `nestledger Pulling` 但没有本地构建动作

说明你用的是 v1.1.0 或更早的 compose（同时写了 `image:` 和 `build:`）。更新到 v1.1.1 后主 compose 已移除 `image:`，或直接用 `docker-compose.image.yml`。

### `COPY failed: file not found` / 构建中途失败

同样是源码文件没传全（尤其 `server/` 或 `web/` 空目录）。跑一次 `bash scripts/predeploy.sh`。

### 容器起不来 / 端口冲突

`docker compose logs` 看报错；改 `.env` 的 `PORT` 后重新 `up -d --build`。

### 能打开页面但一直是「本机浏览器存储」

说明 8787 端口进的不是本项目容器，或 Nginx / 反代把 `/api/*` 拦截了。直接访问 `http://<IP>:8787/api/health`，正常返回一小段 JSON。

### 写入报 413 / 附件传不上去

`.env` 里调大 `MAX_BODY`，然后 `docker compose up -d`。

### `data/` 没有写入权限

容器默认以 root 运行仍失败时，检查共享文件夹权限；或在 compose 里加 `user: "1000:1000"`，并先执行 `chown -R 1000:1000 ./data`。

### 想从外网访问

填 `.env` 的 `AUTH_USER` / `AUTH_PASS`（方式 C 则在 YAML 的 `environment` 里取消注释），并强烈建议在 NAS 反向代理上启用 HTTPS；不要把裸端口映射到公网。
