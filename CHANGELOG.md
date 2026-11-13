# 更新日志

本项目使用 [语义化版本](https://semver.org/lang/zh-CN/)。

## v1.3.0 — 2026-11-13

**新增版本号显示与网页端自动更新。** 顶栏常驻当前版本号，点开「关于与更新」即可检查并安装新版；GitHub 仓库更新代码、Actions「Build and Publish Image」跑完后，NAS 上的网页会自己升级到最新版本，不用再重新粘贴整份 compose。

- **版本号单一真源**：新增 `VERSION` 与 `scripts/sync-version.mjs`，把版本同步到 `server/index.js`、`server/package.json`、`web/index.html` 与根目录单文件版；`scripts/check.mjs` 会校验四处一致，杜绝「健康检查写死 1.0.0」这类漂移
  - 顶栏新增版本按钮（有新版时显示红点），「关于与更新」弹窗显示当前版本 / 内置版本 / 覆盖层版本 / 运行模式 / 更新来源 / 最近检查
  - 单文件本地版（`file://`）同样显示版本号，但**完全不联网**，只提示手动替换 HTML
- **网页端自动更新（默认自包含版）**：服务端新增 `/api/version` 与 `/api/update/status|check|apply|config|rollback|restart`
  - 更新包是仓库里的 `update/latest.json`：把 `web/index.html` + `server/index.js` 压成 Brotli+base64，带整体 sha256 与逐文件 sha256 / 体积 / 版本标记，还会在落盘前对新服务端跑一次 `node --check`
  - 服务端默认按 `jsDelivr → raw.githubusercontent → Release asset` 多源回退；`UPDATE_MANIFEST_URL` 可指向国内可达的镜像，`UPDATE_ONLY_CUSTOM=1` 可禁止回退
  - 校验通过才写入 `./data/app` 覆盖层；**更新前自动生成一次数据快照**，旧覆盖层留一份 `previous/`，「恢复内置版本」一键回退，业务数据始终在 `data/db.json` 不受影响
  - 前端是每次请求实时读盘，**网页部分立即生效**；服务端代码有变化时才重启容器，并带「10 分钟内最多 2 次」的防循环保护
  - 默认每 6 小时自动检查并应用；网页里可改成「只提示不自动装」，也可设 `UPDATE_OFF=1` 彻底关闭
- **容器启动器增强**：自包含 Compose 的 BOOT 在 `require()` 之前把 `data/app` 覆盖层复制进 `/app`，因此**容器重启不会退回旧版**；同时记录真实内置版本 `NESTLEDGER_BUILTIN`，有覆盖层时也能准确显示「内置 vX / 覆盖层 vY」
- **CI 与镜像通道**：`.github/workflows/release.yml` 在 `Build and Publish Image` 之后新增「发布更新清单」步骤（固定 Release `latest` + artifact），`check.mjs` 作为发布前门禁
  - `docker-compose.image.yml` 的 `yourname` 占位改成真实地址 `ghcr.io/lq-wq/nestledger:latest`
  - 新增 `docker-compose.autoupdate.yml`：GHCR 镜像 + Watchtower，Actions 推完镜像自动拉取重建容器；需要 NAS 允许挂载 `docker.sock`
  - 镜像版 / 源码构建版设 `UPDATE_OFF=1`，由容器层或 `git pull --build` 更新，避免与覆盖层版本口径冲突
- 新增 `scripts/test-update.mjs`（54 项，本地假更新源 + 真实服务端，覆盖 7 类坏包、校验、快照、覆盖层生效、回滚、降级包、源不可用、幂等）；`scripts/test-standalone.mjs` 增加「容器重启后覆盖层生效」9 项（24 → 33 项）；`scripts/check.mjs` 由 105 扩到 176 项

**验证**：项目自检 176 项、账单回归 83 项、接口冒烟 23 项、自包含版真实启动 33 项、更新链路 54 项、NAS 模式真实浏览器 10 项、单文件本地版真实浏览器 7 项；三个 shell 脚本语法与部署自检均通过；两份 HTML 版本模块逐字一致。容器层与 GitHub Actions 因开发机无 Docker / 未推送远端未实测。

> **升级到 v1.3.0 是最后一次需要手动粘贴 YAML**：把新版 `docker-compose.yml` 整份替换进飞牛 Compose 项目并启动即可，`./data` 不动、数据不丢。之后 GitHub 上改代码 → Actions 跑完 → 网页自动更新。
> 若 NAS 访问 GitHub 不稳，在 YAML 的 `environment` 加 `UPDATE_MANIFEST_URL` 指向可达的更新清单镜像，或到「关于与更新」手动点「检查更新」。

## v1.2.2 — 2026-11-13

**修复「手动删除全部账单后重新生成，提示已生成却在租金账单页看不到」。** 用户反馈：删空账单 → 批量生成 → 提示已生成，列表仍是空的。用真实浏览器复现出两条独立成因，均已修复。

- **主因 · 筛选残留形成幽灵过滤**：账单页的「状态 / 账期 / 关键词」筛选存在 `state.f.bills`，删除账单不会重置。删空账单后原先选中的月份会从动态生成的下拉里消失，界面显示「全部月份」、内部筛选值却仍是旧月份，用户根本无法自查；而新账单账期从收租日次月起算，即便筛选的是「当月」也会被过滤掉。复现结果：`created=1`、库内 1 笔、表格 0 行
  - 新增 `revealBills()`：生成成功后清除筛选与勾选、自动切到「租金账单」页；批量生成与单合同生成都走这条路径
  - 新增 `validMonthFilter()`：进入账单页 / 流水页时，若当前月份筛选值已不在下拉选项中，自动回落为「全部月份」，消除下拉显示与内部值不一致
  - 账单页在「库内有账单但筛选结果为 0」时显示提示条与「清除筛选，查看全部」按钮，空表格文案同步
- **次因 · 本次已收讫时起始期被跳过**：`firstBillIndex()` 在 `rentSettled==='已收讫'` 时从 k=1 起算，但 `makeBillsFor()` 的生成下界只保护了第 0 期；删空账单后「生成至账期」选当月会 `created=0`，还提示「该期间账单已全部存在，无需重复生成」—— 一句与事实相反的话
  - 下界改为 `addMonths(baseM, firstBillIndex×span)`，起始期始终至少生成一笔
  - 生成提示改为「本次没有新增账单：所选期间已生成过，或已超出合同到期日」，不再谎称账单已存在
- `scripts/test-bills.mjs` 增加删空重建、已收讫下界、筛选校正与可见性回归（63 → 83 项）；`scripts/check.mjs` 增补可见性断言（96 → 105 项）
- 根目录单文件版与 `web/index.html` 同步；重建自包含 Compose 内联包；服务端与数据结构零改动

**验证**：真实 Edge 11 个场景（无筛选 / 月份筛选当月 / 幽灵旧月份 / 状态筛选 / 搜索词残留 / 本次已收讫等）全部 `created≥1`、表格可见、筛选被清空；项目自检 105 项、账单回归 83 项、接口冒烟 23 项、内联包真实启动 24 项。容器层因开发机无 Docker 未实测。

> **升级后怎么做**：你的账单其实已经生成了，只是被旧筛选隐藏。升级到 v1.2.2 后，进「租金账单」页若看到「当前筛选条件下没有账单」，点 **清除筛选，查看全部**；或直接再点一次「批量生成账单」（不会重复生成，会自动清筛选并跳回账单页）。
> 另外：合同「本次租金」标为 **已收讫** 时，本期按业务语义不生成待收账单，会从下一期开始；如需连本期一起生成，把该合同的「本次租金」改为 **待收**。

## v1.2.1 — 2026-11-12

**修复存量合同生成账单时「账期」与「收租时间」错位。** 反馈场景：季付合同起租 `2024-06-24`、本次收租时间已更新到 `2026-11-24`，批量生成后账单却显示「账期 `2026-09 ~ 2026-11`、收租时间 `2029-02-24`」；正确应为「账期 `2026-12 ~ 2027-02`、收租时间 `2026-11-24`」。

- **根因**：`makeBillsFor()` 把「本次收租时间」当成第 0 期的收租日，账期却仍从**起租月**逐期累加。对已经收过若干期、只更新了本次收租时间的存量合同，两个锚点相差 N 期，越往后错得越离谱。
- 新增统一期次基准 `billStartMonth(c)`：新签合同首期账期 = 起租月；本次收租时间已跨过至少一期的存量合同，账期从**收租日次月**开始。账期与收租时间从此共用同一个期次索引 `k`，不再各自起算
- 同步修正 `nextRentInfo()`、`nextDueAfterBill()`、`resyncBillDueDates()`、`settleFirstPeriod()` 及表单 / 弹窗 / 合同详情的说明文案；`makeBillsFor()` 增加生成下界保护，「生成至账期」选在当月时下一期账单仍会生成
- 新增旧版错位账单识别与清理：`misalignedBillIds()` / `removeMisalignedBills()`。「批量生成账单」弹窗新增「旧版错位账单：清理（推荐）/ 保留」选项，单合同生成同步清理，账单页检测到遗留错位账单时显示提示条。**只清理未收款、无备注且收租月份明显晚于账期结束月的自动账单**；已收 / 部分收款 / 有备注 / 手工编辑过的账单一律保留
- 新增 `scripts/test-bills.mjs` 回归测试（63 项，覆盖用户截图场景、新签合同、四种付款方式、月末跨年、已收讫、到期限制、收款顺延、旧账单清理重建）；`scripts/check.mjs` 增补期次基准与清理路径断言（82 → 96 项）
- 根目录 `房屋租赁管理系统.html` 与 `web/index.html` 同步修复；重建 `docker-compose.yml` / `docker-compose.standalone.yml` 的内联包（YAML 约 64 KB）
- 服务端、部署配置与数据结构零改动；`./data` 与已有业务数据不受影响

**验证**：项目自检 96 项、账单回归 63 项、两份 HTML 各 57 项 + 一致性 5 项（139 项）、接口冒烟 23 项、真实 Node 启动内联包 24 项、Edge 真实浏览器三场景 20 项；账单页截图目视核验为 `2026-12 ~ 2027-02` / `2026-11-24` / ¥4,800。容器层因开发机无 Docker 未实测。

> **已部署用户注意**：升级到 v1.2.1 只修「以后新生成」的账单。如果 NAS 上还留着旧版生成的错位账单，进「租金账单」→「批量生成账单」→「旧版错位账单」选 **清理（推荐）** → 确认，即可删除未收款错位账单并按新规则重建；已收账单与手工编辑过的账单不会被删。

## v1.2.0 — 2026-11-12

**把默认主文件 `docker-compose.yml` 本身改成自包含版**，彻底收口飞牛 NAS 上反复出现的 `failed to read dockerfile`。此前 v1.1.1 / v1.1.2 只是移除了无谓的 `image:` 并另外提供了一份自包含 YAML，主文件仍含 `build:` —— 用户按习惯粘贴 `docker-compose.yml` 时，报错必然复现。

- **主 `docker-compose.yml` 现为零文件依赖的自包含版**：不含 `build`、不依赖 Dockerfile / 源码目录、不读 `.env`，整份粘贴进飞牛 Compose 即可运行；`docker-compose.standalone.yml` 保留为逐字相同的兼容副本
- 原源码构建版另存为 **`docker-compose.build.yml`**（含 `build`，需完整项目目录，会读 `.env`），需要 `docker build` / `git pull` 的用户改用 `docker compose -f docker-compose.build.yml up -d --build`
- `scripts/gen-standalone.mjs` 现在同时产出主文件与兼容副本，并做内联包回读校验
- `scripts/predeploy.sh` 自动识别 compose 模式（`standalone` / `image` / `build`）：自包含模式不再要求 Dockerfile、会检查 `APP_BUNDLE` 是否被粘贴截断，并给出不带 `--build` 的启动命令；支持第二参数指定 compose 文件
- `scripts/check.mjs` 断言重排：主文件按自包含版校验、构建版按 `build` 段校验、两份逐字一致（自检 66 → 82 项）
- `scripts/test-standalone.mjs` 改为默认验证主文件，新增「主文件与兼容副本逐字一致」断言（24 项）
- 重写 `README.md` 与 `docs/飞牛NAS部署.md`：方式一改为「GUI 粘贴主文件」，明确主文件不读 `.env`、改配置直接改 YAML、旧项目 `data/` 迁移说明、报错的历史原因与三步最快解；`.env.example` 同步
- 前端与服务端业务代码**零改动**，数据卷 `./data:/data` 不变，升级不丢数据

**验证**：项目自检 82 项、接口冒烟 23 项、真实 Node 进程启动 24 项、shell 语法与部署自检多场景全通过；生成器幂等、ZIP 解压实测。容器层因开发机无 Docker 未实测。

## v1.1.2 — 2026-11-12

针对「飞牛 GUI 粘贴 YAML 创建的空项目」补一个**零前提**部署方式：这类项目目录里没有任何源码文件，只要 compose 里还有 `build:`，`failed to read dockerfile` 就无法通过修 Dockerfile 解决。

- 新增 `docker-compose.standalone.yml`：**完全不含 `build`**，把 `server/index.js` 与 `web/index.html` 用 Brotli + base64 压成一行 `APP_BUNDLE`，容器启动后由 `node:22-alpine` 里的 Node 自行解包到 `/app` 再运行。不需要 Dockerfile、源码文件、GitHub 或 GHCR，整份 YAML 粘贴进飞牛 Compose 即可
- 新增 `scripts/gen-standalone.mjs`：改完前端 / 服务端后一键重建自包含版；`scripts/check.mjs` 增加内联包与源码逐字一致性断言（自检由 51 增至 65 项）
- `scripts/predeploy.sh` 在「双层目录」「只导入 YAML」两种诊断里新增自包含版修复建议
- 重写 `docs/飞牛NAS部署.md`：四种部署方式对比、报错最快解、自包含版更新方法、YAML 截断排障；README 同步
- 自包含版唯一外部依赖是 `node:22-alpine`；国内 NAS 拉不到时文档给出镜像加速 / 换 image 地址 / 改用 GHCR 三条路径

**验证**：真实 Node 进程执行交付 YAML 里的启动器，解包文件与源码逐字一致，首页 / favicon / 健康检查 / 数据读写 / 快照共 22 项通过。容器层因开发机无 Docker 未实测，验证命令 `docker compose -f docker-compose.standalone.yml up -d && docker compose -f docker-compose.standalone.yml ps`。前端与服务端业务代码零改动。

## v1.1.1 — 2026-11-12

修复飞牛 NAS 上 `failed to read dockerfile` 与 Docker Hub 拉取超时两类部署问题。**纯部署链路改动，前端界面与业务逻辑零改动。**

- 主 `docker-compose.yml` 移除 `image:` 字段：此前 Compose 会先尝试从 Docker Hub 拉取 `nestledger:local`，国内 NAS 表现为 `nestledger Pulling` + `registry-1.docker.io ... context deadline exceeded` 警告
- 新增 `docker-compose.image.yml`：纯 GHCR 镜像模式，零本地源码文件依赖，飞牛图形界面「粘贴 YAML」即可部署，不触发 `docker build`，从根本上避开找不到 Dockerfile 的问题
- 新增 `scripts/predeploy.sh`：NAS 上一键自检目录结构，识别「ZIP 解压多套一层」「GUI 只导入了 YAML」两种常见错误，并给出可直接执行的修复命令
- `Dockerfile` 新增 `ARG BASE_IMAGE`；`.env.example` 新增 `BASE_IMAGE`，国内 NAS 可换成自己能拉到的 `node:22-alpine` 地址
- 主 compose 顶部加防呆注释；`scripts/check.mjs` 增补部署相关静态断言
- 重写 `docs/飞牛NAS部署.md`：三种部署方式对比、目录结构正误示意、两条报错的根因与分步修复、镜像加速说明；修正过期的 ZIP 包名引用
- README 更新配置表、图形界面部署说明与常见问题

> 升级不影响 `data/`。已用 v1.1.0 部署的 NAS：`git pull && docker compose up -d --build` 即可；若之前在 `.env` 里设过 `IMAGE`，该变量现已不再被主 compose 使用，改用 `docker-compose.image.yml` 走纯镜像模式。
>
> 注：以上是当时的版本说明。**v1.2.0 起**主 compose 已不含 `build`，源码构建命令改为 `docker compose -f docker-compose.build.yml up -d --build`；普通启动用 `docker compose up -d`。

## v1.1.0 — 2026-11-10

界面设计语言移植自「悦租管家」，只换视觉层与交互模式，**业务逻辑与数据结构零改动**。

- 设计令牌整体重校准：浅色深绿 `#14513A` / 墨绿侧栏 `#0B2E21` / 象牙白 `#F4F7F5` / 香槟金 `#C6A15B`；金色仅用于 logo、细线、选中指示与关键强调，占比 < 5%
- 夜间主题不是反色，重校准为夜墨绿 `#08150F` / 卡片 `#10231A` / 亮绿 `#4FB98A`，正文对比度 ≥ 4.5:1
- 卡片 14px 圆角、极轻阴影、大标题细字距；移除上一版蓝调 SaaS 感
- 主题切换双入口：顶栏白天 / 夜间分段控件 + 右上角悬浮按钮；首次访问跟随 `prefers-color-scheme`，选择仍存独立 `THEME_KEY`
- 新增批量删除：房源 / 房间 / 租客 / 合同 / 账单 / 流水六张主表支持勾选、全选、批量条与批量删除，复用单条删除的关联约束，有生效数据时不执行删除
- 同步更新界面截图（白天 / 夜间 / 批量删除）与 README
- 蓝色版原件存档于项目外的 `蓝色版存档/`，不进仓库与镜像

## v1.0.0 — 2026-11-09

首个可部署版本。

- 定名 **栖间 · NestLedger**，整理为可直接推送 GitHub 的完整仓库
- 保留原有单文件应用（房源与房间、租客与合同、租金与财务、下次交租与提醒、合同附件、白天 / 夜间主题）
- 新增零依赖 Node 服务端：静态托管、`/api/db` 读写、原子写入、`/api/health`、`/api/meta`
- 新增 NAS 自动快照：每次写入留档、轮转保留、页面内手动生成与下载
- 前端加入渐进式同步层：`file://` 零网络请求，HTTP 模式以 NAS 数据为准，支持离线暂存、自动重连、多设备拉取
- 新增 Dockerfile、docker-compose.yml、`.env.example`、GHCR 自动构建工作流
- 新增 `scripts/check.mjs`（静态自检）、`scripts/smoke.mjs`（接口冒烟）、`backup.sh` / `restore.sh`
- 新增 README、飞牛 NAS 部署指南、备份与恢复文档、MIT License
