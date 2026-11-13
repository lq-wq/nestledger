# 飞牛 NAS（fnOS）部署指南

> 目标：在 NAS 上跑一个容器，浏览器 / 手机访问 `http://NAS的IP:8787`，数据全部落在 NAS 的 `data/` 目录。
> 不同 fnOS 版本的菜单名称略有差异，认准「Docker → Compose / 项目 / 堆栈」即可。
>
> **v1.2.0 重要变化**：默认主文件 `docker-compose.yml` 已改为**自包含版，不含 `build`**。以前那个 `failed to read dockerfile` 报错，从这一版起用主文件粘贴就不会再出现。源码构建能力移到 `docker-compose.build.yml`。
>
> **v1.2.1 升级提示**：本次修复账单「账期与收租时间错位」。升级后请按第 8 节清理一次旧版遗留的错位账单，已收账单不受影响。

---

## 0. 如果你已经报错了，先看这一段

```text
failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory
```

### 最快解（三步，不需要上传任何文件）

1. 打开最新版 **`docker-compose.yml`（默认主文件，约 64 KB）**，Ctrl+A **全选复制整份内容**
2. 飞牛 **Docker → Compose** → 打开你现有的 `nestledger` 项目 → 编辑 YAML → **整体粘贴替换**旧内容 → 启动；或删掉旧项目重新「新增项目 → 粘贴 YAML」
3. 浏览器打开 `http://<NAS 的 IP>:8787`

> ✅ 关键两点：**用最新版主文件内容**，以及**不要加 `--build`**。
> 新版主文件里没有 `build` 段，Docker 根本不会去找 Dockerfile，这个报错从根上消失。
> 兼容副本 `docker-compose.standalone.yml` 与主文件逐字相同，用哪个都行。

### 为什么之前反复报这个错

| 现象 | 原因 |
| --- | --- |
| `failed to read dockerfile` | 旧版（v1.1.2 及更早）主 `docker-compose.yml` 含 `build: { context: . }`，Docker 会在 **compose 文件所在目录** 找 `Dockerfile`。飞牛 GUI「粘贴 YAML」创建的项目里只有那段 YAML，永远不会带 `Dockerfile`、`server/`、`web/` |
| `nestledger Pulling` + `registry-1.docker.io ... context deadline exceeded` | v1.1.0 及更早的 compose 同时写了 `image:` 和 `build:`，Compose 先去 Docker Hub 找同名镜像，国内 NAS 连不上就超时。这是独立的第二个问题 |

v1.1.1 / v1.1.2 分别修掉了 Pulling 超时、并另外提供了一份自包含 YAML，**但主 `docker-compose.yml` 仍带 `build`** —— 所以只要你继续用主文件粘贴，报错就会一直在。v1.2.0 把主文件本身换成了自包含版，才算彻底收口。

### 如果你确实要用源码构建版

只有 `docker-compose.build.yml` 含 `build`，它要求 `Dockerfile`、`server/`、`web/` 与它同层。GUI 粘贴创建的空项目**不要用这份**。详见第 4 节。

### 数据不会丢

自包含版与旧版都挂载 `./data:/data`，业务数据、合同附件、自动快照都在同一个目录。换新 YAML / 重启容器**不会动它**。若你新建了另一个 Compose 项目目录，把旧项目里的 `data/` 整个复制过去即可。

> 已用真实 Node 进程验证：从交付 YAML 中解包出的两个文件与源码逐字一致，首页、健康检查、数据读写、快照共 24 项通过。容器层因开发机没有 Docker 未实测；在 NAS 上可用 `docker compose up -d && docker compose ps` 确认。

---

## 1. 四种部署方式怎么选

| 方式 | Compose 文件 | 需要 NAS 上有源码 | 需要 GitHub | 触发 build | 更新方式 |
| --- | --- | --- | --- | --- | --- |
| **一 · GUI 粘贴（推荐）** | `docker-compose.yml` | **否** | **否** | **否** | 重新生成并整体替换 YAML |
| 二 · SSH / git clone | `docker-compose.yml` | 否 | 是 | 否 | `git pull && docker compose up -d` |
| 三 · 源码构建（进阶） | `docker-compose.build.yml` | **是** | 否 | **是** | `docker compose -f docker-compose.build.yml up -d --build` |
| 四 · GHCR 纯镜像 | `docker-compose.image.yml` | 否 | 是 | 否 | 在 Compose 里点「拉取 / 更新」 |

### 飞牛图形界面两种创建方式的区别

| 创建方式 | 飞牛实际做了什么 | 用 v1.2.0 主 `docker-compose.yml` | 用 `docker-compose.build.yml` |
| --- | --- | --- | --- |
| **粘贴 YAML / 导入 compose 文件** | 只把这段 YAML 存成项目配置，**不会**带上 `Dockerfile`、`server/`、`web/` | ✅ 可用（零文件依赖） | ✗ 必然报 `failed to read dockerfile` |
| **选择已有路径 / 指定项目目录** | 使用该目录下已有的 compose 文件 | ✅ 可用 | ✅ 前提是目录里已有完整源码 |

**结论**：v1.2.0 起 GUI 粘贴直接用默认主文件即可，不必再挑文件名；只有明确要 `docker build` 时才用 `docker-compose.build.yml` 且必须选路径。

### 目录结构

方式一 / 二只需要一个文件：

```text
/vol1/docker/nestledger/          ← Compose 项目路径
├─ docker-compose.yml             ← 主文件，自包含（必需，仅此一个）
└─ data/                          ← 首次启动自动生成
```

方式三（源码构建）才需要这些，且必须与 compose 同层：

```text
/vol1/docker/nestledger/
├─ docker-compose.build.yml
├─ Dockerfile                     ← 必须与 compose 同层
├─ server/index.js
├─ server/package.json
├─ web/index.html
├─ .env.example / .env
└─ scripts/predeploy.sh
```

常见的**错误**结构（ZIP 解压时多套了一层）：

```text
/vol1/docker/nestledger/
├─ docker-compose.build.yml       ← 项目路径指到这里，但文件不全
└─ nestledger/                    ← 真正的项目都在这层
   ├─ Dockerfile
   ├─ server/
   └─ web/
```

ZIP 解开后是 `nestledger/` 这一层；如果又新建同名文件夹再解压，就会变成双层。**把 `nestledger/` 里的内容放到项目路径下**，或把项目路径直接指向内层即可。用主文件自包含版则完全不受影响。

---

## 2. 方式一 · GUI 粘贴主文件（推荐，零前提）

1. 打开 `docker-compose.yml`，**全选复制整份内容**（约 64 KB，大部分是一行应用包）
2. 飞牛 **Docker → Compose → 新增项目 → 粘贴 YAML**，项目名 `nestledger`，启动
3. 访问 `http://<NAS 的 IP>:8787`

**原理**：把 `server/index.js` 与 `web/index.html` 压成一行 Brotli + base64 放进 `APP_BUNDLE`，容器启动后由 `node:22-alpine` 里的 Node 自行解包到 `/app` 再运行。因此：

- **不需要** Dockerfile、`server/`、`web/` 等任何本地文件
- **不需要** GitHub / GHCR 镜像
- **不执行** `docker build`，不会再出现 `failed to read dockerfile`
- 业务数据仍在 Compose 项目目录的 `./data`，重启 / 换版本都不丢
- 唯一外部依赖是 `node:22-alpine` 基础镜像，国内 NAS 拉不到时见第 10 节

**改配置**：主文件**不读 `.env`**。端口改 `ports: - "8787:8787"`；口令在 `environment` 里取消 `AUTH_USER` / `AUTH_PASS` 两行注释；快照份数改 `BACKUP_KEEP`；附件上限改 `MAX_BODY`。改完重新启动项目。

**粘贴别截断**：`APP_BUNDLE` 是单行约 6 万字符，务必 Ctrl+A 全选复制。切到终端时可用 `bash scripts/predeploy.sh` 检查该行长度是否完整。

---

## 3. 方式二 · SSH / git clone

```bash
mkdir -p /vol1/docker && cd /vol1/docker
git clone https://github.com/<你的用户名>/nestledger.git
cd nestledger
bash scripts/predeploy.sh       # 会识别 MODE=standalone 并放行
docker compose up -d            # 注意：不加 --build
docker compose ps
```

私有仓库需先配置访问令牌。`predeploy.sh` 会自动判断 compose 模式：主文件是自包含版时**不要求** Dockerfile；只有显式检查 `docker-compose.build.yml` 时才逐项核对源码文件。

也可在飞牛「文件管理」上传 `nestledger-v1.2.1.zip` 解压，把 `nestledger/` 里的内容放到 `/vol1/docker/nestledger`，再按上面的命令启动。

---

## 4. 方式三 · 源码构建版（进阶，需要完整项目目录）

只有当你需要「改源码后重新 `docker build`」时才用：

```bash
cd /vol1/docker/nestledger
bash scripts/predeploy.sh . docker-compose.build.yml   # 逐项检查 Dockerfile / server / web
cp .env.example .env                                  # 可选：改端口 / 口令 / BASE_IMAGE
docker compose -f docker-compose.build.yml up -d --build
docker compose -f docker-compose.build.yml ps
```

> ⚠️ 在飞牛 GUI「粘贴 YAML」创建的空项目里不要用这一版 —— GUI 只保存 YAML，
> 不会把 `Dockerfile`、`server/`、`web/` 放进来，必然报 `failed to read dockerfile`。
> 这种情况请改用方式一。

---

## 5. 方式四 · GHCR 纯镜像（GUI 粘贴，需 GitHub）

前提：仓库已推到 GitHub，Actions 构建完成，`ghcr.io/<用户名>/nestledger:latest` 可用且 Packages 可见性为 Public。

1. 复制 `docker-compose.image.yml` 全部内容
2. 把 `image: ghcr.io/yourname/nestledger:latest` 里的 `yourname` 换成你的 GitHub 用户名（全小写）
3. 飞牛 **Compose → 新增项目 → 粘贴 YAML** → 项目名 `nestledger` → 启动

同样不含 `build`，不需要任何本地源码文件；已推 GitHub 的话长期更新比方式一更省事。

---

## 6. 访问

同一局域网内任意设备打开 `http://<NAS 的 IP>:8787`，例如 `http://192.168.1.20:8787`。手机、平板、电脑访问这个地址，看到的都是同一份数据。

| 顶栏状态 | 含义 |
| --- | --- |
| 已保存到 NAS（绿） | 已连上服务端，数据权威副本在 `data/db.json` |
| 正在同步 / 待同步（黄） | 写入中，或离线暂存本机、稍后自动重试 |
| 待同步（离线）（红） | 服务端连不上，数据暂存浏览器，恢复后自动重试 |
| 本机浏览器存储（灰） | 未检测到同步服务，退回纯本地模式 |

---

## 7. 首次使用建议

1. 打开后如果显示示例数据，到「数据备份」→「清空全部数据」再开始录入
2. 之前用单文件版录过数据：旧页面「导出完整数据（JSON）」→ 新页面「导入备份」
3. 到「数据备份」页点一次「立即生成快照」，确认 `data/backups/` 里出现文件
4. 在 NAS 上给 `data/` 所在共享文件夹开启定时快照

---

## 8. 更新

| 方式 | 更新操作 |
| --- | --- |
| 一（GUI 粘贴主文件） | 本机 `node scripts/gen-standalone.mjs` → 把新 `docker-compose.yml` 整份替换进 Compose 项目 → 重启 |
| 二（SSH / git clone） | `git pull && docker compose up -d` |
| 三（源码构建） | `git pull && docker compose -f docker-compose.build.yml up -d --build` |
| 四（GHCR 镜像） | 飞牛 Compose 点「拉取 / 更新」；或 `docker compose -f docker-compose.image.yml pull && docker compose -f docker-compose.image.yml up -d` |

`node scripts/gen-standalone.mjs` 会同时重建 `docker-compose.yml` 与 `docker-compose.standalone.yml`；`node scripts/check.mjs` 会校验内联包与源码一致，防止改了前端却忘了重新生成。更新只替换容器与网页，**不会动 `./data`**；升级前顺手跑一次 `./scripts/backup.sh` 更稳妥。

### 从 v1.2.0 升到 v1.2.1：清理旧版错位账单

v1.2.1 修正了存量合同的账期基准（详见 `CHANGELOG.md`），**只影响升级后新生成的账单**。
如果你之前批量生成过「账期 `2026-09 ~ 2026-11` 却配收租时间 `2029-02-24`」这类错配账单，升级后做一次：

1. 先跑 `./scripts/backup.sh` 备份 `data/`（保险起见）
2. 页面进「租金账单」→ 点「批量生成账单」，弹窗会提示检测到多少笔错位账单
3. 「旧版错位账单」保持 **清理（推荐）**，确认
4. 系统删除未收款、无备注的错位账单并按新规则重建；账单页的黄色提示条随之消失

已收 / 部分收款 / 有备注 / 手工编辑过的账单一律保留。若不想自动清理，把该选项改为「保留」再自行逐条删除。

---

## 9. 常用命令

| 目的 | 命令 |
| --- | --- |
| 部署前自检（自动识别模式） | `bash scripts/predeploy.sh` |
| 自检源码构建版 | `bash scripts/predeploy.sh . docker-compose.build.yml` |
| 重新生成主 compose | `node scripts/gen-standalone.mjs` |
| 项目自检 | `node scripts/check.mjs` |
| 真实启动验证内联包 | `node scripts/test-standalone.mjs` |
| 接口冒烟 | `node scripts/smoke.mjs` |
| 账单期次回归 | `node scripts/test-bills.mjs` |
| 启动（方式一 / 二） | `docker compose up -d` |
| 启动（方式三） | `docker compose -f docker-compose.build.yml up -d --build` |
| 停止 | `docker compose down` |
| 查看日志 | `docker compose logs --tail=100` |
| 查看状态 | `docker compose ps` |
| 健康检查 | `curl http://127.0.0.1:8787/api/health` |
| 备份 / 恢复 | `./scripts/backup.sh` / `./scripts/restore.sh ./backups/xxx.tar.gz` |

---

## 10. 排障

### `failed to read dockerfile: open Dockerfile: no such file or directory`

**根因**：项目里用的 compose 仍含 `build`，而构建上下文（`context: .`）里没有 `Dockerfile`。按顺序排查：

1. **最快**：确认你用的是 **最新版 `docker-compose.yml`**（默认主文件）。打开文件看顶部注释应写「自包含版」，并且全文没有 `build:` 段。把它的**整份内容**重新粘贴进 Compose 项目即可
2. 若你用的是 `docker-compose.build.yml`（或 v1.1.2 及更早的主 compose），改用主文件；坚持源码构建则跑 `bash scripts/predeploy.sh . docker-compose.build.yml`，按提示补齐 `Dockerfile`、`server/`、`web/`
3. GUI 是「粘贴 YAML」创建的 → 不要选构建版；或改用「选择已有路径」并放好完整源码
4. ZIP 解压多套一层 → `cd` 到含 `Dockerfile` 的那一层再启动，或把内容上移一层
5. 仍报错 → `docker compose config | grep -A3 build` 确认生效的配置里是否还有 build 段（可能是旧项目残留的 `compose.override.yml`）

### `Get "https://registry-1.docker.io/v2/": context deadline exceeded`

**根因**：国内 NAS 访问 Docker Hub 超时，影响主文件的 `image: node:22-alpine` 以及构建版的 `FROM node:22-alpine`。

1. **首选**：飞牛 Docker → 设置 → 镜像加速，填入可用的加速器地址，保存后重启 Docker 服务，再重新启动项目
2. **备选（方式一 / 二）**：把 `docker-compose.yml` 里 `image: node:22-alpine` 一行改成 NAS 能拉到的完整地址，例如 `加速地址/library/node:22-alpine`
3. **备选（方式三）**：在 `.env` 里把 `BASE_IMAGE` 改成同样地址，然后 `docker compose -f docker-compose.build.yml up -d --build`
4. **彻底绕开**：改用方式四（GHCR 镜像），只拉 ghcr.io，通常国内可直连

### `nestledger Pulling` 但没有本地构建动作

用的是 v1.1.0 或更早的 compose（同时写了 `image:` 和 `build:`）。升级到最新版主文件即可消除。

### `COPY failed: file not found` / 构建中途失败

只会出现在方式三：源码文件没传全（尤其 `server/` 或 `web/` 是空目录）。跑 `bash scripts/predeploy.sh . docker-compose.build.yml`，或改用方式一。

### 自包含版启动后容器立刻退出

看 `docker compose logs`。最常见是粘贴时 YAML 被截断（`APP_BUNDLE` 那一整行不完整）。请从文件里重新 Ctrl+A 全选复制，不要手选；也可跑 `bash scripts/predeploy.sh` 检查该行长度（应 > 50000 字符）。

### 改了 `.env` 却不生效

默认主文件 `docker-compose.yml` **不读 `.env`**。端口 / 口令 / 快照份数请直接改 YAML 的 `ports` 与 `environment` 后重启。只有方式三 `docker-compose.build.yml` 会读 `.env`。

### 容器起不来 / 端口冲突

`docker compose logs` 看报错；改主文件 YAML 的 `ports`（方式一 / 二 / 四），或 `.env` 的 `PORT`（方式三）后重新启动。

### 能打开页面但一直是「本机浏览器存储」

8787 端口进的不是本项目容器，或 Nginx / 反代把 `/api/*` 拦截了。直接访问 `http://<IP>:8787/api/health`，正常返回一小段 JSON。

### 写入报 413 / 附件传不上去

调大 `MAX_BODY`：方式一 / 二 / 四改 YAML 的 `environment`，方式三改 `.env`，然后重新启动项目。

### `data/` 没有写入权限

检查共享文件夹权限；或在 compose 里加 `user: "1000:1000"`，并先执行 `chown -R 1000:1000 ./data`。

### 账单的账期和收租时间对不上

例如账期 `2026-09 ~ 2026-11` 却配收租时间 `2029-02-24`。这是 v1.2.0 及更早版本对**存量合同**
（已收过若干期、只更新了本次收租时间）用了两套不同期次基准导致的，v1.2.1 已修正。

- 先按第 8 节把 `docker-compose.yml` 整份换成 v1.2.1 版本并重启（GUI 粘贴 / `git pull` 均可）
- 再在「租金账单」→「批量生成账单」里选 **清理（推荐）** 重建错位账单
- 新生成的账单账期从本次收租日次月起算，收租时间就是本次收租时间

### 想从外网访问

在主文件 YAML 的 `environment` 里取消 `AUTH_USER` / `AUTH_PASS` 注释（方式三改 `.env`），并强烈建议套一层 NAS 反向代理 + HTTPS；不要把裸端口映射到公网。
