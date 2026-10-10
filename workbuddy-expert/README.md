# Lampstage WorkBuddy Expert

`lampstage-commerce-creator` is a publishable Expert package that combines product understanding, ecommerce keyword optimization, image generation, Hypit-backed video generation and job polling.

Before publishing, configure the MCP adapter with:

- `LAMPSTAGE_API_BASE_URL` — normally `https://lampstage.com/api/v1`
- `LAMPSTAGE_API_KEY` — a server-side Lampstage API key

Provider credentials stay in the Lampstage runtime. The package contains no secrets and is designed to work with the versioned capability contract exposed at `/api/v1/capabilities`.
