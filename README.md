# Lampstage · 灯境

> Turn one lamp photo into shelf-ready scene shots.
> 一张灯具图，生成可直接上架的家居场景图。

[lampstage.com](https://lampstage.com) — AI scene-photography for lamp sellers on Shopify, Amazon, Tmall and 1688.

## 技术栈

- **Frontend + Backend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Database**: Prisma + PostgreSQL (Supabase free tier)
- **AI image generation**: Nano Banana via yunwu.ai
- **Object storage**: Aliyun OSS / Cloudflare R2

## 本地启动

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
│   └── public/showcase/  # 首页展示图（nano banana 真实生成）
├── docs/superpowers/     # PRD + 计划
├── sketches/             # HTML 视觉草图（首页 002 + 工作台 001）
├── scripts/              # 一次性运维脚本
└── .github/workflows/    # CI
```

## 双语 i18n

- 全站文案集中在 `apps/web/lib/brand.ts`
- 客户端通过 `useLang()` 读 / 切，cookie 持久化
- 默认按浏览器语言（zh-* 走中文，其它走英文），右上角可手动切换

## 文档

- 产品 PRD：`docs/superpowers/specs/2026-06-09-lamp-saas-mvp-design.md`
- Phase 1 开发计划：`docs/superpowers/plans/2026-06-09-lamp-saas-mvp-phase1.md`
