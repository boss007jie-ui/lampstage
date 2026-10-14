# 视频准备恢复：验收报告

日期：2026-10-14
执行依据：`docs/superpowers/plans/2026-10-14-video-worker-recovery-workbuddy.md`
调查底稿：`docs/deployment/2026-10-14-video-prepare-worker-investigation.md`
提交：`048063f`（下载修复）、`d6e483c`（控制/保护/时长/预检）

> **本轮不消耗任何生成积分。** 未调用图片生成、H3 build、prepare/render API、`runtime up`，
> 也未使用本地 H3 通道绕过。真正的参考帧生成与视频渲染**未执行**，等待用户明确授权。

---

## 1. 根因（已纠正我此前的错误归因）

**真因：`await handle.close()` 永不 settle。**

`privateDownloadTo` 用 `fs.open()` 取得 FileHandle，再配
`createWriteStream({ autoClose: false })` + `pipeline()`。**`pipeline` 会正常返回**；
卡住的是紧随其后的 `handle.close()` —— FileHandle-backed 写入流仍持有句柄引用，
而 `autoClose: false` 关掉了自动关闭。

隔离进程实测事件序列（对同一 COS 对象）：

```json
{ "outcome": "handle_close_still_pending", "expectedBytes": 5873730, "actualBytes": 5873730,
  "events": ["source_end", "source_close", "destination_finish", "pipeline_resolved"] }
```

⇒ **`pipeline_resolved` 已经在事件里，问题在它之后。**
我 2026-10-13 夜里的结论"AWS SDK v3 不发 end ⇒ pipeline 永不返回"**是错的**，
已在代码注释与本文中一并改正。当时观察到的"fd 43 未关、CPU 0.1%、`ep_poll`、无外部连接"
都是同一故障的另一面——**"fd 未关"不足以推出"哪个 await 不返回"，中间那一步必须实测事件序列。**

现场表现（为什么难发现）：
- worker 主循环串行等待整个任务，被这个永不返回的 `processJob` 卡死 ⇒ 不再领取任何任务。
- 租约心跳是**独立的 20 秒 interval**，照常续租 ⇒ 任务一直是 `preparing`，
  不会因"业务无进展"自动过期，也不报错、不退出、CPU 近 0。
- 旁证（辅助，不作单独依据）：`Closing file descriptor 43 on garbage collection` / DEP0137。

## 2. 下载：正常与各类失败均有界

新增 `apps/web/lib/video/download-stream.ts`，**明令禁止** FileHandle + `autoClose:false`：

| 用例 | 断言 |
|---|---|
| 旧 FileHandle 写法 | **独立子进程**回归：不会正常跑完（`pipeline` 返回后 close 仍不 settle） |
| 正常下载 | 返回真实字节数，内容一致，无残留 `.part` |
| 未给 Content-Length | 仍有字节上限，正常 EOF 成功 |
| 超限 / 长度不符 / 空流 | reject，**旧目标不被覆盖**，无临时文件残留 |
| 源流中途报错 | 两端关闭，有界返回 |
| 请求在返回 Body 前挂起 | 总超时生效（signal 真到达 opener），有界返回 |
| 磁盘写失败 | 不覆盖已有文件，源流取消 |
| 父 signal 取消 | 真正取消，无后续付费动作 |
| 本地存储分支 | 同样临时文件语义 + 长度校验 + 成功才替换 |

⏱ **一个环境事实**：Windows/Node 22.22.2 上"旧写法无法完成"的失败形态是
**退出码 13 + `unsettled top-level await` 警告**（短命脚本事件循环耗尽），
而不是挂到被 SIGTERM。断言同时接受两种形态——否则这条回归会在本地假失败。

其他落地点：`privateRead`/`privateWrite`/`privateUploadFile` 增加可选 signal + 120s 总超时；
`processor` 下载源片时用数据库 `VideoAsset.size_bytes` 核对落盘长度（不只信 Content-Length）。

## 3. 任务控制：暂停不领取，付费开关关闭时付费调用为 0

新增 `apps/web/lib/video/control.ts`，**fail-closed**：
`VIDEO_WORKER_PAUSED` 只有显式 `"false"` 才放行领取；`VIDEO_PAID_GENERATION_ENABLED`
只有显式 `"true"` 才允许付费。缺失、空、`FALSE`、`0`、`no` 一律视为关闭。

| 断言 | 证明方式 |
|---|---|
| 暂停时不领取 | `shouldClaimJobs()` 全部关闭组合为 false（纯函数，可测） |
| 付费关闭时参考图调用为 0 | spy provider.generate：开关关闭 ⇒ **0 次**；正样本（开关打开）⇒ 1 次 |
| 付费关闭时 H3 不执行 build | 注入假 CLI：开关关闭 ⇒ submitH3 快速失败，**CLI 调用 0 次**（连本地 check/plan 都不做） |
| 上游前置检查延迟完成后仍要拦 | beforeSubmit 延迟 30ms 后抛错 ⇒ provider 仍为 0 次 |
| 租约失效后不得新付费提交 | `paidBoundaryProblem()`：租约过期 / owner 变化 / revision 变化 各自返回具体原因 |

**正样本是刻意加的**：只断言"0 次"可能因为 spy 没接上而假通过——先证明"开关打开时确实会调用"，
那个 0 才有意义。这正是本项目此前踩过的"假绿灯"。

还有两处结构性保证：
- 参考图：**先读帧（免费）→ 复核开关+租约 → 才写付费意图 → 才调用 provider**。
- H3 有两个不同的 intent，**不要混为一谈**（本节初版表述有误，已修正）：
  ① **数据库** `segment.submissionIntentAt` —— 由 `processor` 在调用 `submitH3` **之前**写入并 `save()`；
  ② **本地文件** `hypit-submission-intent.json` —— 由 `submitH3` 在 `check`/`plan` 通过之后写入。
  新增的 `beforeSubmit` 闸门位于 **① 之后、② 之前**，作用是：在真正执行 `build`（付费）前
  复核开关/租约/revision/consent。**它不能也不该声称"在所有意图落库之前"** ——
  ① 是刻意的先行意图，用于保证"网络调用抛错也留下可核对的痕迹"，这条保护被完整保留。
  另外 `submitH3` 最前面还有一道快速失败（开关关闭时连本地 `check`/`plan` 都不跑）。
- 付费结果不明（attention）时，worker **停止领取后续任务**并保留心跳上报待核对状态，
  不会接着花下一个任务的钱。
- **环境变量是进程启动配置，不是远程停止按钮**：改 `.env.prod` 不会打断已运行进程。

## 4. 进展与心跳分离

`VideoJobData` 新增可选 `progress{stageCode,stageStartedAt,lastProgressAt}`（**不加数据库列**）。
阶段：`source_download` / `source_validate` / `product_download` / `segment_extract` /
`reference_generate` / `video_submit` / `video_wait` / `assemble`。
`source_download` 在**下载之前**就落库——否则"卡在下载"这段最该被看见的时间恰好没有记录。

GET job 返回 `progress_updated_at` 与 `stage_code`；旧数据为 `null`，**不编造时间**。
数据库 `updated_at` 每 20 秒被租约心跳刷新，**不能**当业务推进的证据——两者刻意分开。

## 5. 时长：4–30 秒

`VIDEO_MIN_SECONDS = 4` / `VIDEO_MAX_SECONDS = 30` 成为单一来源，贯通媒体校验、分段与能力接口。
上游每段仍固定 **4/5 秒**，长视频**不会**整段交给模型。

| 长度 | 段数 | 计划参考帧 |
|---|---|---|
| 16.3s（本次素材） | **4**（5/5/5/4，末段 trimStart 2.7） | 8 |
| 30s | 6 | 12 |

回归覆盖接受 `[4, 4.01, 5, 5.01, 15, 15.01, 16.3, 29.99, 30]`、
拒绝 `[NaN, Infinity, 0, 3.99, 30.001]`，并含 16.3s 的精确分段期望与 30s 六段断言。
旧的 `segments.length <= 3` 断言按新契约更新为 `<= ceil(30/4)`，
**完整覆盖时间轴的断言没有放宽**。

## 6. 只读工具

- `scripts/video-preflight.ts`：独立 `mkdtemp` 走 下载 → 校验 → 分段 → 抽首尾帧，
  输出计划调用数与 `paid_calls_executed: 0`，结束比对 job `revision/status/imageCalls` 未变。
  **不 import `processVideoJob`**，不碰任何付费入口、不上传任何对象。
- `scripts/video-upstream-check.ts`：只读 RunningHub 核对，**四个层次分开报告**：
  配置存在（`runnerReadiness`）/ 远端只读鉴权 / 工作流读取 / 真实生成（恒为 `null`）。
  不打印密钥、前缀、连接串或签名 URL。

## 7. 测试与构建

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 通过（本地需加 `--incremental false`，否则写 `tsbuildinfo` 被 Security Center 规则拦下） |
| `video:test` | **52 例：51 pass / 1 skipped / 0 fail** |
| 既有 runner 测试 | 已按计划显式注入 `VIDEO_PAID_GENERATION_ENABLED: "true"`，不依赖真实密钥 |
| 本地 `next build` | **被沙箱拦在 `.next/trace`（EPERM）**，非代码问题；真构建在服务器 Linux 容器内完成 |
| 服务器构建 | 见第 8 节 |

## 8. 部署（受控，保持暂停）

### 8.1 提交与镜像

| 项 | 值 |
|---|---|
| 提交 | `048063f`、`d6e483c`（已推送 `d3df837..d6e483c`） |
| 新镜像 | `lampstage-web:latest` = **`7b149d9838ad`** |
| 旧镜像 | 部署时自动打 tag：`lampstage-web:rollback-33cbf609f3d0`（上一版 `latest`），另有更早两个 rollback tag |
| 部署前服务端 HEAD | `d3df837` |

### 8.2 运行开关**在进程里**生效

```
VIDEO_WORKER_PAUSED=true
VIDEO_PAID_GENERATION_ENABLED=false
```

worker 日志：`Video worker paused; will not claim jobs. 视频生成正在维护，暂时不接受新的准备或渲染请求。`
心跳新鲜且 `detail` = 该维护文案 ⇒ **进程活着、但按维护态不领取**。

容器内代码与本次提交一致（`control.ts` 含 `shouldClaimJobs`、`video-preflight.ts` 就位）。
**只改文件不重建容器不会生效**——本次是真正 `up -d` 重建后的实测值。

### 8.3 其余服务未受影响

`/api/v1/health` → ready；`/`、`/developers`、`/help`、`/account` → 200；
`POST /api/debug/email` → 404（关停项未回退）；`image.generate` → `available`（图片通道未被视频开关波及）。

`/api/v1/capabilities` 的 `video.replicate` → **`maintenance`**，带
`limits{min_seconds:4,max_seconds:30,aspect_ratio:9:16,resolution:768P}` 与原因文案，
且响应头 `Cache-Control: no-store`（维护期间不再让客户端读到公共缓存里的 "available"）。

### 8.4 历史队列隔离（只动未付费的两条）

worker 停止后，以带 `status`+`revision` 的 CAS 隔离：

| 任务 | 释放前 | 隔离后 | 说明 |
|---|---|---|---|
| v1 `cmv6pa2qj…` | attention(rev3) | **未改动** | 已 attention，按计划不重写 |
| v2 `cmv6rajjm…` | preparing(rev2) | attention(rev3) | `UPDATE 1`，租约清空 |
| v3 `cmv6upax…` | queued(rev1) | attention(rev2) | `UPDATE 1`，租约清空 |

三条 `data` 均为 `{"version":1,"segments":[],"imageCalls":0}` ⇒ **全程零付费调用**，
按"未付费恢复分支"处理。**不自动回队**：解除暂停也不会自行开始收费。

### 8.5 免费预检（v3、只读、容器内执行）

`docker compose exec -T worker npx --no-install tsx scripts/video-preflight.ts --job cmv6upax0002sn70jxu0ovl93 --read-only`

| 指标 | 实测 |
|---|---|
| 下载 | **650 ms** ⇒ 下载修复生效（旧实现会永远不返回） |
| 时长/比例校验 | 2548 ms ⇒ **16.300 秒被接受**（4–30 秒契约生效） |
| 分段抽取 | 32085 ms，抽出 8 张首尾帧（1.20–1.39 MB / 张） |
| 产品图 | 234 ms，93274 B |
| **段数** | **4**（start 0/5/10/12.3，duration 5/5/5/4，末段 trimStart **2.7**）——与计划预期逐字一致 |
| 计划调用 | 参考图 **8**、视频 **4** |
| **实际付费调用** | **0** |
| 收尾自证 | `preflight_ok: job revision/status/imageCalls unchanged` |

### 8.6 只读上游核对：**失败**（如实记录，不宣称上游可用）

`docker compose exec -T worker npx --no-install tsx scripts/video-upstream-check.ts`

```json
{ "runner_runtime_configured": true, "runner_package_root_configured": true,
  "api_key_configured": true, "workflow_id": "2102537586127491074",
  "http_status": 200, "business_code": 301, "business_message": "user not exist",
  "auth_ok": false, "workflow_read": false, "generation_ok": null }
```

四个层次**分开表述**：

| 层次 | 结果 |
|---|---|
| 配置存在（`runnerReadiness`） | ✅ true —— **只说明配置在，不代表远端可用** |
| 远端只读鉴权 | ❌ **false**（HTTP 200 但业务码 301 `user not exist`） |
| 工作流读取 | ❌ **false**（未取到任何节点/模型字段） |
| 真实生成 | ⛔ 未尝试（恒为 `null`） |

密钥来源一致性核对（只输出布尔，不打印密钥）：
env 变量存在、**无首尾空白、无引号**、长度属长档；
profile 与 account sidecar **都**指向 `{store:"env", key:"RUNNINGHUB_API_KEY_01"}`；
endpoint 数量 1、bindings 正常、provider 包与 CLI 路径均存在。

⇒ **`user not exist` 不是本地配置问题**（键名、空白、引号、路径都已排除），
指向密钥本身在 RunningHub 侧无效/不属于该账号。**需要用户在服务器侧更新这一项**，
不要贴到聊天里；在拿到有效凭据前，不得通过付费 `create` 去"验证"密钥。

**旁注（低严重度，非阻塞）**：account sidecar 的 `packageRoot` 仍是旧路径
`/repo/apps/web/vendor/hypit`（不存在）。`hypit-runner.ts:99` 的取值顺序是
`env.VIDEO_HYPIT_PACKAGE_ROOT || sidecar.packageRoot || DEFAULT`，当前被 env 遮蔽，
因此**今天无害**；但一旦有人清空该 env 变量，就会落到不存在的路径上。
（我第一次核对时误判为"包缺失"，是因为查了 `<root>/<provider>` 而非代码实际检查的
`<root>/packages/<provider>/package.json`——已实测后者为 true。）

## 9. 回滚

- 发布前 `.env.prod` 备份：`/srv/lampstage/.env.prod.bak.20261014-114220`（600，root:root）
- 数据库备份：`lampstage-20261014-114220.dump/.sql`，已上传 COS `db-backups/`
- 任务释放前快照：`/srv/lampstage/backups/video-recovery-20261014-114220/`
- 旧镜像保留 rollback tag（不删 `latest` 之外的任何镜像）
- 回滚时**必须保持 worker 停止/暂停**：旧版 worker 不认识新开关，放开会立刻恢复领取。
- 不执行数据库 reset / 清表 / `compose down -v`；本方案不需要 schema 迁移。

## 10. 本轮未做 / 真实生成前的阻塞与授权

**已经解决并实测的**：下载关闭死锁、有界/可取消下载、暂停与付费开关（容器内实测生效）、
付费边界三处闸门、进展与心跳分离、4–30 秒时长、只读预检与只读上游核对工具、
历史队列隔离、受控部署。

**仍然阻塞真实生成的**（按优先级）：

1. 🔴 **RunningHub account 01 凭据在远端无效**（`code=301 user not exist`）。
   本地键名/空白/引号/路径均已排除，需要用户在服务器侧更新该凭据。**这一条不解决，
   真实参考帧之后的 H3 渲染必然失败。**
2. 🟡 account sidecar 的 `packageRoot` 是旧路径（当前被 env 遮蔽，无害但脆弱）。
3. 🟡 平台灯币扣费未改造：视频链路仍**不扣费**，`VIDEO_JOB_LIMIT=10` ⇒
   单账号理论可免费跑满 10 条 ≈ ¥27–36 真实成本。恢复真实生成前应一并决策。

| 项 | 状态 |
|---|---|
| 真实参考帧生成（v3：8 次调用、4 段） | **未执行，等待用户逐条明确授权** |
| 真实 H3 渲染（4 段） | **未执行，等待用户逐条明确授权** |
| 上游真实生成验证 | **未执行**；只读核对已失败，**不得**当作"上游可用" |
| 人物/产品一致性与成片质量 | 未验证，不作通过声明 |
| `runtime up` / `resumeH3Worker` | 未执行（可能恢复既有执行，不属免费验收） |

**恢复真实生成的前置条件**：① 修复第 1 条凭据；② 用户明确指定恢复**哪一个**任务
（不自动回队）；③ 就 8 次参考帧调用与 4 段渲染预算给出授权。
