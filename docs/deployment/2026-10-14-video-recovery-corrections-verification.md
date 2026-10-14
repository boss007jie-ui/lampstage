# 视频功能补修：验收报告（第二轮）

日期：2026-10-14
执行依据：`docs/deployment/2026-10-14-workbuddy-next-actions.md`（6 项补修）
上游依据：`docs/deployment/2026-10-14-runninghub-key-update-verification.md`、`2026-10-14-video-worker-recovery-review.md`
提交：`0d02237`（补修 1–6）、`121ff5c`（只读接口凭据格式修正）
上一轮：`048063f`（下载修复）、`d6e483c`（控制/保护/时长/预检）

> **本轮不消耗任何生成积分。** 未调用 prepare/render、H3 build、runtime up，未启用本地替代通道。
> Key 沿用 Codex 已更新并生效的值，**未再次索要，也未用任何旧备份覆盖 `.env.prod`**。

---

## 0. 三种状态，分开陈述

| 状态 | 结论 |
|---|---|
| **代码修复** | ✅ 通过（67 例测试 + Linux 容器内实测，详见第 3 节） |
| **只读上游接入** | ✅ 通过（账户查询与工作流读取均 HTTP 200 / 业务码 0，退出码 0） |
| **真实生成** | ⛔ **未测**（参考帧与 H3 渲染均未执行，等待用户确认任务与预算） |

---

## 1. 补修 1：参考图真正发请求前的复核

- provider 新增 `beforeSend`，由 `openlux-images` 在**参考图异步预处理完成之后、发出 HTTP POST 之前**
  await；`generateReference` **自身**强制检查视频付费开关（新增可选 `env` 仅用于测试），
  不再依赖调用方传可选回调。
- 普通图片通道行为不变（`beforeSend`/`signal` 均为可选）。

| 断言 | 结果 |
|---|---|
| 预处理完成、闸门失败 ⇒ **一个字节都没发出去** | ✅（注入 fetch，`sent.length === 0`；且 `referencesRead === 1` 证明闸门确实在预处理之后） |
| 正样本：闸门通过 ⇒ 真的发出一次 | ✅（`sent.length === 1`）——证明那个 0 不是"spy 没接上"的假绿灯 |
| 开关关闭且**不传任何回调** | ✅ 被 `generateReference` 自身拦下，provider 0 次 |
| 预处理期间租约失效（延迟 30ms 后抛错） | ✅ provider 0 次 |
| 租约丢失传导到取消 | ✅ `leaseController.abort()` 使 job 级信号取消，穿透到 HTTP 与结果下载 |

## 2. 补修 2：结果不明时停止领取后续任务

- `processVideoJob` 返回 `"safe" | "needs_review"`：终态未落库、终态为 attention、租约丢失、
  处理过程抛错 —— 四者均为 `needs_review`。
- 循环决策抽成 `lib/video/worker-loop.ts`，使"A 结果不明时 B 的领取次数为 0"**可被测试证明**。

| 场景 | 断言 |
|---|---|
| 租约丢失（A） | halted=true，`claim` 只调用 1 次 ⇒ **B 从未被领取** |
| 终态保存失败 | 同上 |
| 后置状态查询抛错 | 视为 unknown ⇒ halted，B 未被领取 |
| 正样本：A 正常结束 | halted=false，B 被正常领取并处理 |

**不把"库里存在历史 attention"当永久全局锁**：判定只看本轮处理结果，不查全表。
本轮三条历史任务已隔离为 attention，未自动回队。

## 3. 补修 3–4：下载边界与 FFmpeg 收尾

- render 分支产品图：`getObjectBytes(url, { signal, timeoutMs: 30000, maxBytes: VIDEO_MAX_BYTES })`。
- `getObjectBytes` 的 `maxBytes` 按**实际字节**累积判定，覆盖 HTTP / COS / 本地文件三个分支
  （本地分支另加 `stat` 预检），**不只信 Content-Length**。
- `run()` 取消/超时后**有界等待子进程真正退出**，2 秒后强杀再 reject；
  不再 `kill()` 后立即宣告结束。

| 用例 | 结果 |
|---|---|
| 真实**写入阶段**失败（注入写入流） | ✅ 源流被销毁、临时文件清理、既有目标未被覆盖 |
| 目标不可达（mkdir 失败，原用例保留并正名） | ✅ 有界失败、原文件不变 |
| 取消后等待下界（忽略 SIGTERM 的子进程） | 见第 4 节 Linux 执行结果 |

## 4. 补修 5：只读验收脚本

修正三处（其中一处是我上一版的错误）：
1. 补 `Authorization: Bearer`。
2. **按 `data.prompt` 解析**（它是 JSON 字符串），节点字段取 `graph[nodeId].inputs` ——
   上一版把 `data` 当节点字典，且 mock 只有一个模型节点就报"读取成功"。
3. 空图 / 非 JSON / 无 inputs **一律判失败**，自动验收失败返回**非零退出码**。

⚠️ **中途的一次过度修正（已纠正并留证）**：为了补 Bearer 头，我把 body 里的 `apiKey` 去掉了，
接口随即返回 `code 1601 / 301 param apiKey is required`。说明该接口**两处都要给凭据**：

| 组合 | 结果 |
|---|---|
| 只有 Bearer、无 body apiKey | ❌ `param apiKey is required` |
| 只有 body apiKey、无 Bearer | ❌ 鉴权失败 |
| **两者都给** | ✅ `accountStatus` 200/code 0；`getJsonApiFormat` 200/code 0 |

## 5. 测试与构建

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 通过 |
| `video:test`（本地 Windows） | **67 例：65 pass / 2 skipped / 0 fail**；2 条 skip 为需显式开启的媒体用例 |
| **容器内 `RUN_VIDEO_MEDIA_TESTS=1`（Linux）** | **50 例：50 pass / 0 fail / 0 skipped，退出码 0** |
| 其中媒体回归 | ✅ `local synthetic media: 16.3s and 30s sources keep the full tail with and without audio`（16.3/30 秒 × 有/无音频四组，含片尾标记） |
| 其中取消等待 | ✅ `a cancelled media child is waited for (bounded), not killed and abandoned` |
| 服务器构建 | 由 `redeploy.sh` 在 Linux 容器内完成（本地 `next build` 被沙箱拦在 `.next/trace`，非代码问题） |

⚠️ **两处数量的差异要说明，别当成矛盾**：容器内是 50 例、本地是 67 例，差 17 例是
仓库级的 `scripts/tests/video-runner.test.ts` —— 该文件不在应用镜像的构建上下文里（路径在 `apps/web` 之外），
所以它在本地跑、不在容器里跑。**必需的媒体用例在 Linux 上确实执行且 0 跳过**，
这正是要证明的一点。

## 6. 部署

| 项 | 值 |
|---|---|
| 提交 | `0d02237`、`121ff5c`（已推送 `d6e483c..121ff5c`） |
| 镜像 | `lampstage-web:latest` = **`42a89fe32f3b`**；部署时自动把上一版打为 `rollback-527d27b519aa` |
| 开关（新容器实测） | `VIDEO_WORKER_PAUSED=true`、`VIDEO_PAID_GENERATION_ENABLED=false` |
| worker 日志 | `Video worker paused; will not claim jobs.` |
| `/api/v1/health` | HTTP 200，ready |
| 页面 | `/`、`/developers`、`/help`、`/account` 均 200 |
| `POST /api/debug/email` | 404（关停项未回退） |
| capabilities | `video.replicate` = **maintenance**（带 4–30 limits）；`image.generate` = **available** |

## 7. 只读上游核对（部署后实测，退出码 0）

```
accountStatus      → HTTP 200, code 0
getJsonApiFormat   → HTTP 200, code 0
data.prompt        → 字符串，解析后 45 个节点 / 45 个带 inputs
模型字段            → 含 minimax_h3_ref2va_pruned_int8_convrot.safetensors（与节点 1 的 unet_name 一致）
generation_ok      → null（本脚本永不做真实生成）
exit code          → 0
```

**辅助修正**：account sidecar 的 `packageRoot` 原为失效的 `/repo/apps/web/vendor/hypit`，
已改为 `/app/apps/web/vendor/hypit`（备份 `.account.json.bak.20261014-141904`），
复核 `matches_env: true`。该项原被 `VIDEO_HYPIT_PACKAGE_ROOT` 遮蔽，**不是 Key 故障原因**。

## 8. 备份与回滚

- `.env.prod` 备份：`/srv/lampstage/.env.prod.bak.20261014-114220`、
  `/srv/lampstage/.env.prod.bak.20261014-161*`（**只复制，未覆盖任何内容**）
- 数据库备份：`lampstage-20261014-114220.dump/.sql`（已上传 COS `db-backups/`）
- 任务释放前快照：`/srv/lampstage/backups/video-recovery-20261014-114220/`
- sidecar 备份：`account01.runtime.json.account.json.bak.20261014-141904`
- 旧镜像保留 rollback tag：`rollback-33cbf609f3d0`、`rollback-7b149d9838ad`、`rollback-527d27b519aa`
- **回滚优先回滚代码/镜像，保留已生效的新 Key**；若回滚到不认识维护开关的旧版 worker，
  **必须保持该 worker 停止**。

## 9. 后续：专家功能测试方案与报价（**等用户确认，暂不执行**）

### 第一批：参考帧

- 对象：`cmv6upax0002sn70jxu0ovl93`（16.3 秒、4 段）+ 产品图 `cmv6p9pqd000jpg0jafhd3ho0`
- 计划调用：**8 次参考帧生成**（4 段 × 首尾各 1）
- 费用口径：参考帧走图片模型；**其真实成本区间仍受 OpenLux 分组倍率影响（¥0.096–0.889/张，差 9 倍）**，
  该倍率尚未落实，因此下面是区间而非确定值：**约 ¥0.8–7.1（8 张）**
- 需要用户确认：① 恢复哪一个任务 ② 8 次调用的预算上限 ③ 是否一次性覆盖这批（不需要逐张确认）

### 第二批：视频渲染

- 计划调用：**4 段**（每段仍为上游 4/5 秒，非整段 16.3 秒）
- 系统报价字段：`per_segment_coins = VIDEO_H3_SEGMENT_QUOTE_COINS`（当前为**保守报价、不是成本**）
  ⇒ 4 段合计为其 4 倍；`render` 需要 `max_coins ≥ 报价` 才放行
- 成本参考（价卡文档）：3 段/15 秒约 **¥2.69–3.56**；16.3 秒为 4 段，按其比例上浮
- 完成后检查：人物/产品一致性、动作、时长、声音、下载

### 需要一并决策的

- 视频链路**仍不扣平台灯币**，`VIDEO_JOB_LIMIT=10` ⇒ 单账号理论可免费跑满 10 条。
  开放真实生成前建议一并定口径（本轮未改造计费，不混入本次补修）。

## 10. 交付给 Codex 复核的三条结论

1. **代码修复通过**：67 例（含 Linux 容器内媒体回归）、类型检查通过、镜像与开关已实测。
2. **只读接入通过**：账户与工作流均 code 0、45 节点解析成功、退出码 0；真实生成未测。
3. **真实生成未测**：参考帧与 H3 渲染未执行，等待用户确认任务与预算。
