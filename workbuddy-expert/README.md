# Lampstage WorkBuddy Expert

`lampstage-creative-expert` is the WorkBuddy Expert package for creating images, recreating reference videos and producing grounded ecommerce content. It uses Lampstage's authenticated API for asset uploads, image jobs and video jobs. Product understanding and ecommerce keyword optimization run in the Expert; provider credentials and paid rendering stay server-side.

The package follows WorkBuddy's Expert manifest contract: the manifest includes a marketplace avatar, category, three tags, three quick prompts and an Agent file with YAML frontmatter. Its primary MCP dependency is the HTTPS streamable endpoint at `/api/mcp`; the dependency-free stdio bridge remains in the package for local validation and fallback use.

Before publishing, configure the MCP adapter with:

- `LAMPSTAGE_API_KEY` — the user's personal Lampstage API key, entered in WorkBuddy's token dialog

Each WorkBuddy user registers at `https://lampstage.com`, creates a personal key at `/account`, and binds that key to the Expert connector. The MCP endpoint forwards to the versioned `/api/v1` endpoints while the Expert keeps the user's facts and creative intent consistent across image, video and commerce outputs.

## Package and import

Use either the source directory `workbuddy-expert/lampstage-creative-expert` or the release archive [lampstage-creative-expert-0.3.0.zip](releases/lampstage-creative-expert-0.3.0.zip). Version 0.3.0 uses explicit product/character/scene references for new video jobs, without generating endpoint frames. It requires a server advertising `video.replicate.modes.direct_references` in its capability entry; this local release does not deploy that server change. See the [implementation and rollout record](../docs/implementation/2026-10-14-direct-reference-video.md). The archive deliberately keeps the top-level directory and hidden `.mcp.json`; both are required for WorkBuddy to discover the `lampstage` connector. To rebuild it after a source change, run:

```bash
python workbuddy-expert/package_expert.py
```

The script validates that the source directory, `plugin.json.name`, and archive prefix all use `lampstage-creative-expert`, then writes the matching SHA-256 file beside the archive.

After changing a source file, rebuild and compare the full archive entry set and each entry's bytes against the source directory. A valid ZIP checksum proves the archive's integrity, not that it contains the latest source. Record the comparison time and current digest in the release validation record. ZIP metadata includes source file timestamps, so matching source content across different environments need not produce the same archive digest.

## Maintaining replication knowledge

The [video replication knowledge base](../docs/knowledge/video-replication/README.md) keeps original research snapshots, provenance and a template for further cases outside the customer package. The distilled guide and review template live inside `skills/video-generation/references` and are loaded by the Agent and video skill. Update the guide from verified evidence, increment the manifest version, rebuild and validate the archive, then reimport or distribute the new package through the actual release channel. Existing installations do not automatically sync local edits.
