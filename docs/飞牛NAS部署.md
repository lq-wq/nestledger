# 飞牛 NAS（fnOS）部署指南

> 目标：在 NAS 上跑一个容器，浏览器 / 手机访问 `http://NAS的IP:8787`，数据全部落在 NAS 的 `data/` 目录。
> 不同 fnOS 版本的菜单名称略有差异，认准「Docker → Compose / 项目 / 堆栈」即可。
>
> **v1.2.0 重要变化**：默认主文件 `docker-compose.yml` 已改为**自包含版，不含 `build`**。以前那个 `failed to read dockerfile` 报错，从这一版起用主文件粘贴就不会再出现。源码构建能力移到 `docker-compose.build.yml`。
>
> **v1.2.1 升级提示**：本次修复账单「账期与收租时间错位」。升级后请按第 8 节清理一次旧版遗留的错位账单，已收账单不受影响。
>
> **v1.2.2 升级提示**：修复「删空账单后重新生成，提示已生成却看不到」。若升级前账单已被旧筛选隐藏，见第 10 节排障。
>
> **v1.3.0 升级提示**：新增版本号与网页端自动更新。**这是最后一次需要手动替换 YAML**，之后 GitHub 更新代码、Actions 跑完，网页会自动升级；详见第 8 节。

---

## 0. 如果你已经报错了，先看这一段

```text
failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory
```

### 最快解（三步，不需要上传任何文件）

1. 打开最新版 **`docker-compose.yml`（默认主文件，约 76 KB）**，Ctrl+A **全选复制整份内容**
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

## 1. 五种部署方式怎么选

| 方式 | Compose 文件 | 需要 NAS 上有源码 | 需要 GitHub | 触发 build | 更新方式 |
| --- | --- | --- | --- | --- | --- |
| **一 · GUI 粘贴（推荐）** | `docker-compose.yml` | **否** | **否** | **否** | **v1.3.0 起网页端自动更新**（首次升级仍需粘贴一次） |
| 二 · SSH / git clone | `docker-compose.yml` | 否 | 是 | 否 | 网页端自动更新，或 `git pull && docker compose up -d` |
| 三 · 源码构建（进阶） | `docker-compose.build.yml` | **是** | 否 | **是** | `git pull && docker compose -f docker-compose.build.yml up -d --build` |
| 四 · GHCR 纯镜像 | `docker-compose.image.yml` | 否 | 是 | 否 | 在 Compose 里点「拉取 / 更新」 |
| 五 · 镜像 + Watchtower | `docker-compose.autoupdate.yml` | 否 | 是 | 否 | **Actions 推完镜像自动重建容器**（需挂 `docker.sock`） |

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

1. 打开 `docker-compose.yml`，**全选复制整份内容**（约 76 KB，大部分是一行应用包）
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

也可在飞牛「文件管理」上传 `nestledger-v1.2.2.zip` 解压，把 `nestledger/` 里的内容放到 `/vol1/docker/nestledger`，再按上面的命令启动。

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

前提：仓库已推到 GitHub，Actions 的 **Build and Publish Image** 构建完成，`ghcr.io/lq-wq/nestledger:latest` 可用且 Packages 可见性为 Public。

1. 复制 `docker-compose.image.yml` 全部内容（镜像地址已填好 `ghcr.io/lq-wq/nestledger:latest`；fork 到其他账号时把 `lq-wq` 换成你的用户名，全小写）
2. 飞牛 **Compose → 新增项目 → 粘贴 YAML** → 项目名 `nestledger` → 启动

同样不含 `build`，不需要任何本地源码文件。镜像版设了 `UPDATE_OFF: 1`，由容器层管理版本：Actions 推完新镜像后在 Compose 里点「拉取 / 更新」即可。

---

## 5.1 方式五 · 镜像 + Watchtower（Actions 推完镜像后全自动）

想要「GitHub 更新代码 → Actions 构建发布镜像 → NAS 容器自己更新」，用 `docker-compose.autoupdate.yml`：它比方式四多一个 `watchtower` 容器，每 30 分钟检查一次 GHCR 上的新 digest，发现就自动拉取并重建 `nestledger`。

1. 复制 `docker-compose.autoupdate.yml` 全部内容，粘贴进飞牛 Compose 项目
2. 启动后访问 `http://<NAS 的 IP>:8787`

⚠️ 两个前提：飞牛 NAS 允许挂载 `/var/run/docker.sock`（部分 fnOS 版本的图形界面会拦截），且能拉到 `containrrr/watchtower` 镜像；国内拉不到 Docker Hub 时先配镜像加速。任一不满足就退回方式一 —— **默认自包含版的网页端自动更新不需要 docker.sock，同样能自动升级到最新代码**。

> 方式一与方式五的区别：方式一更新的是 `data/app` 里的网页与服务端代码（不动容器）；方式五替换的是整个容器镜像。两者都用 GitHub + Actions，按需选一条即可，不要同时开。

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
| 一（GUI 粘贴主文件） | **网页端自动更新**（见下）；开发者改源码才需要 `node scripts/gen-standalone.mjs` 重建并替换 YAML |
| 二（SSH / git clone） | 网页端自动更新，或 `git pull && docker compose up -d` |
| 三（源码构建） | `git pull && docker compose -f docker-compose.build.yml up -d --build` |
| 四（GHCR 镜像） | 飞牛 Compose 点「拉取 / 更新」；或 `docker compose -f docker-compose.image.yml pull && docker compose -f docker-compose.image.yml up -d` |
| 五（镜像 + Watchtower） | 全自动：Actions 推新镜像 → Watchtower 拉取并重建容器 |

`node scripts/gen-standalone.mjs` 会同时重建 `docker-compose.yml` 与 `docker-compose.standalone.yml`；`node scripts/check.mjs` 会校验内联包与源码一致，防止改了前端却忘了重新生成。更新只替换容器与网页，**不会动 `./data`**；升级前顺手跑一次 `./scripts/backup.sh` 更稳妥。

### 网页端自动更新（v1.3.0 起，方式一 / 二）

**这是最后一次需要手动替换 YAML。** 把新版 `docker-compose.yml`（约 76 KB）整份粘贴进现有 Compose 项目并启动，
`./data` 不动、数据不丢。之后链路全自动：

```text
GitHub push → Actions「Build and Publish Image」
   ├─ check.mjs 一致性门禁（VERSION / 四处版本号 / 更新包 / 内联 Compose）
   ├─ 推送 ghcr.io/lq-wq/nestledger:latest
   └─ 发布 update/latest.json 到 Release「latest」
                    ↓
NAS 服务端每 6 小时（或网页点「检查更新」）拉取清单
   → sha256 / 体积 / 版本标记 / node --check 校验
   → 写 ./data/app 覆盖层（更新前自动数据快照）
   → 网页立即生效；服务端代码变了才自动重启容器
```

**网页操作**：顶栏版本号（如 `v1.3.0`，有新版时带红点）→「关于与更新」→ **检查更新** / **更新到 vX** /
自动更新开关 / **恢复内置版本**。弹窗里能看到当前版本、内置版本、覆盖层版本、运行模式、更新来源与最近检查时间。

**升级后怎么确认生效**：打开页面看顶栏版本号是否变成最新版；或访问
`http://<NAS IP>:8787/api/version`，应返回 `{"version":"...","builtin":"...","overlay":"..."}`。

**国内访问 GitHub 不稳定**（飞牛 NAS 常见）：在主 compose 的 `environment` 加一行指向可达的更新清单镜像，
例如 `UPDATE_MANIFEST_URL: https://你的镜像/update/latest.json`，再加 `UPDATE_ONLY_CUSTOM: 1` 禁止回退。
若想「只有 CI 全部通过才更新」，把 `UPDATE_MANIFEST_URL` 填成
`https://github.com/lq-wq/nestledger/releases/download/latest/latest.json`（这个地址由 Actions 成功后才发布）。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `UPDATE_AUTO` | `1` | 自动应用；改 `0` 只提示，需手动点「更新到 vX」 |
| `UPDATE_AUTO_RESTART` | `1` | 服务端变化后自动重启；改 `0` 需手动重启 |
| `UPDATE_INTERVAL` | `21600` | 检查间隔（秒），默认 6 小时 |
| `UPDATE_TIMEOUT` | `8000` | 单源超时（毫秒） |
| `UPDATE_OFF` | `1` 关闭 | 彻底关闭联网检查（镜像版 / 源码构建版已设） |

**镜像版 / 源码构建版不用这套**：它们设了 `UPDATE_OFF: 1`，避免覆盖层版本与镜像内置版本打架。
方式四在飞牛 Compose 点「拉取 / 更新」；方式五用 `docker-compose.autoupdate.yml` 的 Watchtower 自动完成
（需要 NAS 允许挂载 `/var/run/docker.sock`，且能拉到 `containrrr/watchtower` 镜像）。

### 从 v1.2.0 升到 v1.2.1：清理旧版错位账单

v1.2.1 修正了存量合同的账期基准（详见 `CHANGELOG.md`），**只影响升级后新生成的账单**。
如果你之前批量生成过「账期 `2026-09 ~ 2026-11` 却配收租时间 `2029-02-24`」这类错配账单，升级后做一次：

1. 先跑 `./scripts/backup.sh` 备份 `data/`（保险起见）
2. 页面进「租金账单」→ 点「批量生成账单」，弹窗会提示检测到多少笔错位账单
3. 「旧版错位账单」保持 **清理（推荐）**，确认
4. 系统删除未收款、无备注的错位账单并按新规则重建；账单页的黄色提示条随之消失

已收 / 部分收款 / 有备注 / 手工编辑过的账单一律保留。若不想自动清理，把该选项改为「保留」再自行逐条删除。

### 从 v1.2.1 升到 v1.2.2：生成可见性

这一版不改变任何账单数据，只修「生成后能不能看见」。整体替换新版 `docker-compose.yml` 并重启即可，
`.env`、`./data` 都不用动。升级后直接再点一次「批量生成账单」就会自动清筛选并跳回账单页；
已存在的账期不会重复生成。

---

## 9. 常用命令

| 目的 | 命令 |
| --- | --- |
| 部署前自检（自动识别模式） | `bash scripts/predeploy.sh` |
| 自检源码构建版 | `bash scripts/predeploy.sh . docker-compose.build.yml` |
| 重新生成主 compose | `node scripts/gen-standalone.mjs` |
| 同步版本号并重建更新包 | `node scripts/sync-version.mjs` |
| 项目自检 | `node scripts/check.mjs` |
| 真实启动验证内联包 | `node scripts/test-standalone.mjs` |
| 接口冒烟 | `node scripts/smoke.mjs` |
| 账单期次回归 | `node scripts/test-bills.mjs` |
| 自动更新链路回归 | `node scripts/test-update.mjs` |
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

### 提示已生成账单，但租金账单页看不到

v1.2.1 及更早版本会保留账单页筛选状态。删空账单后，原先选中的月份从动态下拉里消失，
界面显示「全部月份」而内部筛选值仍是旧月份，新生成的账单被静默过滤；新账期从收租日次月起算，
筛选「当月」也看不到。v1.2.2 起生成成功后会自动清除筛选并跳回账单页。

升级前已经生成过账单的，两种做法都可以（账单本来就在库里，不需要重新录入）：

1. 进「租金账单」页，看到「当前筛选条件下没有账单」提示条时点 **清除筛选，查看全部**
2. 或再点一次「批量生成账单」——不会重复生成，会自动清筛选并跳回账单页

还有一种情况：合同「本次租金」标为 **已收讫**，本期按业务语义不生成待收账单，会从下一期开始。
需要连本期一起生成，就在「租客与合同」里把该合同的「本次租金」改成 **待收** 再生成。

### 账单的账期和收租时间对不上

例如账期 `2026-09 ~ 2026-11` 却配收租时间 `2029-02-24`。这是 v1.2.0 及更早版本对**存量合同**
（已收过若干期、只更新了本次收租时间）用了两套不同期次基准导致的，v1.2.1 已修正。

- 先按第 8 节把 `docker-compose.yml` 整份换成 v1.2.1 版本并重启（GUI 粘贴 / `git pull` 均可）
- 再在「租金账单」→「批量生成账单」里选 **清理（推荐）** 重建错位账单
- 新生成的账单账期从本次收租日次月起算，收租时间就是本次收租时间

### 概览「本月待收」是 ¥0，但当月明明有一笔收入

这是 **v1.2.1 账单期次修复带出来的回归，v1.3.1 已修**。旧版概览用「账期覆盖当月」筛账单；
v1.2.1 起账期从本次收租日的次月起算（如 2026-11-24 收租对应账期 2026-12 ~ 2027-02），
收租当月永远不再被账期覆盖，所以「本月待收」「应收」「已收」全是 ¥0，
但同页收租时间尺仍会显示 11 月 24 日有 1 笔，看起来自相矛盾。

- **处理**：按第 8 节把 `docker-compose.yml` 整份换成 v1.3.1 版本并重启，**刷新页面即可**，
  不需要重新生成账单，也不需要重新录入任何数据。
- **新口径**：账单按**本期收租时间**所在月归月，季付 / 半年付账单只在收租月计一次，不再重复计全额；
  缺收租时间的旧账单自动回退为账期覆盖，历史数据不会凭空消失。
- **本月收支**：卡片下方新增小计条，按财务流水日期显示本月收入 / 支出 / 净额与本月应收账单笔数。
  因此即使只在「财务流水」手工记了一笔收入、没生成账单，概览也能看到这笔钱。

### 顶栏没有版本号按钮 / 点「检查更新」报错

只有 **v1.3.0 及以上**才有版本与更新模块。先确认顶栏是否显示 `v1.3.0`；没有就按第 0 节把新版
`docker-compose.yml` 整份替换粘贴一次。若旧容器连不上 `/api/update/status`，页面会安静降级为纯本地展示，不影响业务。

### 「更新检查未成功」「所有更新源均不可用」

业务功能与数据完全不受影响，检查失败时**不会写入任何文件**。按顺序排查：

1. 在 NAS 上试 `curl -I https://cdn.jsdelivr.net/gh/lq-wq/nestledger@main/update/latest.json`，确认能否访问 GitHub / CDN
2. 连不上就加 `UPDATE_MANIFEST_URL` 指向国内可达的镜像（配合 `UPDATE_ONLY_CUSTOM: 1`），或 `UPDATE_OFF: 1` 关闭
3. 想立即重试：网页「关于与更新」→ **检查更新**（强制刷新，不走 6 小时缓存）
4. 查看容器日志 `docker compose logs --tail=100`，会打印「自动更新检查失败：…」的具体原因

### 更新后界面异常，想退回旧版

点「关于与更新」→ **恢复内置版本**，会删除 `data/app` 覆盖层并回到容器自带版本；`data/db.json` 与
`data/backups/` 完全不动。也可以在 NAS 上停掉容器、删除 `data/app/` 目录再启动。
更新前自动生成的快照在「数据备份」页可直接下载还原。

### 自动更新会不会把我的数据覆盖

不会。更新只写 `data/app/web/index.html` 与 `data/app/server/index.js`；业务数据始终在 `data/db.json`。
所有下载包都要过整体 sha256、逐文件 sha256、体积、版本标记与 `node --check` 五道校验，坏包直接拒绝安装。

### 想从外网访问

在主文件 YAML 的 `environment` 里取消 `AUTH_USER` / `AUTH_PASS` 注释（方式三改 `.env`），并强烈建议套一层 NAS 反向代理 + HTTPS；不要把裸端口映射到公网。
