# 栖间 · NestLedger

> 把房源、租客、合同和每一期租金，安放得井井有条。
> 一套完全属于你自己的房屋租赁与收租台账：单文件可用，也可以放进 NAS 的 Docker 里长期运行。

**栖间**：栖，是安居；间，是一间房。  
**NestLedger**：Nest（家）+ Ledger（台账），也是仓库与镜像的名字。

界面设计语言「墨庭 · Quiet Estate」：深绿 `#14513A` 主色、墨绿 `#0B2E21` 侧栏、象牙白 `#F4F7F5` 内容底，香槟金 `#C6A15B` 仅用于 logo、细线、选中指示与关键强调（面积占比 < 5%）。白天 / 夜间双主题，夜间是重新校准的夜墨绿 `#08150F` / 卡片 `#10231A` / 亮绿 `#4FB98A`，**不是反色**，正文对比度均 ≥ 4.5:1。顶栏分段控件与右上角悬浮按钮都能切换，首次访问跟随系统偏好。

---

## 界面预览

| 白天 | 夜间 |
| --- | --- |
| ![白天主题](docs/screenshots/light.png) | ![夜间主题](docs/screenshots/dark.png) |

---

## 它解决了什么

原来这个系统是一个 `HTML` 单文件，数据只存在**当前浏览器**里：换台电脑、清一次缓存、手机上看一眼，数据就对不上了，备份也只能靠手动导出。

这个仓库在原应用之上加了一层**零依赖的本地服务端**，于是同一份代码有了两种用法：

| | 单文件模式 | NAS / Docker 模式 |
| --- | --- | --- |
| 打开方式 | 双击 `web/index.html` | 浏览器访问 `http://NAS的IP:8787` |
| 数据存放 | 浏览器 `localStorage` | 服务器 `./data/db.json` |
| 网络请求 | **零请求**（`file://` 下完全不联网） | 仅访问自己的 NAS，无外网 |
| 多设备 | 各存各的 | 手机 / 电脑 / 平板共用一份 |
| 备份 | 手动导出 JSON | 每次保存自动快照 + 一键下载 + 目录级备份 |
| 更新 | 替换 HTML 文件 | `git pull && docker compose up -d --build` |
| 适用场景 | 临时离线用、随身携带 | 长期在 NAS 上使用（推荐） |

> 两种模式共用同一个 `web/index.html`。程序会自动探测：能连上同步服务就以 NAS 为准，否则安静地退回纯本地模式。

---

## 功能一览

- **房源与房间**：房源 → 房间层级，面积 / 户型 / 月租 / 押金 / 状态
- **租客与合同**：租客档案、合同起止、付款方式、本次收租时间、下次交租时间
- **合同附件**：JPG / JPEG / PNG / PDF（含用户常见的 `jepg` 拼写），单文件 ≤ 2 MB
- **租金与财务**：账单自动生成、收款、部分收款、收支流水、CSV 导出
- **收租提醒**：按「本次收租时间 + 付款方式」推算下一期；`1–10 天红`、`11–15 天黄`、`其他绿`（逾期归红、已结清灰）
- **数据备份**：完整 JSON 导入导出、NAS 自动快照、快照下载、一键备份脚本
- **界面**：深绿 × 象牙白 × 香槟金双主题、顶栏 + 右上角悬浮双入口切换、六张主表批量删除、桌面通知提醒、键盘与焦点可访问性

---

## 目录结构

```
nestledger/
├─ web/
│  └─ index.html              # 整个前端（单文件，零外部资源）
├─ server/
│  ├─ index.js                # 零依赖 Node 服务端：静态托管 + 数据 API + 快照
│  └─ package.json            # 无 dependencies
├─ Dockerfile                 # node:22-alpine，单容器（基础镜像可换）
├─ docker-compose.yml         # 源码构建版，飞牛 NAS 用这个
├─ docker-compose.image.yml   # 纯 GHCR 镜像版，GUI 粘贴 YAML 专用，零源码依赖
├─ .env.example               # 配置模板（复制为 .env）
├─ scripts/
│  ├─ predeploy.sh            # 部署前置自检（NAS 上先跑它）
│  ├─ check.mjs               # 项目自检（语法 / 外链 / 配置），CI 也在跑
│  ├─ smoke.mjs               # 接口冒烟测试（本地起服务验证读写/快照/鉴权）
│  ├─ backup.sh               # 打包 data 目录
│  └─ restore.sh              # 从备份包恢复
├─ docs/
│  ├─ 飞牛NAS部署.md
│  ├─ 备份与恢复.md
│  └─ screenshots/            # README 用的两张界面截图
├─ .github/workflows/release.yml   # 自动构建并推送 GHCR 镜像
├─ README.md
├─ CHANGELOG.md
└─ LICENSE                    # MIT
```

容器只做两件事：托管一个网页、读写一个 JSON 文件。**没有数据库、没有 npm 包、没有外网调用**，升级和排障都很轻。

---

## 快速开始

### 方式 A · 双击即用（不装任何东西）

直接打开 `web/index.html`。此时是纯本地模式，数据存浏览器，零网络请求。

### 方式 B · 本机 Node（不装 Docker）

需要 Node.js ≥ 18：

```bash
cd server
node index.js
# 打开 http://localhost:8787
```

数据默认写到仓库根目录的 `data/`。可用环境变量改位置：`DATA_DIR=/somewhere/data node index.js`。

### 方式 C · Docker Compose（推荐，飞牛 NAS 用这个）

```bash
bash scripts/predeploy.sh    # 先自检：Dockerfile/server/web 必须与本文件同层
cp .env.example .env         # 可选：改端口 / 时区 / 密码
docker compose up -d --build
# 打开 http://localhost:8787
```

> ⚠️ `docker-compose.yml` 用的是 `build: { context: . }`，所以 **`Dockerfile`、`server/`、`web/` 必须和它放在同一个目录**。若报 `failed to read dockerfile: open Dockerfile: no such file or directory`，跑一次 `bash scripts/predeploy.sh`，它会直接告诉你缺什么、是不是 ZIP 解压多套了一层。

首次启动服务端没有数据，网页会把浏览器里已有的数据（或示例数据）自动迁移到 `./data/db.json`。之后所有设备访问同一地址，看到的都是这一份。

---

## 推到 GitHub

仓库已经初始化好（含首次提交），你只需要建一个空仓库并推上去：

```bash
cd nestledger
git remote add origin https://github.com/<你的用户名>/nestledger.git
git branch -M main
git push -u origin main
```

> 在 GitHub 新建仓库时**不要**勾选 README / .gitignore / License，保持空仓库即可。
> `data/`、`.env`、`backups/` 已在 `.gitignore` 中，业务数据不会被推上去。

推上去之后，`.github/workflows/release.yml` 会自动构建镜像发布到 `ghcr.io/<你的用户名>/nestledger`。如果 Actions 提示权限不足，到仓库 **Settings → Actions → General → Workflow permissions** 勾选 **Read and write permissions**。首次推送镜像后，若镜像是 private，在 **Packages** 里把可见性改为 Public（或在 NAS 上 `docker login ghcr.io`）。

镜像可用后，就能用 `docker-compose.image.yml` 走「零源码文件」部署，见下一节方式三。

---

## 部署到飞牛 NAS（fnOS）

推荐目录：`/vol1/docker/nestledger`（卷名以你 NAS 实际为准）。

**方式一：终端 / SSH（最省事，后续更新也方便）**

```bash
cd /vol1/docker
git clone https://github.com/<你的用户名>/nestledger.git
cd nestledger
cp .env.example .env
bash scripts/predeploy.sh
docker compose up -d --build
```

浏览器打开 `http://<NAS 的 IP>:8787`。

**方式二：fnOS 图形界面（项目目录里已有完整源码）**

1. 先把**整个项目文件夹**（ZIP 解压后 `nestledger/` 里的内容）上传到 `/vol1/docker/nestledger`
2. 打开 **Docker / 容器管理** → **Compose（项目）** → 新建项目，项目名 `nestledger`，**路径选择 `/vol1/docker/nestledger`**
3. 端口保持 `8787:8787`，如需改端口编辑 `.env` 里的 `PORT`
4. 启动项目，访问 `http://<NAS 的 IP>:8787`

> ⚠️ 如果选择「粘贴 YAML / 导入 compose 文件」来创建项目，飞牛**只会保存这段 YAML**，不会把 `Dockerfile`、`server/`、`web/` 一起放进来，构建版必然报 `failed to read dockerfile`。这种情况请改用方式三。

**方式三：fnOS 图形界面（纯镜像，零源码文件，最省事）**

前提：已完成上面的 GitHub 推送，GHCR 镜像可用且为 Public。

1. 复制 `docker-compose.image.yml` 全部内容，把 `image: ghcr.io/yourname/nestledger:latest` 中的 `yourname` 换成你的 GitHub 用户名
2. 在飞牛 **Compose → 新增项目** 里选择「粘贴 YAML / 编辑 compose」，粘贴后启动
3. 访问 `http://<NAS 的 IP>:8787`

这个模式不执行 `docker build`，不需要 NAS 上有任何源码文件，也不会报找不到 Dockerfile。

> 不同 fnOS 版本的菜单名称略有差别，认准「Compose / 项目 / 堆栈」即可。目录结构示意、镜像加速配置与完整排障见 [docs/飞牛NAS部署.md](docs/飞牛NAS部署.md)。

**数据卷**：`./data:/data`。所有业务数据、合同附件、自动快照都在这一个目录里，**升级容器不会动它**。建议把它放在 NAS 上有快照 / 冗余保护的共享文件夹。

---

## 数据存储与备份

```
nestledger/data/
├─ db.json          # 权威数据（含合同附件的 base64）
├─ meta.json        # 版本号 rev + 最后写入时间
└─ backups/
   └─ db-20261109-131000-r12.json   # 每次保存前的历史快照，默认保留 30 份
```

三层保险，按需取用：

1. **自动快照**：每次写入自动生成，误删一条合同也能回到上一版
2. **页面操作**：「数据备份」页 → 立即生成快照 / 刷新列表 / 直接下载任意快照；也可导出完整 JSON
3. **目录级备份**：在 NAS 上执行 `./scripts/backup.sh`，把整个 `data/` 打成 tar.gz；再配合飞牛自带的快照、外接硬盘或网盘做异地副本

恢复方式：页面「导入备份」选 JSON → 覆盖当前数据；或用 `./scripts/restore.sh <备份包>` 整目录还原。详见 [docs/备份与恢复.md](docs/备份与恢复.md)。

> 想换 NAS、换电脑、换 Docker：停掉容器，把 `data/` 整个复制到新机器的同位置，再 `docker compose up -d` 即可，无需导入导出。

---

## 更新与维护

**源码更新（方式一 / 二）**

```bash
cd /vol1/docker/nestledger
git pull
docker compose up -d --build
```

**镜像更新（方式三）**

在飞牛 Compose 项目里点「拉取 / 更新」，或 SSH 执行：

```bash
docker compose -f docker-compose.image.yml pull
docker compose -f docker-compose.image.yml up -d
```

改动前端或服务端后，本地先跑一遍：

```bash
bash scripts/predeploy.sh   # NAS 上：部署前置自检
node scripts/check.mjs     # 语法、外链、品牌、compose 配置等静态自检
node scripts/smoke.mjs     # 起两个临时服务，验证读写 / 快照 / 鉴权
```

打版本标签（`git tag v1.1.1 && git push origin v1.1.1`）会触发 Actions 生成带版本号的镜像，方便回滚到指定版本。

> v1.1.0 及更早版本里「在 `.env` 设 `IMAGE=` 再 `docker compose pull`」的做法已废弃：主 compose 不再含 `image:` 字段（避免国内 NAS 无谓地访问 Docker Hub 超时）。请统一改用 `docker-compose.image.yml`。

---

## 配置项

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 宿主机访问端口（容器内部固定 8787） |
| `TZ` | `Asia/Shanghai` | 时区，影响快照文件名与日期 |
| `BACKUP_KEEP` | `30` | 自动快照保留份数 |
| `BACKUP_ON_WRITE` | `1` | 每次写入是否自动快照，`0` 关闭 |
| `MAX_BODY` | `67108864` | 单次请求上限（字节），默认 64 MB |
| `AUTH_USER` / `AUTH_PASS` | 空 | 同时填写才启用 HTTP Basic 认证 |
| `BASE_IMAGE` | `node:22-alpine` | 源码构建时的基础镜像；国内 NAS 拉不到 Docker Hub 时换成可用地址 |

改完 `.env` 后执行 `docker compose up -d` 让配置生效（改 `BASE_IMAGE` 需 `up -d --build`）。

> 纯镜像模式（`docker-compose.image.yml`）不读 `.env`，端口和参数直接写在 YAML 的 `ports` / `environment` 里修改。

---

## 安全建议

- 默认**不带认证**，请只在家庭局域网 / VPN 内使用；不要把 8787 端口直接映射到公网
- 确需外网访问时：填 `AUTH_USER` / `AUTH_PASS`，并建议再套一层 NAS 的反向代理 + HTTPS
- 数据包含租客姓名、电话、身份证号与合同扫描件，属于敏感个人信息；`data/` 不要放进公开仓库、不要同步到公共网盘
- 容器默认以 root 运行，是为了兼容不同 NAS 对 `./data` 目录的属主差异；如果 NAS 上权限收紧，可在 compose 里增加 `user: "1000:1000"` 并提前 `chown -R 1000:1000 ./data`

---

## 常见问题

**Q：部署报 `failed to read dockerfile: open Dockerfile: no such file or directory`？**  
构建上下文里没有 `Dockerfile`。先跑 `bash scripts/predeploy.sh`；常见原因是 ZIP 解压多套了一层，或在飞牛 GUI 用「粘贴 YAML」创建项目导致只保存了 compose 文件。修复步骤见 [部署文档排障章节](docs/飞牛NAS部署.md#8-排障)，或直接改用方式三纯镜像模式。

**Q：日志里 `nestledger Pulling` 和 `registry-1.docker.io context deadline exceeded`？**  
v1.1.0 及更早版本的 compose 同时写了 `image:` 与 `build:`，Compose 会先去 Docker Hub 找同名镜像。更新到 v1.1.1 即可消除。若构建卡在拉 `node:22-alpine`，在「飞牛 Docker → 设置 → 镜像加速」配置加速器，或在 `.env` 设置 `BASE_IMAGE`；也可用方式三彻底绕开构建。

**Q：打开后显示的还是旧数据？**  
NAS 上的 `data/db.json` 是权威副本，首次连接会以它为准。想用旧浏览器里的数据，先在旧页面「导出完整数据（JSON）」，再到 NAS 页面「导入备份」。

**Q：手机和电脑数据不一致？**  
切回页面或等待 20 秒会自动拉取最新版；顶栏状态显示「已保存到 NAS」即已同步。两端同时编辑时，以最后一次保存为准。

**Q：顶栏显示「待同步（离线）」？**  
数据已暂存浏览器，网络恢复后会自动重试写入；期间请勿清理浏览器数据。

**Q：端口被占用？**  
改 `.env` 的 `PORT`，例如 `PORT=8877`，然后 `docker compose up -d`。纯镜像模式则直接改 YAML 的 `ports`。

**Q：合同附件能传多大？**  
单文件 ≤ 2 MB；NAS 模式总容量比纯本地模式宽松得多（服务端上限 64 MB，可在 `.env` 调 `MAX_BODY`）。

**Q：想改项目名？**  
改 `web/index.html` 里的 `APP_NAME` / `APP_NAME_EN`、`<title>`、侧栏品牌区；容器名与镜像名在 `docker-compose.yml` 里改。

---

## License

[MIT](LICENSE) · 前端为单文件原生 HTML/CSS/JS，服务端只用 Node 内置模块，无任何第三方运行时依赖。
