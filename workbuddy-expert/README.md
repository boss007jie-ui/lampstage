# Lampstage WorkBuddy Expert

`lampstage-creative-expert` is the WorkBuddy Expert package for creating images, recreating reference videos and producing grounded ecommerce content. It uses Lampstage's authenticated API for asset uploads, image jobs and video jobs. Product understanding and ecommerce keyword optimization run in the Expert; provider credentials and paid rendering stay server-side.

The package follows WorkBuddy's Expert manifest contract: the manifest includes a marketplace avatar, category, three tags, three quick prompts and an Agent file with YAML frontmatter. Its primary MCP dependency is the HTTPS streamable endpoint at `/api/mcp`; the dependency-free stdio bridge remains in the package for local validation and fallback use.

Before publishing, configure the MCP adapter with:

- `LAMPSTAGE_API_KEY` — the user's personal Lampstage API key, entered in WorkBuddy's token dialog

Each WorkBuddy user registers at `https://lampstage.com`, creates a personal key at `/account`, and binds that key to the Expert connector. The MCP endpoint forwards to the versioned `/api/v1` endpoints while the Expert keeps the user's facts and creative intent consistent across image, video and commerce outputs.

## Package and import

当前本地增量为 **0.10.1**：[安装包](releases/lampstage-creative-expert-0.10.1.zip)、[发布说明](releases/lampstage-creative-expert-0.10.1.release.md)、[验证记录](releases/lampstage-creative-expert-0.10.1.validation.json)。它在现有首次分析与候选播放中内置停顿／全局／分段／`after_state` 冲突检查，并同步工具目录：远端 27、本地 28。0.10 的质量修复后端仍待部署，本地包不证明生产能力或 WorkBuddy 已安装。

已保存的 0.10.0 及更早归档保留。校验与安装分别记录；任何命令或工具被拒、输出为空、读取失败，都不能显示校验通过。原生审计中心尚未确认拒绝的具体规则或资源时，不推断整个目录无权限，不重试或换命令绕过。离线校验器不负责安装；只有在目标环境已有明确访问权限时才可使用，实际安装仍走宿主支持的导入流程。

实际取证入口与纯证据判定器的区别、参数和失败处理见[离线校验器说明](validation/offline-validator.md)；0.10 接管发现、0.10.1 修正与旧诊断摘要的归属见[审查记录](validation/2026-10-16-quality-handoff-review.md)。宿主权限拒绝的已知证据见[脱敏诊断](../docs/implementation/2026-10-16-workbuddy-sandbox-diagnosis.md)，本地校验通过不能替代宿主导入验证。

历史 0.8.0 引入有序 1–6 图输入、显式模型和 1–4 张输出、固定人物绑定及图片未知结果恢复规则；[历史包](releases/lampstage-creative-expert-0.8.0.zip)、[发布记录](releases/lampstage-creative-expert-0.8.0.release.md)与[验证记录](releases/lampstage-creative-expert-0.8.0.validation.json)仅供追溯。妈妈、宝宝、商品和场景可分别输入，无需先拼图。两模型的应用参考上限为 6，目前只声明方图 `1_1`；四／六参考 OpenLux 实际接收与效果尚未实测。使用前核对线上 `image.generate` 能力，归档不更新安装缓存或部署后端；[0.7.0 历史包](releases/lampstage-creative-expert-0.7.0.zip)也保留。

Full-output plus segment delivery, explicit user feedback and private template save/list/detail/update/reuse remain supported, with strict creation preflight and safe reference-validation errors. Generation guidance uses bounded 30–60-second checks, preserves necessary playback/action/audio review, and reserves deep matrices for specific issues. Signed media URLs remain byte-for-byte unchanged. Templates save repeated planning; second-run savings are not yet measured. Check live `video.delivery`, `video.templates` and `characters.library` capabilities before their respective flows; this archive alone does not establish API deployment. The prior [0.6.0 archive](releases/lampstage-creative-expert-0.6.0.zip) remains available.

Draft/active usage, paginated job recovery, safe selected-draft cancellation and structured lifecycle errors remain supported. Planning stays local until explicit submission creates one task; save and reuse its ID. Quota errors and uncertain responses do not trigger repeated POSTs or key switching. Lifecycle functions require server capability version 1 or the tools from the live remote server. Draft/active limits default independently to 10; only eligible never-started drafts expire after 24 hours, without deleting media. No remote draft editing or create-idempotency is claimed. Existing installations require reimport through WorkBuddy's actual import/update flow; this build does not modify an installed package or connector secrets.

The six-reference route remains: 1–6 ordered images, complete semantic segment plans, candidate review before assembly, and account-wide video scheduling up to three requests. Its bundled stdio bridge can upload an explicitly supplied absolute local file path; the remote MCP upload still accepts a public URL. The Expert requires a server advertising an enabled `video.replicate.modes.six_references` capability entry. This package does not deploy the server or prove new production video quality. The [knowledge record](../docs/knowledge/video-replication/README.md) distinguishes local implementation from the historical user-accepted sample and its remaining sleeve detail drift. The archive keeps the top-level directory and hidden `.mcp.json`; both are required for WorkBuddy to discover the connector. Local project state belongs outside the packaged source directory. To rebuild it after a source change, run:

```bash
python workbuddy-expert/package_expert.py
```

The script validates that the source directory, `plugin.json.name`, and archive prefix all use `lampstage-creative-expert`, then writes the matching SHA-256 file beside the archive.

After changing a source file, rebuild and compare the full archive entry set and each entry's bytes against the source directory. A valid ZIP checksum proves the archive's integrity, not that it contains the latest source. Record the comparison time and current digest in the release validation record. ZIP metadata includes source file timestamps, so matching source content across different environments need not produce the same archive digest.

## Maintaining replication knowledge

The [video replication knowledge base](../docs/knowledge/video-replication/README.md) keeps original research snapshots, provenance and a template for further cases outside the customer package. The distilled guide and review template live inside `skills/video-generation/references` and are loaded by the Agent and video skill. Update the guide from verified evidence, increment the manifest version, rebuild and validate the archive, then reimport or distribute the new package through the actual release channel. Existing installations do not automatically sync local edits.
