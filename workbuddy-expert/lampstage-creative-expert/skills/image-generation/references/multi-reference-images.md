# 有序多参考图片工作流

多张人物、商品和场景图片可以直接交给 `create_image_job` 合成一张完整场景图。**不要求用户先拼图或先提供已合成的首帧**。这一步是独立的图片生成，可能付费；视频 `prepare_video_job` 仍只准备已有图片，不会替用户完成合成。

## 先核对能力与本次选择

查看目标服务的 `image.generate`：应为 `status: available`，且 `inputs.reference_assets` 声明 `schema_version:1`、`ordered:true` 及本次所需张数。核对 live MCP schema、`limits`、`models` 和 `provider_validation`；本地桥接工具列表不能证明服务器已经升级。旧服务未声明数组时，说明能力缺失，不把四图降成一图、转成四次单图请求、拼成未经批准的接触表或生成探测任务。

| 选择 | 当前应用契约 |
| --- | --- |
| `nano_banana_21` | 默认模型；显示 Nano 2.1，网关别名 `gemini-nano-banana-2.1`；最多6张参考图 |
| `image_25` | 显示 image 2.5，网关别名 `gpt-image-2-c`；最多6张参考图 |
| `image_count` | 要生成的图片数，整数1–4；不是参考图片数 |
| `aspect_ratio` | 本次仅声明 `1_1`；不能承诺已经支持竖图或其他比例 |

这里的6张是应用限制，不代表模型官方上限。两个别名的四图、六图请求格式已有离线检查，**OpenLux 实际接收与生成效果尚未付费实测**，不能写成“真实多图生成已验收”。选择用户指定的模型；未指定时沿用默认模型并记录选择，不为了试能力创建任务，也不在失败后自动换模型。

记录每张图的来源、真实 `asset_id`、用途、列表位置及已确认的外观要求。可以先选妈妈、再宝宝、再商品、再场景；第一张不必是商品。复用已有素材ID，缺图时按受支持的上传方式取得ID。`output_id`、C编号、图片URL均不等于资产ID。

从人物库选图时，先按C编号查档案，读取用户选定的固定版本及图片索引。数组项必须同时提供该图的真实 `asset_id`、`character_version_id` 和零起始 `image_index`，且 `role:"character"`；服务端会核对版本、资产、归属和归档状态。妈妈和宝宝分别绑定，不能用最新版本替代已选旧版本。临时普通人物图片省略两个绑定字段；**图片接口不接受视频模板替换用的 `character_version_id:null`**，不自动保存人物。

## 提交字段与四图示例

当前 MCP 每次新调用都填写 `custom_prompt`（非空，最多12000字符）和 `image_count`。来源二选一：旧单图用 `asset_id`；有序完整列表用 `reference_assets`，1–6项，每项 `{asset_id,role,label,character_version_id?,image_index?}`。不能同时传 `asset_id` 或 `uploaded_asset_id`，不能重复、自动去重、丢弃或重排图片。

角色为 `character`、`product`、`product_detail`、`scene`、`start_state`、`end_state`。标签非空且最多80字符，不能有换行、Tab或其他控制字符；ID为1–128位ASCII字母数字、下划线或连字符。绑定版本和图片索引必须成对，仅供人物角色，索引是0–5的整数。提示词长度按 JavaScript 字符串计算，不静默截断。可选 `platform_style` 为 `domestic_ecommerce` 或 `brand_site`。

MCP 不声明 `scene_kind`、`template_id`、`recommended_prompt_en`，不把这些REST字段加到工具调用中。REST数组路径只允许省略 `scene_kind` 或值为 `custom`；不能混入模板或推荐提示词。旧单图来源仍可用 `asset_id`，但本地与远端工具的两条路径都必须显式填写提示词和输出数，缺一项就应在网络请求前拒绝。仅底层REST保留旧单资产/profile默认行为；不能绕过工具必填项，导致未指定张数却按默认值付费出图。

以下展示“四图输入，一图输出”。所有ID都只是占位示例，必须替换为已查询的实际ID；人物版本号须先解析到真实版本ID。整个数组按列表顺序传入，图片不用预先拼合。

```json
{
  "reference_assets": [
    {"asset_id":"selected_mother_asset","role":"character","label":"妈妈外观","character_version_id":"selected_mother_version","image_index":0},
    {"asset_id":"selected_baby_asset","role":"character","label":"宝宝外观","character_version_id":"selected_baby_version","image_index":1},
    {"asset_id":"selected_product_asset","role":"product","label":"本次商品"},
    {"asset_id":"selected_scene_asset","role":"scene","label":"本次场景"}
  ],
  "custom_prompt":"生成一张连贯的完整场景图。按已确认的位置与动作前态安排妈妈、宝宝和商品；图1仅用于妈妈外观，图2仅用于宝宝外观，图3用于商品外观，图4用于场景。保留各自已确认的衣着、颜色与结构，统一透视与光照。第一张不是商品参考，不输出参考图拼版，不添加未要求的文字。",
  "image_count":1,
  "image_model":"nano_banana_21",
  "aspect_ratio":"1_1"
}
```

提示词要逐一对应所选参考与用途，补充用户明确要求的变化，不从旧项目或原视频偷偷继承另一人的服装、发型或背景。发现图与文字冲突，先修正本次计划。角色标签和人物版本确定输入及意图，不保证每次输出的人物完全一致。

## 创建、恢复与验收

1. 在已有授权范围内核对模型、参考顺序、输出张数和成本。`create_image_job` 会启动图片生成，不是免费的草稿或预览。只提交一次，立即在本地项目记录保存真实 `job_id`、参数和来源信息；不保存凭据或签名URL。
2. 用 `get_job` 读取同一个任务。新数组任务应返回 `reference_schema_version:1`、`reference_count`、有序 `reference_assets`（含SHA256与人物绑定）及 `image_count`；逐项核对，不把计数当成模型实际使用了全部图片的视觉证明。缺少元数据时说明无法核对，不虚构摘要、图片字节或存储路径。
3. 网络超时、断开或响应损坏属于结果不明。有ID就查原任务；没有ID则通过实际可用的账户图片历史入口核对，不能编造 `list_image_jobs`。`list_video_jobs` 仅列视频，查不到不能证明图片任务未创建。无法核实时保留原请求并报告不明状态，停止自动重复POST或切换模型。修正明确被拒绝的输入与重复一个结果不明的请求是两回事。
4. 完成后展示并检查实际图片。分别对照妈妈、宝宝、商品和场景，检查外观、服装、比例、手部、遮挡和文字；记录未通过或无法确认的项。completed与参考元数据都不等于视觉验收通过。用户选定输出后，如需作为视频参考，使用该输出真实可用的资产ID；没有资产ID时按支持的上传流程取得，不能冒用生成输出ID。
5. 后续需要竖屏视频时，把“当前方形图片”和“视频目标比例”分别记录。只有明确确认了构图/裁切方案且关键人物和商品完整保留，才采用已有方图；否则先解决构图要求，不向本次图片接口发送未支持比例。作为视频首帧的图片还须满足该段完整场景及动作前态，再进入 [视频制作流程](../../video-generation/references/production-workflow.md)。

人物的查找、固定版本与独立保存见 [人物库工作流](../../character-library/references/character-workflow.md)。人物选择、保存人物、同意付费作图和接受最终视频是不同的意图；沿用已有明确授权，不从一个动作推断其他授权。
