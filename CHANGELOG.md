# 更新日志

本项目使用 [语义化版本](https://semver.org/lang/zh-CN/)。

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
