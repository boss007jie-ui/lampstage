# Lampstage WorkBuddy Expert

`lampstage-commerce-creator` is the WorkBuddy Expert package for creating images, recreating reference videos and producing grounded ecommerce content. It uses Lampstage's authenticated API for asset uploads, image jobs and video jobs. Product understanding and ecommerce keyword optimization run in the Expert; provider credentials and paid rendering stay server-side.

The package follows WorkBuddy's Expert manifest contract: the manifest includes a marketplace avatar, category, three tags, three quick prompts and an Agent file with YAML frontmatter. Its primary MCP dependency is the HTTPS streamable endpoint at `/api/mcp`; the dependency-free stdio bridge remains in the package for local validation and fallback use.

Before publishing, configure the MCP adapter with:

- `LAMPSTAGE_API_KEY` — the user's personal Lampstage API key, entered in WorkBuddy's token dialog

Each WorkBuddy user registers at `https://lampstage.com`, creates a personal key at `/account`, and binds that key to the Expert connector. The MCP endpoint forwards to the versioned `/api/v1` endpoints while the Expert keeps the user's facts and creative intent consistent across image, video and commerce outputs.
