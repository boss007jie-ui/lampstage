# 独立人物库与固定版本

C001 等人物档案保存“谁出现”，T001 等动作模板保存动作、时间窗、依赖与工作流。两者可独立保存。先查看真实服务 `characters.library` 是否 `available`，并核对六个工具的 live schema；本地工具列表不能证明服务器已部署。能力缺失时明确说明，不能猜接口、自动改用上传副本或生成探测任务。

## 选图与明确保存

1. 使用用户明确选定的图片。已有 `asset_id` 就沿用；需要找以前的上传图时，分页调用 `list_character_assets {limit?,cursor?}`，展示实际图片、顺序与用途供选择。`get_video_delivery.character_references` 是**原始人物参考图**，不代表生成成片中的人物截图，也不证明其最终外观。
2. 用户喜欢现有生成视频中的人物时，可下载该现有视频，用可用的本地 FFmpeg 免费抽取指定时刻画面，展示后按用户选择保存。记录来源任务、候选哈希/版本及时间点。抽帧不进行 AI 生成，不自动接受候选或整片，不发明服务端抽帧工具。
3. 抽出的新图片通过现有上传流程取得真实 `asset_id`：本地桥接用用户选定的绝对路径 `upload_local_asset`；远程 `upload_asset` 只支持可读取的公开 HTTP(S) URL，不能读取本地路径。没有相应本地上传能力时使用实际可用的账户上传入口，不秘密搭建公开临时文件站。已有图片不为保存人物反复下载上传。不要把生成图片的 `output_id` 或视频尾帧 URL 冒充 `asset_id`。
4. 明确本次保存的人物名称、选中图片、每图标签及顺序，和用户确认的描述。保存1–6张，不能重复同一素材或同字节内容；相似脸不能代替内容核对。用户已经明确要求保存这些具体图片时，沿用该授权，不重复询问。缺少人物选择或保存意图时先补齐，不从“收到”、completed、候选接受推断。
5. 在用户本地项目记录中先保留一个新生成的稳定 `idempotency_key`（例如 UUID；ASCII字母数字/下划线/连字符，1–128字符），连同本次请求及选择证据。调用 `save_character`，不提交 `submit_video_feedback`，不创建视频或动作模板。记录中不放凭据或签名URL。

```text
save_character {
  idempotency_key: 本次保存的稳定键,
  name: 用户确认的名称,
  category: 可选分类,
  description: 可选人物描述,
  reference_assets: [{asset_id: 已选图片ID, label: 图片用途}]
}
```

名称1–80、分类0–40、描述0–2000、标签1–80字符，长度按 JavaScript 字符串计算。名称/分类/标签不能有C0/DEL（含换行和Tab）；描述可含CR/LF/Tab，不得含其他控制字符。不得静默截断。图片数组有序、1–6个不同ID，仅含 `asset_id,label`。API JSON最多16KiB。图像格式/大小沿用JPEG、PNG、WebP及5MiB原图限制，归属和实际内容以服务端核对为准。

成功响应为 `{character,selected_version,reused}`：返回真实 `character.code/id`、版本号/ID、选中图片及保存/复用状态后，才称已保存。`reused:true` 可能返回已经存在的档案/版本，包括标记为archived的档案；照实说明，不虚报新C编号、不自动恢复。人物保存不需要完整视频哈希或满意反馈，不占用新视频任务配额。

## 不明结果与版本编辑

- `save_character` 网络超时、响应损坏或结果不明：先 `list_characters` / `get_character` 核对；名称不唯一，不能只凭同名判断成功。不盲目重试。核对后确需重试时，保留**同一幂等键和同一请求**；不能通过新键绕过不明结果。服务端同键同规范化请求返回原结果，同键不同请求返回409 `character_idempotency_conflict`。用户确实改变保存内容属于另一个明确保存请求，先解决前次状态。
- 新人物版本使用 `save_character_version {character_id,expected_latest_version_id,description?,reference_assets}`。先读详情，固定用户正在编辑的最新版本ID；展示改动后在授权范围内保存。相同内容可返回既有版本且 `reused:true`，不是失败，也不应强制增版。
- 409 `character_version_changed`：重新读详情和改动，不静默替换 `expected_latest_version_id` 重写。版本保存没有 `idempotency_key` 参数，不发明参数；结果不明同样先读取核对，不盲重写。
- `update_character {character_id,name?,category?,archived?}` 只改名称、分类或归档状态，至少一项；图片与描述变更必须创建新版本。无硬删除工具，归档不删图片、不改变已固定版本。

## 查找与组合

`list_characters {status?,q?,limit?,cursor?}` 默认active/20，status可选active/archived/all，q按编号或名称搜索、最多80字符，limit为1–50。游标使用服务返回的原值，最长512；不是字符ID，不自行解码改写。重名时展示实际编号和预览，让用户选定；C001是显示编号，详情/修改使用真实内部ID。

调用 `get_character {character_id,version_id?}` 取得 `{character,versions,selected_version}`。版本详情含描述、内容摘要及有序 `reference_assets`；每项有 `index,asset_id,label,image_url,sha256,size_bytes,width,height`。固定所选版本的真实ID及图片 `index`，不把最新版本替换进用户选择的旧版本，不按图片URL或名称猜身份。

在六参考视频的顶层或每段 `reference_assets` 中，用所选版本的真实资产和索引：

```text
{ asset_id: 所选版本中该图片的asset_id,
  role: "character", label: "妈妈正面",
  character_version_id: 所选固定版本ID, image_index: 0 }
```

`image_index` 是0–5的整数，且必须存在于该版本返回的图片列表。所填 `asset_id` 必须与该固定版本/索引一致；服务器会核对，不能双写不一致。宝宝、妈妈等不同人物分别选择各自版本/图片，映射到明确槽位；角色图片仍计入每段最多6张，不能自动拼图、丢图或改变角色顺序。

视频人物绑定仅支持 `six_references`，不注入legacy/direct任务。旧的普通图片参考仍可只有 `asset_id,role,label`；单独 `image_index` 非法。`start_state` 或 `end_state` 不能伪装成人物绑定槽，也不能用人物图替换本次已审阅前段的真实接续尾帧。

图片生成也可以在有序 `reference_assets` 中选用上述真实资产、固定版本和索引，详见 [多参考图片流程](../../image-generation/references/multi-reference-images.md)。先检查 live `image.generate` 的数组能力；所有图合计1–6张，`image_count`另指1–4张输出。妈妈、宝宝、商品、场景可分别提交，不要求先拼成首帧。图片接口的版本/索引必须成对且只用于character，临时普通图片省略二者，**不能使用下文视频模板替换专用的null**。不把动作模板、旧付费状态或人物描述自动注入图片请求；生成结果仍须检查。

人物描述是固定版本元数据，不会由worker偷偷附加到提示词。重要的身份要求应整理到用户能看到的新计划和适当的全局/分段字段中；仍遵守全局2000、分段1600、前后态各400等限制。若超限，重新编辑并审阅，不复制整段描述造成截断，不承诺人物档案能锁定每次生成结果。

## 与动作模板组合

读取 T-code 详情后，固定动作模板版本和所选人物版本。旧模板 `recipe_schema_version:1` 继续使用；含人物绑定的新模板为schema2。服务端存储的schema2只在绑定槽保存人物版本/索引及角色标签，不复制人物图片或完整资料。**给专家的 `create_payload` 已解析回实际 `asset_id`，并保留绑定字段**；直接按此创建，不要求专家自己重建内部配方。

`selected_version.character_bindings` 展示绑定的 `segment_index,reference_index,character_id,code,name,character_version_id,version,image_index`；顶层引用的 `segment_index` 为-1。检查顶层和逐段覆盖列表，不能只替顶层而漏掉片段的旧人物。身份可在兼容槽位替换，动作时间窗/依赖/音频/角色顺序仍按 [视频模板规则](../../video-generation/references/video-templates.md) 保留。

用户明确要求“这次临时换照片，不保存人物”时，使用新图实际ID和角色标签，写 **`character_version_id:null`，不带 `image_index`**。这表示本次临时引用，不建人物、不存人物版本。schema2原来绑定的槽不能直接漏掉字段；漏写会返回409 `character_binding_required`，不得通过删除字段或解除模板关联来绕过。仅保存这次动作模板也不会自动创建人物。

归档人物不允许新选入普通新任务。若该固定版本已经由用户明确选择的动作模板版本绑定，可原样沿用；其他归档版本不能借同一C编号混入。归档不破坏既有任务和模板固定引用，不需要自动恢复档案。服务端拒绝时核对实际版本/模板关系，不绕过。

新任务照常创建一次、保存job ID、prepare、核对当前参考快照与报价、取得本次预算授权、生成与逐段验收。旧候选/接受状态/尾帧/token/回执/许可不继承。原有30–60秒有界查询、完整视频和全部分段交付继续执行。保存人物、动作模板与同意付费生成是不同的用户意图。

## 存储和隐私说明

去重依据同一账户内**完全相同文件字节的SHA256**，不是人脸识别。相同原图重复上传可共享原始媒体；正常产品上传仍可能获得独立素材记录，以保留各自产品资料。裁剪或重新编码后字节改变，不应承诺复用同一存储对象。不要为“去重”合并同名或相似人物。

人物和版本记录按账户隔离；现有原图URL沿用原来的公开媒体行为，不能宣称所有图片已变成私密存储。历史重复对象不会自动删除。每任务/每段的标准化PNG属于审核快照，仍须保留，不能当作多余人物原图清理。没有后台历史索引完成证据时，不声称所有旧图片已完成去重或回收空间。
