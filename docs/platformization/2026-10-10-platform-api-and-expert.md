# Platformization: AI content, API and WorkBuddy

## Product shape

Current entry points were narrowed on 2026-10-11 and checked again on 2026-10-13. Lampstage (创境) is an AI content and media API platform used primarily through the WorkBuddy Creative Expert. The website provides account registration, personal API keys and integration guidance. Users initiate creative work in the Expert, which accesses Lampstage through MCP and the versioned API.

The former `/workspace`, `/video-workspace` and `/cases` pages redirect to `/developers`; `/my` and `/credits` redirect to `/account`. The earlier web-workspace product description is historical. Lighting scene generation remains a compatibility path in the backend, not the definition of the current product or its intended customer categories.

The first supported capability set is:

- image generation
- video generation backed by the existing video runtime
- ecommerce title, selling point, keyword and localization assistance
- asset upload and asynchronous job status

## API contract

The public v1 contract is available at:

- `GET /api/v1/health`
- `GET /api/v1/capabilities`

Discovery is public and write/task routes require a per-user Bearer API key created at `/account`. The live task paths are:

- `POST /api/v1/assets` and `POST /api/v1/video-assets`
- `POST /api/v1/image-jobs` and `POST /api/v1/video-jobs`
- `GET /api/v1/jobs/:id`

Provider credentials remain server-side. API keys are stored as SHA-256 digests and the full key is shown only once. Image generation currently waits for the existing provider pipeline before returning; video projects enter the existing durable worker queue. Idempotency keys and per-key rate limits remain the next hardening step before broad public distribution.

## WorkBuddy Expert

`workbuddy-expert/lampstage-creative-expert` packages the customer-facing Lampstage Creative Expert. It composes product understanding, ecommerce keyword optimization, image generation, reference-video preparation, Hypit/RunningHub Minimax H3 rendering and jobs/assets Skills. The `.mcp.json` uses a WorkBuddy token-dialog `LAMPSTAGE_API_KEY` placeholder; Hypit, RunningHub and image-provider credentials remain in the persistent Lampstage worker and are not shipped to WorkBuddy.

## Compatibility boundary

The current database and image generation pipeline still contain lighting-specific profile fields and prompt adapters. The public image API accepts a source asset plus `custom_prompt` without requiring a product profile, while reusing the existing generation pipeline. Legacy backend routes remain for compatibility, but their former web workspace pages are no longer the public creation entry point. A generic `AssetProfile` and provider-neutral pipeline remain migration work; successful production results across content types must be verified separately from the platform positioning.
