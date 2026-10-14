# 婴儿服装复刻：线上卡点与人物参考链路核查

核查时间：2026-10-14 14:47–14:49，Asia/Shanghai。

依据：用户提供的[制作与验收记录](<C:/Users/boss0/Desktop/05-项目文件夹/AI Video Platform/run/20261014-kids-pajama-replica/制作与验收记录.md>)、当前仓库代码、生产容器和数据库只读查询、RunningHub 账户及工作流图只读查询。

本轮没有改生产配置、重启服务、改任务状态、上传素材、调用 prepare/render 或生成模型。未修改原制作记录或 Expert 包。

## 结论

当前是两个独立问题：

1. **prepare 返回维护中的直接原因是 web 与 worker 的进程配置不一致。** worker 已开放并在心跳，web 仍加载旧的暂停配置，在入队前拒绝请求。不是此时 worker 下载再次卡死。
2. **指定宝宝/妈妈没有接入是平台全链路映射缺失。** 当前上游工作流确实有三张参考图和一段参考视频输入，但三张图被应用分配给产品、生成首帧、生成尾帧。宝宝和妈妈的图片没有进入这些输入。

当前没有证据表明必须换掉 H3 模型。应先明确需要的参考角色并补 API、任务记录、参考图生成与渲染映射；需要额外槽位时再扩展/另建工作流。现有工作流图能读取、参数可 dry-run，不等于人物一致性效果已通过。

## 1. 维护错误的现场证据

服务器仓库 HEAD：`121ff5c6fef50927a01496f852fb0075dff52f9b`。worker 容器中 `video-upstream-check.ts`、`upstream.ts`、`processor.ts`、`hypit-runner.ts`、`image-reference.ts` 的 SHA-256 均与当前本地文件一致。

| 位置 | VIDEO_WORKER_PAUSED | VIDEO_PAID_GENERATION_ENABLED | 观察结果 |
| --- | --- | --- | --- |
| 磁盘 `.env.prod` | false | true | 配置文件已修改 |
| worker 进程 | false | true | 心跳距查询时约 2 秒，image_ready/video_ready 为 true |
| web 进程 | true | false | 仍使用旧启动环境 |

容器创建时间：web 14:20:14，worker 14:30:09。它们都在运行；只更新配置文件或只重建 worker，不会刷新 web 已加载的环境。

公网 `/api/v1/health` 返回 ready；`/api/v1/capabilities` 的 `video.replicate` 仍返回 maintenance，原因为“视频生成正在维护，暂时不接受新的准备或渲染请求。”。

[prepare 路由](../../apps/web/app/api/v1/video-jobs/[id]/prepare/route.ts) 先执行 `requireVideoWorker()`，之后才将 draft 变成 queued；[维护检查](../../apps/web/lib/video/http.ts) 读取的是调用它的 web 进程配置。`ToolCallLog` 确认 14:33:55 的 `mcp_prepare_video_job` 返回 HTTP 503。此时任务没有进入 worker 队列。

**运维修复方向：** 先明确本次放行的任务与费用范围，再统一 web、worker 和磁盘配置并验证运行中的值。要开放 API，必须刷新 web 进程的环境；仅重启 worker 无法消除这个维护态。全局开放也不等于具备宝宝/妈妈身份控制能力，不能把“解除维护”当作人物复刻已修复。

## 2. 当前任务与素材

14:47:36 只读快照：

| 项目 | 实测 |
| --- | --- |
| v3 任务 | `cmv6upax0002sn70jxu0ovl93`，draft / prepare，revision=3 |
| 最后任务更新 | 14:30:28，“已按用户指定恢复，等待 prepare” |
| 调用与产物 | imageCalls=0，segments=[]，无 renderConsent，无 output |
| v1 / v2 | 均 attention，imageCalls=0、segments=[]、无租约 |
| v3 原片 | `cmv6uoscn002nn70j361cu8r6`，ready，5,873,730 字节，已保存内部 storage_key |
| 三条任务的产品图 | 均引用干净平铺图 `cmv6p9pqd000jpg0jafhd3ho0` |
| 宝宝/妈妈图 | `cmv6oupxj0003pg0jpdtt5jry`、`cmv6r986k0013n70jkonfaujm` 均存在，归属与 v3 相同 |

这里的零调用结论限于这三条视频任务的持久化记录，不等于此前生成妈妈锚点、后期与人工等全项目费用为零。

原片已进入内部存储，后续 worker 不依赖原来的短期托管 URL。不能因 uguu 外链过期再重传同一原片或另建生成任务。原制作表中“同上=手机截图原图”的尝试描述也应与实际产品 asset_id 区分。

## 3. 上游能否接参考图

14:49:31 使用 worker 现有凭据向其所属 RunningHub 服务执行只读查询：

- 账户查询：HTTP 200，业务码 0。
- 工作流读取：HTTP 200，业务码 0，解析得到 45 个节点。
- 工作流 ID：`2102537586127491074`。
- 真实生成：未执行。

此前报告中的 `user not exist` 不能继续当作当前 Key 无效的证据；后续提交 `121ff5c` 修正了只读请求的凭据传递方式，本次读取成功。

当前线上图的真实连接如下：

| 源节点 | 类型 | 模型条件节点 14 的输入 | 应用目前放入的内容 |
| --- | --- | --- | --- |
| 7 | LoadImage | `ref_images.ref_image_0` | 产品图 |
| 8 | LoadImage | `ref_images.ref_image_1` | 生成的首帧图 |
| 9 | LoadImage | `ref_images.ref_image_2` | 生成的尾帧图 |
| 6 | VHS_LoadVideo | `ref_videos.ref_video_0` | 当前片段的原视频 |

条件节点 14 类型为 `MiniMaxH3AudioConditioningT8`。这证实三张图确实接到了模型参考输入，并非仅能上传而图中没有使用。

用户提到本地另一工作流的“4 主体 / 19 人物脸 / 20 产品”不能直接套在此图上：**本图 4 是 VAELoader，19 是 SamplerCustomAdvanced，20 是 MiniMaxH3AVDecodeT8**。不同工作流必须分别核对 ID 和连线。

[当前 RunningHub 适配器](../../apps/web/vendor/hypit/packages/hypit-provider-runninghub-product-v6/provider.js) 第 69–84 行要求恰好三张图、一段视频，拒绝独立 firstFrame/lastFrame 端口；第 94–107 行将三张图按顺序写入 7/8/9。所谓首尾帧目前是**普通参考图的用途约定**，不是模型硬性的起止帧锁定端口。

本地 Hypit 抽象 schema 允许更多图像参考，不等于当前部署的 RunningHub 适配器和工作流已连接更多槽位。不能只增加第四、第五个参数就宣称支持。

## 4. 人物图片在哪些层没有接通

| 层 | 现状 | 缺口 |
| --- | --- | --- |
| MCP 工具合同 | source_asset_id、product_asset_id、title、instructions、preserve_audio | 无可识别的宝宝/妈妈图片参数 |
| API 与任务保存 | VideoJob 只保存 source_asset_id、product_asset_id | 上传后的身份 asset_id 无任务关联，worker 无从读取 |
| prepare | `generateReference` 只接原片帧与产品图 | 人物参考没有进入参考图模型；默认提示还要求保留源片 people |
| render | `submitH3` 顺序传产品/首帧/尾帧及原片段 | 不传宝宝/妈妈图；默认视频提示同样要求保留源人物 |
| 检查记录 | 有任务 ID 与调用计数 | 没有宝宝/妈妈资产到每次生成输入的角色映射记录 |

代码依据：[MCP 合同](../../apps/web/lib/mcp-tools.ts)、[任务创建](../../apps/web/app/api/v1/video-jobs/route.ts)、[数据库模型](../../apps/web/prisma/schema.prisma)、[参考图生成](../../apps/web/lib/video/image-reference.ts)、[H3 调用](../../apps/web/lib/video/hypit-runner.ts)。

因此不只是在 Expert 中加两行描述就能修复。`instructions` 在本地实现中确实被拼进参考图和视频提示，不能称“代码中不知道是否传文字”；但文字不是用户指定身份图片，出图效果也尚无实测。

本地 MCP 声明没有看到用户转述的 `additionalProperties:false`；客户端可能另外限制输入。即便某客户端允许额外字段，当前 API 也不会因此保存、读取并传递人物资产，所以主要结论不变。

## 5. 是否需要替换工作流

**建议先保留 H3，新增明确的“人物＋产品复刻”模式；保留现有产品/首尾图模式的兼容性。**

候选路径需要依据想保留的控制来选择，不能在代码里静默改变参考用途：

| 路径 | 需要实现 | 何时采用 |
| --- | --- | --- |
| 三图直接分配为宝宝、妈妈、产品，原视频提供动作/场景 | 全链路保存和读取人物资产；明确 Picture/Subject 对应；修正保留旧人物的提示；审看流程与输入角色一致 | 先测试现有三图工作流能否满足双人物和产品需求；不把未传入的首尾预览声称为模型约束 |
| 在 prepare 中先用人物图生成并验收一致的首尾图，再保留现有三图渲染分配 | 参考图生成器支持必要多图输入；保存原身份→生成帧→视频的来源关系 | 需要保留当前分段首尾审看方案；身份经过生成帧间接传入，必须逐段验证漂移 |
| 扩展/另建工作流，同时传人物、产品、首尾图 | 验证模型节点真实支持所需输入数量；扩展图连线、适配器限制与成本/验收流程 | 必须同时保留多种独立参考，而当前三槽无法覆盖时 |

以上是待实现和验证的方案，不是已支持能力。只有新输入/角色映射 dry-run 通过、实际生成后双人物及动作达到验收标准，才可以说这一模式可用。换一个同样缺身份映射的工作流不会自动解决问题。

## 6. 此单执行前还要修正的制作假设

- 人工审片 S1–S4（0–3、3–6、6–13、13–16.3）不等于平台切段。当前自动窗口为 0–5、5–10、10–15、12.3–16.3，末段 trimStart=2.7。虽然都为四段，护理动作实际跨了生成窗口，必须单独验收动作和接点。
- “S3 全段 1:1，无需重映射”过宽。裤腰/开裆已确认相同可保留操作；上衣三粒变两粒、斜襟差异需要相应调整手部和扣合，不能把旧扣位操作直接照搬。
- 一次 prepare/八张参考图的授权（原记录中的转述）不等于已授权 render，也不等于接受丢失指定人物身份。本轮仅排查，没有据此发起生成。
- 用户要求的两个人物身份目前是必要能力缺口。只消除 API 维护态就开始付费，仍可能得到不符合身份要求的结果。

## 验证方式与限制

只读读取了公网 API、web/worker 实际环境白名单、磁盘两项视频开关、三条相关任务与相关素材记录、上游账户状态和工作流节点。未读取或输出密钥值，未更换账户或改图。

独立代码核查使用现有子代理 `review_clip_rejection_order`（原始启动参数：`fork_turns="none"`、`model="gpt-6-sol"`、`reasoning_effort="medium"`），本轮 followup 为只读追踪适配器/schema。主代理独立核对了实际线上图和运行配置。
