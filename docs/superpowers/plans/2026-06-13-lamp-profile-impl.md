# 灯具档案驱动的专业生成 · 实现计划

> 关联 spec: `docs/superpowers/specs/2026-06-13-lamp-profile-design.md`
> 执行模式: 内联执行（作者本人执行，不分发 subagent）
> 估时: 9 小时（4 阶段一口气）

## 阶段 1：数据库 + AI 推断（~3h）

- [ ] 1.1 schema 加字段 `size_class / color_temp / target_audience / size_hint_cm / ai_inferred_at`
- [ ] 1.2 prisma migrate
- [ ] 1.3 新建 `lib/lamp-profile.ts` —— 一次 vision 调用返回结构化 JSON
- [ ] 1.4 新建 `app/api/uploads/[id]/profile/route.ts` —— POST 触发推断 / GET 读档案 / PATCH 改字段
- [ ] 1.5 build 通过 + 提交

## 阶段 2：智能 prompt 拼接（~2h）

- [ ] 2.1 在 `lib/generation.ts` 新增常量 `INDUSTRY_RULES / ROOM_SETS / LIT_PATTERN / AUDIENCE_KEYWORDS`
- [ ] 2.2 改造 `buildPrompt(asset, room, lit)` —— 从档案读维度、注入规范
- [ ] 2.3 新增 `decideThreeShots(asset)` —— 按类型挑 3 房间 + 开关灯
- [ ] 2.4 改造 `createAndRunGenerationJob` —— 不传 sceneKind 时走新路径，3 张图各用不同 prompt
- [ ] 2.5 改 `runGenerationPipeline` 接受 `prompts: string[]` 而不是单个 prompt
- [ ] 2.6 build 通过 + 提交

## 阶段 3：前端 LampProfileCard（~3h）

- [ ] 3.1 新建 `components/workspace/LampProfileCard.tsx`
- [ ] 3.2 改造 `app/workspace/page.tsx` —— 上传后调推断、显示档案卡、Feature Flag 折叠旧 SceneSelector
- [ ] 3.3 加风格冲突警告
- [ ] 3.4 推 `NEW_LAMP_FLOW_ENABLED=*** Vercel
- [ ] 3.5 build 通过 + 提交

## 阶段 4：监控 + 收尾（~1h）

- [ ] 4.1 admin 后台 `/admin` 加"灯具档案"标签页（看推断分布、用户改字段比例）
- [ ] 4.2 关键路径加 console.log（推断耗时、生成耗时、各阶段失败原因）
- [ ] 4.3 部署 + 5 个验收用例跑通
- [ ] 4.4 写「lamp-profile-v1 上线总结」备忘 + 提交

## Feature Flag 上线策略

- 阶段 1+2 部署后端，**对现有用户无感**（旧路径不变）
- 阶段 3 部署前端时，`NEW_LAMP_FLOW_ENABLED=*** false`（默认走旧 SceneSelector）
- 用户（你）打开预览看一眼，没问题 → 改 `=true` 启用新流程
- 1-2 周稳定后删旧 SceneSelector + 高级选项折叠面板
