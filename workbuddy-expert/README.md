# Lampstage WorkBuddy Expert

`lampstage-commerce-creator` is a publishable Expert package that combines product understanding, ecommerce keyword optimization, image generation, Hypit-backed video generation and job polling.

Before publishing, configure the MCP adapter with:

- `LAMPSTAGE_API_BASE_URL` — normally `https://lampstage.com/api/v1`
- `LAMPSTAGE_API_KEY` — a server-side Lampstage API key

Provider credentials stay in the Lampstage runtime. The package contains no secrets. Each WorkBuddy user first registers at `https://lampstage.com`, creates a personal key at `/account`, and binds that key to the Expert connector. The connector then calls the live versioned endpoints under `/api/v1`; the platform keeps provider credentials, credits and task ownership server-side.
