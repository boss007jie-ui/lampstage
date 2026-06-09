# 灯境 AI — 灯具电商场景图 SaaS

为灯具卖家把普通商品图转成可直接上架的家居场景电商图。

## 技术栈

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Prisma + PostgreSQL（Supabase 免费层）
- Nano Banana 图像生成 via yunwu.ai
- 阿里云 OSS 或 Cloudflare R2 用于对象存储

## 本地启动

```bash
cd apps/web
cp ../../.env.example .env.local
# 把 .env.local 里的密钥填好
npm install
npm run dev
```

访问 http://localhost:3000

## 文档

- 产品 PRD：`docs/superpowers/specs/2026-06-09-lamp-saas-mvp-design.md`
- Phase 1 开发计划：`docs/superpowers/plans/2026-06-09-lamp-saas-mvp-phase1.md`
- 视觉草图：`sketches/`

## 仓库结构

```
lamp-saas-mvp/
├── apps/web/          # Next.js 应用（前端 + 后端 API）
├── docs/              # PRD、计划、设计文档
├── sketches/          # HTML 视觉草图（首页 002 + 工作台 001）
└── .github/workflows/ # CI
```
