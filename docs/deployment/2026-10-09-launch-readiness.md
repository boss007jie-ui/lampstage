# 灯境上线准备记录 — 2026-10-09

## 当前线上状态

- Vercel 项目：`lampstage`，根目录 `apps/web`。
- 已绑定并验证的域名：`lampstage.com`、`www.lampstage.com`、`lampstage.vercel.app`。
- 历史基线部署来自 Git 提交 `bf1c3a0ee332c2a58a0dfb7e206978ac64bf2575`；当前生产部署见下方 `dpl_7P9y6vmz7wScnYkVMPD1oTEpZ22w`。
- 本地最新代码已通过 `npm run build` 和 `npm run typecheck`。
- 工作区仍可能包含未跟踪的设计草稿和本地临时文件；它们不属于 `c94747e` 发布提交，也不会进入远端构建。

2026-10-09 已将当前工作区发布到生产部署 `dpl_7P9y6vmz7wScnYkVMPD1oTEpZ22w`，并绑定回 `lampstage.com`。构建成功，首页、工作台静态页面和两个模型名称可访问。部署前修复了 `vercel.json` 的 UTF-8 BOM，并将图片生成路由的 `maxDuration` 调整为 Hobby 计划允许的 300 秒。之后的平台 API 与 WorkBuddy 视频复刻改动已在 Git 提交 `c94747e` 推送到 `master`；公开 `capabilities`、`developers` 和视频准备/渲染路由均可达，视频写入仍会在数据库不可用时返回 503/401 等预期保护状态。

线上冒烟结果：`/` 和 `/workspace` 返回 200；`/api/templates` 返回 500，`/api/videos/capabilities` 返回数据库未就绪。原因是本次授权写入的本机数据库连接串对应的 Supabase 用户已经不存在；本机迁移命令也返回同一数据库身份错误。当前生产版本应视为“公开页面已上线，登录、上传、保存和生图待补有效生产数据库”。

## 可以先上线的部分

第一阶段的公开页面和图片工作台页面已经上线，视频继续保持内测开关。线上图片业务仍需要有效生产数据库和已完成 migrations；`OPENLUX_API_KEY` 已按授权写入 Vercel Production，本地通过源 `.env` 路径加载的方式不能在 Vercel 上工作。

上线前要在有效的目标生产数据库执行现有 Prisma migrations，至少包含 `20261007120000_video_beta`，并确认公开图片 R2 的生产变量仍指向正确的 bucket。新图片模型只在服务端使用该 key，不能写入前端或仓库。

## 视频正式可用的条件

Vercel Web 负责页面和 API，视频队列必须由另一台 Linux VM 或容器持续运行：

1. 同一生产 PostgreSQL，已完成 Prisma migrations。
2. 私有视频 R2 bucket，供网页直传、worker 读写和成片下载；不能依赖 Vercel 本地磁盘。
3. Node、FFmpeg、FFprobe、Hypit vendor/runtime 和持久化工作目录。
4. `RUNNINGHUB_API_KEY_01`、`VIDEO_HYPIT_RUNTIME`、H3 单段报价和内测邮箱白名单，只放在 worker 的 secret 环境。
5. systemd 或 Docker restart policy，以及 heartbeat/队列监控。

本次本地 H3 任务从确认到完成约 16 分 31 秒。Vercel 请求函数不适合作为常驻 worker；即使配置长函数，也不能替代持久化队列、Hypit 回执和 FFmpeg 工作目录。

## 中国大陆云部署包

本次新增了腾讯云优先的可执行部署包：[`infra/tencent`](../../infra/tencent/README.md)。它把 Web、视频 Worker 和 Caddy 放进 Docker Compose，数据库使用 TencentDB for PostgreSQL，媒体使用 COS，Worker 通过 Hypit 0.2.17、FFmpeg 和 RunningHub account 01 运行。腾讯 COS 与当前 AWS S3 SDK 的适配已改为真实 region 和可配置虚拟主机式访问；Cloudflare R2 仍可通过原有变量继续使用。

建议先在广州 `ap-guangzhou` 或上海 `ap-shanghai` 建立同地域 VPC、TencentDB、两个私有 COS 桶和一台 Linux CVM。资源购买、DNS 修改和密钥写入仍需在用户自己的腾讯云账号中完成；仓库不保存任何云密钥。

## 推荐发布顺序

1. 将当前工作区整理为可审阅的发布提交，先创建 Vercel Preview。
2. 在 Preview 配置 OpenLux 图片 key、生产数据库和公开 R2 的非敏感连接验证，做登录、上传、模型选择、图片生成和下载验收。
3. Preview 通过后发布图片生产版；视频页面继续显示内测状态，不开放没有 worker 的付费提交。
4. 准备 Linux worker、私有 R2 和视频 secret，完成迁移和队列恢复验收后，再开放视频内测。

## 当前仍需明确的外部动作

- 已获授权并完成：将 AI-media-tools 源 `.env` 中的 OpenLux 图片 key 写入 Vercel Production 环境。
- 已完成：采用现有 `lampstage.com` 作为图片版第一阶段生产域名并发布页面。
- 需要提供或重新创建有效的 Supabase/Postgres 生产连接串；现有连接串对应的数据库用户已失效，不能继续用于线上。
- 视频 worker 运行位置（已有 Linux VM/容器，或另行准备）。

不要把任何 key 写进 Git、前端变量或聊天记录。Vercel Production 已有 `OPENLUX_API_KEY`；视频私有 R2、H3 worker 和生产数据库仍未配置，因此不能把“网页部署成功”表述成“视频生产已上线”。
