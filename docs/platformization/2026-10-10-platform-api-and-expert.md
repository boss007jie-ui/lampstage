# Platformization: AI content, API and WorkBuddy

## Product shape

Lampstage is now presented as a general AI content and media platform. The web workspace is the human entry point. The developer page is the machine entry point. Existing lighting scene generation remains an adapter inside the workspace while the generic asset and job contracts are introduced.

The first supported capability set is:

- image generation
- video generation backed by the existing video runtime
- ecommerce title, selling point, keyword and localization assistance
- asset upload and asynchronous job status

## API contract

The first public, read-only contract is available at:

- `GET /api/v1/health`
- `GET /api/v1/capabilities`

Both routes are safe for discovery and include CORS headers. They do not claim that job execution is public yet. A later API rollout needs durable API keys, per-key usage and credit accounting, request idempotency, signed output URLs and rate limits before opening write endpoints.

## WorkBuddy Expert

`workbuddy-expert/lampstage-commerce-creator` packages the customer-facing Expert. It composes product understanding, ecommerce keyword optimization, image generation, video generation and jobs/assets Skills. The `.mcp.json` uses a server-side `LAMPSTAGE_API_KEY` placeholder; supplier credentials remain in the Lampstage runtime.

## Compatibility boundary

The current database and image generation pipeline still contain lighting-specific profile fields and prompt adapters. They are deliberately kept behind the existing workspace routes until a generic `AssetProfile` and provider-neutral job payload are migrated. This lets the platform entry points ship without invalidating existing lamp jobs or their review metadata.
