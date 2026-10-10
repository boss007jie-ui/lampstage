# Lampstage WorkBuddy Expert

`lampstage-commerce-creator` is the publishable WorkBuddy Expert package for reference-video replication. It combines video understanding, segment/reference-frame preparation, image generation, Hypit-backed RunningHub Minimax H3 rendering and job polling. Commerce copy remains an optional follow-up skill.

Before publishing, configure the MCP adapter with:

- `LAMPSTAGE_API_BASE_URL` — normally `https://lampstage.com/api/v1`
- `LAMPSTAGE_API_KEY` — a server-side Lampstage API key

Provider credentials stay in the persistent Lampstage video worker. The package contains no Hypit executable or provider secret; it calls the server-side Hypit/RunningHub adapter through the API. Each WorkBuddy user first registers at `https://lampstage.com`, creates a personal key at `/account`, and binds that key to the Expert connector. The connector then calls the live versioned endpoints under `/api/v1`; the platform keeps provider credentials, credits and task ownership server-side.
