# 视频输入方式核对：支持矩阵与成本采集准备

日期：2026-10-14
执行依据：`docs/deployment/2026-10-14-workbuddy-video-input-alignment.md`（第 5 节）
配套证据：`docs/research/2026-10-14-token-pricing-preparation.md`、
`hypit/packages/hypit-provider-runninghub-product-v6/provider.js`
提交：本轮只增 `apps/web/scripts/video-input-dryrun.ts` 与本文档

> **本轮没有新增任何真实付费任务。** 免费检查只能证明"请求会长什么样"，**不能**证明生成质量。

---

## 0. 先把上一步的动作撤销了（本文件的前提变更）

上一份清单要求"第一批 = 8 次首尾生图"，我按此在 14:30 把 v3 恢复为 `draft` 并打开了两个开关。
本文件撤销该默认安排，因此**已全部回退**：

| 项 | 现状（实测） |
|---|---|
| `VIDEO_WORKER_PAUSED` / `VIDEO_PAID_GENERATION_ENABLED` | `true` / `false`（容器内 `printenv` 实测，日志恢复 `paused; will not claim jobs`） |
| v3 `cmv6upax0002sn70jxu0ovl93` | `draft(rev3)` → **`attention(rev4)`**（CAS，`UPDATE 1`） |
| 三条任务 | 全部 `attention`，`imageCalls=0`、`segments=[]` |
| `queued` 队列 | **0** |
| 本轮付费调用 | **0** |

## 1. ⚠️ 必须先分清：工作区 ≠ 生产

| | 工作区（本地） | 生产镜像 |
|---|---|---|
| `direct_references` 模式 | **已实现**（Codex 未提交改动：25 个已改文件 + `reference-inputs.ts`、`video-reference-inputs.test.ts` 两个新文件） | **没有**（部署 HEAD `121ff5c`；容器内 `ls lib/video/reference-inputs.ts` 不存在） |
| 线上实际行为 | — | 仍是 **legacy 固定首尾图**路径 |
| 是否进 git | ❌ **未提交、未推送** | 构建自 `121ff5c` |

⇒ 下文"工作区列"描述的是**已写好但未上线**的能力；"生产列"是本轮线上真实行为。
**本文件没有提交、没有部署这些改动。**

## 2. 5.1 支持矩阵

### 2.1 路径 A：复刻视频（参考视频 + 参考图 + 指令）

| 层 | 工作区 | 生产镜像 | 证据 |
|---|---|---|---|
| Expert 可表达 | `create_video_job`：`source_asset_id`+`product_asset_id` 必填；`generation_mode`（`direct_references`/`legacy_frames`）；`reference_assets` **恰好 2 条**，每条 `asset_id`+`role`(∈`character`/`scene`/`product_detail`)+`label`(1–80 字符) | 同左但**无** `generation_mode`/`reference_assets` | `lib/mcp-tools.ts:19` |
| API 可接收 | 两个 id 必填；`reference_assets` 必须 2 条（否则报"需要产品图及另外两张"） | 只认两个 id | `app/api/v1/video-jobs/route.ts:15-17`；`lib/video/reference-inputs.ts:26-41` |
| 服务端保存的角色 | `VideoJob` 仅 `source_asset_id`/`product_asset_id` 两列；另 2 张的 `{assetId,role,label,key,sha256}` 全在 `data Json` | 同左 | `prisma/schema.prisma:352-374`；`lib/video/types.ts:8-15` |
| 适配器实际端口 | 恰好 **3 张 `referenceImage` + 1 条 `referenceVideo`**；`firstFrame`/`lastFrame`/`referenceAudio` **非空即 unsupported** | 同左（外部包，未变） | `provider.js:76-83`；`lib/video/hypit-runner.ts:154` |

**结论：复刻路径可用，但有三条硬约束**

1. **恰好 3 张图**是适配器硬约束（`provider.js:78`）。产品图被强制占第 1 个槽位
   （`reference-inputs.ts:33`、`processor.ts:151`）⇒ 只剩 2 个槽。
2. **没有"宝宝/妈妈"专用槽位**：只能 `role:"character"` + `label` 文本区分。
   ⇒ "产品 + 宝宝 + 妈妈"正好占满 3 张，**此时没有场景槽位**。
3. 若确实需要 4 个角色（产品+宝宝+妈妈+场景），**当前适配器做不到**，属缺适配器能力，
   需另一条工作流——不能靠改参数解决。

### 2.2 路径 B：直接参考图生视频（若干参考图 + 指令，无源视频）

| 层 | 现状 | 结论 |
|---|---|---|
| Expert / API | `source_asset_id` **必填** | **缺入口** |
| 适配器 | 强制 `referenceVideo` **恰好 1 条** | **缺适配器能力** |
| 证据 | `mcp-tools.ts:19`、`route.ts:15-17`、`provider.js:78` | — |

**结论：当前不支持。** 现有"三图一视频"适配器**不能**充当无源视频支持的证明；
需要另找真实模型/工作流合同并单独核对，不能靠省略 `source` 参数声称支持。

### 2.3 专门的首尾帧控制

| 问题 | 结论 |
|---|---|
| 适配器支持首尾帧端口吗 | **不支持**。`provider.js:81-82` 明确把 `firstFrame`/`lastFrame` 判为 unsupported，原因是该工作流未连接独立首尾帧输入 |
| 那当前代码在做什么 | `processor.ts` 的 legacy 分支每段生成 opening/ending 两张图，提交时与产品图一起作为 **3 张普通 `h3:Reference image`**（`processor.ts:185-198`、`hypit-runner.ts:154`）——即**把首尾帧塞进普通图片槽** |
| 历史文件名 `opening_*.png` / `ending_*` 说明 | **是资产命名，不是首尾帧控制端口**（`provider.js` 证据 + 历史提交三图角色为商品/宝宝/妈妈） |

⇒ **"首尾帧控制"与"普通参考图"不能混称**；本适配器上不存在前者。

### 2.4 生成图片是否必需 / 可否复用已有素材

| 模式 | 已有图复用 | 新生图调用 |
|---|---|---|
| `direct_references`（工作区） | ✅ 3 张已有图**直接快照透传**（只做缩放/PNG 归一化与 sha256） | **0 次** |
| `legacy_frames`（生产现状） | 仅产品图复用 | **2 × 段数**（16.3s→8；30s→12） |

## 3. 5.2 最小改动清单

| # | 改动 | 类别 | 说明 |
|---|---|---|---|
| 1 | 把新任务默认模式从 legacy 改为 direct，legacy 仅在明确需要时启用 | 策略（默认值） | 避免"每条视频都先额外生 8/12 张图" |
| 2 | 专家包 `SKILL.md` 与工具 schema 口径同步 | 缺字段透传（文档层） | 该文件仍写"`create_video_job` 没有 baby/mother 槽位"，与工作区新 schema 不一致，会让 Expert 自我限制 |
| 3 | 提交这些改动并部署（当前既未提交也未上线） | 流程 | 本轮**未做**，等指示 |
| 4 | 若要"产品+宝宝+妈妈+场景"4 角色或无源视频，另找适配器/工作流 | 缺适配器能力 | 不是参数问题 |
| 5 | 计费与成本采集按 `token-cost-data` 模板区分"输入图数"与"生图调用数" | 采集口径 | 见第 6 节 |

**明确不建议的做法**（原文要求）：不直接删掉当前必需参数后尝试付费提交。

## 4. 4. 免费验证结果（dry-run）

新增 `apps/web/scripts/video-input-dryrun.ts`，**可证明不触发付费**：不 import 任何 provider /
`image-reference` / runner 提交路径，不 spawn CLI，不 fetch；import 清单只有
`@next/env`、`node:fs/promises`、`node:path`、`lib/video/reference-inputs`、`lib/video/types`
（`--job` 分支才动态 import `lib/db` 做只读 SELECT）。

⚠️ **该脚本刻意留在工作区、不进 git**：它 import 的 `lib/video/reference-inputs.ts` 属于
Codex 的**未提交**改动；单独提交这个脚本会得到一个"引用了不存在文件"的、编译不过的树。
等 `reference-inputs.ts` 一并提交时再把它纳入。

```
npx --no-install tsx scripts/video-input-dryrun.ts --demo-direct
npx --no-install tsx scripts/video-input-dryrun.ts --legacy-demo --seconds 16.3
npx --no-install tsx scripts/video-input-dryrun.ts --legacy-demo --seconds 30
```

实测输出（`paid_calls_executed: 0`）：

| 场景 | 输入图数 | 新生图调用 | 图片角色 | 适配器端口 |
|---|---:|---:|---|---|
| direct：3 张已有图 | **3** | **0** | `product:产品`、`character:宝宝`、`character:妈妈` | 3 图 + 1 视频 |
| legacy：16.3 秒 4 段 | 1 | **8** | `product`、`opening`、`ending` | 3 图 + 1 视频 |
| legacy：30 秒 6 段 | 1 | **12** | 同上 | 3 图 + 1 视频 |

端口契约断言（直接读 `hypit-runner.ts` 源码计数）：
`<h3:Reference image=>` **3** 处、`<h3:Reference video=>` **1** 处、
`firstFrame`/`lastFrame` 元素 **0** 处。

⇒ **已有三张图直接进入视频请求时，不会平白多出三次生图调用**（direct 模式实测 0）。
legacy 的 8/12 次是**该实现选择的行为**，不是产品必需。

## 5. 5.3 下一次真实项目的方案（等用户指定，暂不执行）

### 素材清单（模板）

- 源视频：1 条（4–30 秒、9:16、≤150MB）——**仅复刻路径需要**
- 参考图：**总计恰好 3 张**（第 1 张为产品图；另 2 张按 `role` + `label` 指定：人物身份 / 场景 / 产品细节）
- 每条都要注明：**用户新提供** 还是 **从既有资产复用**（按资产 ID 去重，复用不重复计历史生成费）

### 生成清单（分三类记，不按槽位推算）

| 类别 | 本次预期 |
|---|---|
| 已有图片被传入 | 3（direct 模式） |
| 新生图调用 | **0**（除非素材确缺） |
| 图像编辑调用 | 0 |
| 首尾用途子集 | 0（仅当真实需求采用首尾策略时才记） |

### 需要补图时的处理

单独审核该阶段（费用、交付、取消规则），不与渲染合并；**不再默认每段补两张图**。

### 预算与验收

- 预算：按上面三类调用分别给上限；视频按段数（每段仍 4/5 秒）与 `per_segment_coins` 报价，
  `render` 需 `max_coins ≥ 报价` 才放行。**本轮不给固定"每段 2 张"报价。**
- 验收：产品外观、人物一致性、动作/分镜、时长、音轨、下载；`API SUCCESS ≠ 合格交付`。

## 6. Token 成本采集口径（对齐 `token-cost-data` 模板）

- 换算：**100 Token/元** 仍是**待确认建议**，本轮未改充值包、余额或任何计费代码。
- `video_mode` 用 `video_recreation` / `reference_image_to_video`；`reference_strategy` 记
  `general_reference` / `first_last_control` / `mixed`，**不默认填首尾帧**。
- **输入参考图数量 ≠ 生图 API 调用次数**；复用素材不重复计算历史生成费用。
- 费用空缺标 `unknown`，**不填 0**；预估 RH 币数不得填入实耗。
- 本项目当前已知缺口：`ToolCallLog` 缺实际费用、完整 usage、价格版本与稳定任务归属；
  单靠加几列不足以完成财务对账。

## 7. 未验证项（不与"通过"混称）

| 项 | 状态 |
|---|---|
| 真实参考帧生成 / H3 渲染 | **未测** |
| 人物/产品一致性、动作、时长、音频、成片质量 | **未测**（免费检查不能替代） |
| 无源视频（直接参考图生视频） | **无可用工作流证据** |
| direct 模式在生产运行 | 未部署，**线上仍是 legacy** |
| OpenLux 分组倍率、RH 账号实际扣费 | 未核对 |
| 首尾帧专用控制 | 本适配器**不支持**（有程序证据） |
