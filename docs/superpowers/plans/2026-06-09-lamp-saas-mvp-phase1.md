# 灯境 AI Phase 1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 PRD v3 落地灯境 AI MVP：首页 + 生成工作台 + 我的作品 + 额度页 + 登录 + 第一阶段极简后台，支持灯具图上传、模板选择、AI 生成 4 张场景图、失败退款、人工付费留资、管理员加额度。

**Architecture:** Next.js 14 App Router 全栈一体化。前后端同仓库，后端用 Route Handlers，数据库用 PostgreSQL + Prisma，对象存储用阿里云 OSS（或兼容的 Cloudflare R2），AI 生成走可替换的 `IGenerationProvider` 抽象，异步任务用 Next.js 自带的 Route Handler + 后台轮询/Webhook 推进。视觉直接用现有草图 002（首页）和 001（工作台）。

**Tech Stack:** Next.js 14 (App Router) + TypeScript + Tailwind CSS + Prisma + PostgreSQL + NextAuth (邮箱/手机验证码) + OSS/R2 + Vitest + Playwright。

---

## 0. 概要时间线（建议节奏）

> 节奏适用于 1 名开发者全职。如果是兼职/外包，按 1.5–2 倍折算。

| 阶段 | 工作日 | 产出 |
|---|---|---|
| **Week 1** | 1–5 天 | 项目脚手架、Tailwind、Prisma schema、数据库迁移、CI 通过、首页可访问 |
| **Week 2** | 6–10 天 | 登录（验证码）、上传（OSS 直传）、模板列表、工作台 UI 静态版 |
| **Week 3** | 11–15 天 | 生成任务事务、AI Provider 抽象、生成中状态机、失败退款 |
| **Week 4** | 16–20 天 | 我的作品页、额度页、ContactLead、模板不匹配提醒、第一阶段后台 |
| **Week 5** | 21–25 天 | 真实素材验收（≥20 张）、端到端测试、部署上线、灰度 10 个种子用户 |

**Phase 1 完成判定（DoD）：**

- 新用户能不登录进首页 → 进工作台 → 上传 → 选模板/风格/比例 → 点击生成 → 弹登录领 20 次额度 → 看到 4 张图 → 下载
- 失败必退款，重复点击不重复扣额度
- 至少 1 个 Provider 真实跑通（即梦/通义万相/Replicate 任选）
- 管理员能：看用户、看任务、手动加额度
- ≥20 张真实灯具图通过质量 checklist 抽检

---

## 1. 文件结构（一次性确定，后面任务都基于此）

```text
lamp-saas-mvp/
├── apps/web/                          # Next.js 主应用
│   ├── app/
│   │   ├── (marketing)/page.tsx       # 首页（草图 002）
│   │   ├── (marketing)/cases/page.tsx # 案例页（占位即可）
│   │   ├── workspace/page.tsx         # 生成工作台（草图 001）
│   │   ├── workspace/jobs/[id]/page.tsx # 生成中/结果页
│   │   ├── my/page.tsx                # 我的作品
│   │   ├── credits/page.tsx           # 额度页
│   │   ├── admin/users/page.tsx       # 后台-用户
│   │   ├── admin/jobs/page.tsx        # 后台-任务
│   │   └── api/                       # Route Handlers
│   │       ├── auth/send-code/route.ts
│   │       ├── auth/verify-code/route.ts
│   │       ├── me/route.ts
│   │       ├── uploads/sign/route.ts
│   │       ├── uploads/route.ts
│   │       ├── templates/route.ts
│   │       ├── generation/precheck/route.ts
│   │       ├── generation/jobs/route.ts
│   │       ├── generation/jobs/[id]/route.ts
│   │       ├── generation/jobs/[id]/retry/route.ts
│   │       ├── output-images/[id]/download/route.ts
│   │       ├── my/jobs/route.ts
│   │       ├── contact-leads/route.ts
│   │       └── admin/...
│   ├── components/
│   │   ├── home/Hero.tsx
│   │   ├── home/Stats.tsx
│   │   ├── workspace/Sidebar.tsx
│   │   ├── workspace/UploadZone.tsx
│   │   ├── workspace/TemplatePicker.tsx
│   │   ├── workspace/PlatformStyleToggle.tsx
│   │   ├── workspace/AspectRatioToggle.tsx
│   │   ├── workspace/GenerateButton.tsx
│   │   ├── workspace/MismatchWarning.tsx
│   │   ├── workspace/ProgressOverlay.tsx
│   │   ├── workspace/ResultGrid.tsx
│   │   ├── auth/LoginModal.tsx
│   │   ├── credits/QuotaExhaustedModal.tsx
│   │   └── ui/* (Button, Card, Modal …)
│   ├── lib/
│   │   ├── db.ts                      # Prisma client
│   │   ├── auth.ts                    # NextAuth 配置
│   │   ├── storage.ts                 # OSS/R2 上传封装
│   │   ├── credits.ts                 # 扣减/退款事务
│   │   ├── providers/
│   │   │   ├── types.ts               # IGenerationProvider
│   │   │   ├── mock.ts                # 本地开发假 Provider
│   │   │   └── replicate.ts           # 真实 Provider 实现
│   │   └── lamp-detect.ts             # 灯具类型轻量识别
│   └── tests/
│       ├── unit/*.test.ts
│       └── e2e/*.spec.ts
├── prisma/
│   ├── schema.prisma
│   └── seed.ts                        # 种子 6 个 MVP 模板
├── test-assets/lamps/                 # 真实素材（≥20 张）
│   ├── pendant/{white,transparent,product,factory}/
│   ├── wall/{...}
│   ├── table/{...}
│   └── floor/{...}
├── docs/
│   ├── superpowers/specs/2026-06-09-lamp-saas-mvp-design.md
│   └── superpowers/plans/2026-06-09-lamp-saas-mvp-phase1.md   # 本文件
├── .env.example
├── package.json
└── README.md
```

---

## 2. 任务拆解

### Task 1: 仓库初始化与 CI

**Files:**
- Create: `apps/web/package.json`、`apps/web/tsconfig.json`、`apps/web/next.config.ts`
- Create: `.gitignore`、`.env.example`、`README.md`
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1**：在 `lamp-saas-mvp/` 下执行
  ```bash
  npx create-next-app@14 apps/web --ts --eslint --tailwind --app --src-dir=false --import-alias "@/*"
  ```
- [ ] **Step 2**：写 `.env.example`：
  ```env
  DATABASE_URL=postgresql://lamp:lamp@localhost:5432/lamp
  NEXTAUTH_SECRET=replace-me
  OSS_REGION=oss-cn-shanghai
  OSS_BUCKET=lamp-mvp
  OSS_ACCESS_KEY_ID=
  OSS_ACCESS_KEY_SECRET=
  REPLICATE_API_TOKEN=
  ADMIN_EMAILS=you@example.com
  ```
- [ ] **Step 3**：写 `.github/workflows/ci.yml`，跑 `pnpm install && pnpm -C apps/web typecheck && pnpm -C apps/web test && pnpm -C apps/web build`
- [ ] **Step 4**：`git add . && git commit -m "chore: bootstrap nextjs app"`

**验收：** `pnpm -C apps/web dev` 起得来，访问 `http://localhost:3000` 看到 Next.js 默认页。

---

### Task 2: Prisma schema 与迁移

**Files:**
- Create: `prisma/schema.prisma`、`prisma/seed.ts`、`apps/web/lib/db.ts`

- [ ] **Step 1**：`pnpm -C apps/web add @prisma/client` / `pnpm -C apps/web add -D prisma`
- [ ] **Step 2**：写 `prisma/schema.prisma`，按 PRD v3 第 9 节复制 6 张表（User / UploadedAsset / Template / GenerationJob / OutputImage / CreditTransaction / ContactLead），字段类型见 PRD v3。
- [ ] **Step 3**：`pnpm prisma migrate dev -n init`
- [ ] **Step 4**：写 `prisma/seed.ts`，插入 PRD v3 第 6 节的 6 个 MVP 模板（餐厅长桌吊灯、现代客厅主灯、卧室床头壁灯、沙发旁落地灯、卧室床头柜台灯、酒店大堂吊灯）。
- [ ] **Step 5**：跑 `pnpm prisma db seed`，确认 `Template.count()=6`。
- [ ] **Step 6**：commit `feat(db): prisma schema and seed templates`

**写测试：** `apps/web/tests/unit/db.test.ts`
```ts
import { prisma } from "@/lib/db";
test("seed has 6 MVP templates", async () => {
  expect(await prisma.template.count({ where: { is_active: true } })).toBe(6);
});
```

---

### Task 3: 首页（草图 002 上线版）

**Files:**
- Create: `apps/web/app/(marketing)/page.tsx`、`components/home/Hero.tsx`、`components/home/Stats.tsx`、`components/home/HowItWorks.tsx`

- [ ] **Step 1**：把 `sketches/002-premium-brand/index.html` 的视觉拆成 3 个 React 组件
- [ ] **Step 2**：主标题硬编码 PRD v3 文案：
  > 一张灯具图，生成可直接上架的家居场景图
- [ ] **Step 3**：CTA「开始生成场景图」`<Link href="/workspace">`，「查看案例」`<Link href="/cases">`
- [ ] **Step 4**：写 Playwright `tests/e2e/home.spec.ts`：
  ```ts
  test("home shows main slogan", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("一张灯具图，生成可直接上架的家居场景图")).toBeVisible();
    await page.getByRole("link", { name: "开始生成场景图" }).click();
    await expect(page).toHaveURL(/\/workspace/);
  });
  ```
- [ ] **Step 5**：commit `feat(home): premium hero based on sketch 002`

---

### Task 4: 工作台静态 UI（不登录可访问）

**Files:**
- Create: `app/workspace/page.tsx` 与 `components/workspace/*`

- [ ] **Step 1**：左侧导航严格四项：生成场景图 / 我的作品 / 额度 / 帮助。**不要**“模板市场”。
- [ ] **Step 2**：UploadZone 限制 JPG/PNG/WEBP，前端校验 `≤ 5MB`，超过给红字。
- [ ] **Step 3**：TemplatePicker 调 `GET /api/templates`（先 mock，下个 task 接真）。
- [ ] **Step 4**：PlatformStyleToggle、AspectRatioToggle 用 Tailwind segmented 控件。
- [ ] **Step 5**：GenerateButton 默认 disabled，直到上传 + 模板 + 风格 + 比例 都选好。
- [ ] **Step 6**：commit `feat(workspace): static UI on sketch 001`

---

### Task 5: 登录（验证码）+ 新用户 grant 20 额度

**Files:**
- Create: `lib/auth.ts`、`app/api/auth/send-code/route.ts`、`app/api/auth/verify-code/route.ts`、`components/auth/LoginModal.tsx`

- [ ] **Step 1**：`send-code` 生成 6 位数，写入 Redis（或 PG 的 `VerificationCode` 表，TTL 5 分钟）。开发环境直接 `console.log` 验证码即可，不接短信网关。
- [ ] **Step 2**：`verify-code` 通过后：
  - `upsert User by email/phone`
  - 若是新用户：`credit_balance = 20` + 写 `CreditTransaction(type=grant, amount=20)`
  - 颁发会话（NextAuth credentials provider 包一层）
- [ ] **Step 3**：LoginModal 由 GenerateButton 触发：未登录 → 弹窗 → 验证后再调用真正的生成接口。
- [ ] **Step 4**：写 unit test：新用户验证码登录后 `credit_balance=20` 且有一条 grant 记录。
- [ ] **Step 5**：commit `feat(auth): code login and 20-credit grant`

---

### Task 6: OSS 直传

**Files:**
- Create: `lib/storage.ts`、`app/api/uploads/sign/route.ts`、`app/api/uploads/route.ts`

- [ ] **Step 1**：`sign` 返回 OSS PostObject 表单签名（前端直传，避开 Next.js body 大小限制）。
- [ ] **Step 2**：前端上传完成后调 `POST /api/uploads`，服务端：
  - 校验 `file_type ∈ {jpg,png,webp}`
  - 用 sharp 读 `width,height`
  - 用启发式（边缘色直方图）推断 `background_type`
  - 写 `UploadedAsset`
- [ ] **Step 3**：返回 `quality_warning`：背景复杂时给 PRD v3 第 11 节的提示文案。
- [ ] **Step 4**：commit `feat(uploads): oss direct upload + asset record`

---

### Task 7: 模板不匹配预检

**Files:**
- Create: `lib/lamp-detect.ts`、`app/api/generation/precheck/route.ts`、`components/workspace/MismatchWarning.tsx`

- [ ] **Step 1**：`lamp-detect.ts` MVP 简化做法：调一次低成本视觉模型（GPT-4o-mini vision 或同类）问一句“这是吊灯/壁灯/台灯/落地灯/吸顶灯里的哪种？”，缓存结果到 `UploadedAsset`。
- [ ] **Step 2**：`precheck` 比对 `template.lamp_type`，不匹配返回 PRD v3 第 6 节模板提醒文案变量。
- [ ] **Step 3**：前端 MismatchWarning 显示 “继续使用 / 重新选择模板” 两个按钮，**不阻止生成**。
- [ ] **Step 4**：commit `feat(precheck): lamp-template mismatch hint`

---

### Task 8: 生成任务（事务 + Provider + 进度）

**Files:**
- Create: `lib/credits.ts`、`lib/providers/types.ts`、`lib/providers/mock.ts`、`lib/providers/replicate.ts`、`app/api/generation/jobs/route.ts`、`app/api/generation/jobs/[id]/route.ts`、`components/workspace/ProgressOverlay.tsx`

- [ ] **Step 1**：`IGenerationProvider`：
  ```ts
  export interface IGenerationProvider {
    submit(input: GenInput): Promise<{ providerJobId: string }>;
    poll(providerJobId: string): Promise<GenStatus>; // returns stage_hint + urls
  }
  ```
- [ ] **Step 2**：`POST /api/generation/jobs` 在事务里：
  1. `SELECT ... FOR UPDATE` 拿用户余额
  2. 余额 < 4 → 返回 `409 INSUFFICIENT_CREDITS`
  3. 创建 `GenerationJob(status=created, credit_cost=4)`
  4. `credit_balance -= 4` + `CreditTransaction(consume, -4, related_job_id)`
  5. `provider.submit()`，把 `providerJobId` 存到 `GenerationJob.provider_job_id`
  6. 状态改 `generating`
- [ ] **Step 3**：`Idempotency-Key` header 防止重复点击重复扣费。
- [ ] **Step 4**：`GET /api/generation/jobs/[id]` 返回 `{ status, stage_hint, output_images, failure_reason }`，前端每 2 秒轮询。
- [ ] **Step 5**：阶段文案严格用 PRD v3 第 5.2.8 的 5 句中文：
  - 正在分析灯具结构
  - 正在匹配家居场景
  - 正在生成家居场景图
  - 正在优化光影效果
  - 正在准备预览图
- [ ] **Step 6**：失败：`status=failed` + 写 `CreditTransaction(refund, +4)` + `credit_balance += 4`，前端显示原因 + “换张图重试”。
- [ ] **Step 7**：写 unit + e2e 测试覆盖：成功扣 4、失败退 4、重复 idempotency-key 不重复扣。
- [ ] **Step 8**：commit `feat(gen): job lifecycle with credits transaction`

---

### Task 9: 我的作品

**Files:**
- Create: `app/api/my/jobs/route.ts`、`app/my/page.tsx`、`components/my/JobCard.tsx`

- [ ] **Step 1**：API 按 `created_at desc` 分页，include 模板名、原图缩略图、4 张 OutputImage。
- [ ] **Step 2**：每张 OutputImage 配“下载”按钮，点击调 `POST /api/output-images/:id/download` 标记下载并触发浏览器下载。
- [ ] **Step 3**：commit `feat(my): job history page with download tracking`

---

### Task 10: 额度页 + ContactLead

**Files:**
- Create: `app/credits/page.tsx`、`app/api/contact-leads/route.ts`、`components/credits/QuotaExhaustedModal.tsx`

- [ ] **Step 1**：额度页显示 `credit_balance` + 最近 50 条 `CreditTransaction`。
- [ ] **Step 2**：套餐展示按 PRD v3 第 8 节硬编码：免费 20 / 基础 100 / 商业 500 / 工厂定制。每个 CTA 点击都打 `POST /api/contact-leads`，`source` 区分页面，`contact_type` 区分微信/客服/批量。
- [ ] **Step 3**：QuotaExhaustedModal 在 `409 INSUFFICIENT_CREDITS` 时弹出，三个按钮：添加微信 / 联系客服 / 填写批量需求。提交也打 `contact-leads`。
- [ ] **Step 4**：commit `feat(credits): quota page and lead capture`

---

### Task 11: 第一阶段后台（仅 3 件事）

**Files:**
- Create: `app/admin/layout.tsx`（管理员邮箱白名单中间件）、`app/admin/users/page.tsx`、`app/admin/jobs/page.tsx`、`app/api/admin/users/route.ts`、`app/api/admin/jobs/route.ts`、`app/api/admin/users/[id]/credits/route.ts`

- [ ] **Step 1**：`ADMIN_EMAILS` 环境变量是逗号分隔白名单，layout 里 session.user.email 不在白名单 → 404。
- [ ] **Step 2**：用户页：分页表格（邮箱/手机/余额/注册时间）+ “加额度”按钮。
- [ ] **Step 3**：任务页：默认筛选 `status=failed`，显示 user、模板、失败原因、时间。
- [ ] **Step 4**：加额度：表单（数量、备注）→ `POST /api/admin/users/:id/credits` → 事务里写 `CreditTransaction(manual_adjustment)` + `credit_balance += amount`。
- [ ] **Step 5**：**不做** Phase 1.5：手动重试、原图/输出图查看、退款、失败标记。
- [ ] **Step 6**：commit `feat(admin): minimal phase-1 admin`

---

### Task 12: 真实素材 + 端到端验收

**Files:**
- Create: `test-assets/lamps/{pendant,wall,table,floor}/{white,transparent,product,factory}/*.jpg`
- Create: `tests/e2e/full-flow.spec.ts`

- [ ] **Step 1**：把 PRD v3 第 13.3 节的 ≥20 张真实灯具图分类放进 `test-assets/lamps/`，每类 5 张，覆盖白底/透明 PNG/普通商品图/复杂工厂图。
- [ ] **Step 2**：跑端到端 Playwright：首页 → 工作台 → 上传白底吊灯 → 选「餐厅长桌吊灯」→ 国内电商 → 4:5 → 点击生成 → 触发登录 → 验证码登录（开发环境从 console 拿） → 等待 `completed` → 看到 4 张图 → 下载 1 张 → 我的作品里能看到。
- [ ] **Step 3**：人工抽检：按 PRD v3 第 13.3 节 9 项 checklist 评每张输出。
- [ ] **Step 4**：commit `test(e2e): real lamp assets and full flow`

---

### Task 13: 部署 + 灰度

**Files:**
- Create: `vercel.json` 或 Sealos / Docker 配置
- Update: `README.md` 部署章节

- [ ] **Step 1**：选一处托管（推荐 Vercel + 国内 CDN/Sealos 二选一），配置环境变量。
- [ ] **Step 2**：Prisma migrate deploy。
- [ ] **Step 3**：种子 6 个模板。
- [ ] **Step 4**：邀请 10 个种子卖家用户灰度，开启日志。
- [ ] **Step 5**：commit + tag `v0.1.0-mvp`

---

## 3. 自检 checklist（计划 vs PRD v3）

| PRD v3 章节 | 对应 Task | 状态 |
|---|---|---|
| §3 量化指标 | Task 13 上线后埋点 | ✅ |
| §4 用户流程（登录后置） | Task 5 + 8 | ✅ |
| §5.1 首页 | Task 3 | ✅ |
| §5.2 工作台 + 生成中状态 | Task 4 + 8 | ✅ |
| §5.3 我的作品 | Task 9 | ✅ |
| §5.4 额度页 | Task 10 | ✅ |
| §5.5 登录注册 | Task 5 | ✅ |
| §5.6 极简后台（Phase 1） | Task 11 | ✅ |
| §6 模板体系 + 不匹配提醒 | Task 2 + 7 | ✅ |
| §7 灯具质量标准 | Task 8 prompt + Task 12 抽检 | ✅ |
| §8 额度与商业化 + 人工付费闭环 | Task 5 + 10 | ✅ |
| §9 数据结构（含 ContactLead） | Task 2 | ✅ |
| §10 AI 接口可替换 | Task 8 | ✅ |
| §11 错误处理 | Task 6 + 8 + 10 | ✅ |
| §12 后台 Phase 1 三件事 | Task 11 | ✅ |
| §13 测试 + 20 张真实素材 | Task 12 | ✅ |

**明确不在 Phase 1**：自动支付、团队协作、批量 SKU、多模型选择、视频生成、详情页长图、图片精修编辑器、A/B 测试、复杂权限、模板市场页、手动重试/原图查看/退款/失败标记（Phase 1.5）。
