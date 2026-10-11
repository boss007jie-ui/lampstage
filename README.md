# Lampstage · WorkBuddy Expert API 平台

> Connect WorkBuddy to reusable image, video and commerce workflows.
> 将 WorkBuddy 接入可复用的图片、视频和电商内容工作流。

[lampstage.com](https://lampstage.com) — account registration, per-user API keys and a versioned API entry point for the WorkBuddy Creative Expert.

2026-10-11：网站入口已收敛为 WorkBuddy Expert/API 产品页、账号注册、个人 API 密钥和开发者接入说明。用户可在 `/account` 创建个人 API Key，再由 Creative Expert 通过 Bearer 鉴权调用 `/api/v1` 的素材、图片任务、视频项目和任务查询接口。旧的网页生成工作台已从公开入口移除；后端 API 保留以供 Expert 使用。

WorkBuddy Expert 的视频流程包含参考视频分段、首尾帧确认、预算确认和 Hypit/RunningHub H3 渲染；生产任务仍需有效的 PostgreSQL、migrations、对象存储和独立 worker。查看[本地使用说明](本地使用说明.md)与[视频实施说明](docs/implementation/2026-10-07-video-beta.md)。

开发者入口：[`/developers`](https://lampstage.com/developers)，密钥管理：[`/account`](https://lampstage.com/account)。API 发现接口为 `/api/v1`、`/api/v1/health` 和 `/api/v1/capabilities`。可导入的 WorkBuddy Creative Expert 位于 `workbuddy-expert/lampstage-commerce-creator`：它组合产品理解、电商关键词优化、图片生成、Hypit/RunningHub H3 视频复刻和任务查询，并随包提供 MCP 桥接脚本。

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
