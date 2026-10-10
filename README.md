# Lampstage · 创境 AI 内容与媒体平台

> Turn source assets into reusable AI workflows.
> 把素材变成可复用的 AI 工作流。

[lampstage.com](https://lampstage.com) — image generation, video generation and ecommerce content workflows, with a versioned API entry point.

2026-10-10：当前工作区已发布到 `lampstage.com`。公开首页、工作台、账号注册、视频工作台与开发者入口可访问；生产任务仍需有效的 PostgreSQL/Supabase 连接、migrations 和独立 worker。公开 API 当前开放能力目录与健康检查，写入型任务接口按文档中的安全前置条件推进。

本地新增[视频工作台](http://127.0.0.1:3000/video-workspace)：参考视频、源素材、参考画面确认、01 账号 H3 分段生成与合成。独立本地数据库、登录、素材上传和草稿保存已跑通，H3 01 已完成一次真实 5 秒验收；生产视频仍需独立 worker、私有 R2 和有效数据库。查看[本地使用说明](本地使用说明.md)与[视频实施说明](docs/implementation/2026-10-07-video-beta.md)。

开发者入口：[`/developers`](https://lampstage.com/developers)。API 发现接口为 `/api/v1`、`/api/v1/health` 和 `/api/v1/capabilities`。可导入的 WorkBuddy Expert 位于 `workbuddy-expert/lampstage-commerce-creator`，包含产品理解、关键词优化、图片、视频与任务素材 Skills。

## 技术栈

- **Frontend + Backend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Database**: Prisma + PostgreSQL (Supabase free tier)
- **AI image generation**: server-side OpenLux models (`nano banana 2.1` / `image 2.5`), selected by runtime configuration
- **Object storage**: Aliyun OSS / Cloudflare R2

## 本地启动

Windows 本机：双击根目录 **启动本地网站.cmd**，它会启动独立数据库、网站与视频 worker；登录资料见 `apps/web/.local-runtime/本地登录与配置.txt`。停止时使用 **停止本地网站.cmd**。完整操作与剩余配置见[本地使用说明](本地使用说明.md)。

原有云数据库的开发方式仍可使用（需自行确认其连接配置有效）：

```bash
cd apps/web
cp ../../.env.example .env.local
# 填好 .env.local 里的密钥
npm install
npm run dev
```

打开 http://localhost:3000

## 仓库结构

```
lamp-saas-mvp/
├── apps/web/             # Next.js 应用（前端 + 后端 API）
│   ├── app/              # 页面 + Route Handlers
│   ├── components/       # 复用组件（auth, i18n, ...）
│   ├── lib/              # brand / auth / db / providers
│   ├── prisma/           # schema + seed
│   ├── public/scene-examples/ # 本轮新生成的首页场景示例（非客户结果）
│   └── public/showcase/  # 历史展示素材，来源核实见素材清单
├── docs/superpowers/     # PRD + 计划
├── sketches/             # HTML 视觉草图（首页 002 + 工作台 001）
├── scripts/              # 一次性运维脚本
├── workbuddy-expert/     # WorkBuddy Expert + MCP / Connector 配置
├── docs/platformization/ # 平台化、API 与 Expert 交付边界
└── .github/workflows/    # CI
```

## 双语 i18n

- 全站文案集中在 `apps/web/lib/brand.ts`
- 客户端通过 `useLang()` 读 / 切，cookie 持久化
- 新访客默认中文；尊重已有语言 cookie，右上角可切换中英文

## 文档

- 参考视频＋商品图接入评估与阶段计划：`docs/research/2026-10-07-hypit-video-integration-assessment.md`（本地代码已接入；一次 H3 01 真实成片已验收，实际账单和生产 worker 仍待补）
- 国内商家需求调研：`docs/research/2026-10-07-domestic-lamp-merchant-demand.md`
- 最新跨境商品场景图定位修正：`docs/research/2026-10-07-crossborder-positioning-correction.md`（旧国内交付方案仅作历史假设）
- 当前页面审查：`docs/design-audit/2026-10-07/README.md`
- 全站改版规格及视觉候选：`docs/superpowers/specs/2026-10-07-lampstage-merchant-redesign-design.md`、`docs/design-concepts/2026-10-07/README.md`（旧版已归档）
- 最新场景优先视觉候选：`docs/design-concepts/2026-10-07-scene-first/README.md`（用户已选择新版 2，全站本地实现与 UI 验收完成）
- 改版实现与验收：`docs/implementation/2026-10-07-scene-gallery-redesign.md`、`design-qa.md`；公开页面已发布，真实登录、生成、扣费与支付闭环仍待有效生产数据库和线上验收
- 当前项目情况与推进计划：`docs/superpowers/plans/2026-10-06-lampstage-project-roadmap.md`
- 项目卡片与当前任务：`PROJECT_CARD.md`、`TASKS.md`
- 产品 PRD：`docs/superpowers/specs/2026-06-09-lamp-saas-mvp-design.md`
- Phase 1 开发计划：`docs/superpowers/plans/2026-06-09-lamp-saas-mvp-phase1.md`
