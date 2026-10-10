# Platformization: AI content, API and WorkBuddy

## Product shape

Lampstage is now presented as a general AI content and media platform. The web workspace is the human entry point. The developer page is the machine entry point. Existing lighting scene generation remains an adapter inside the workspace while the generic asset and job contracts are introduced.

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

`workbuddy-expert/lampstage-commerce-creator` packages the customer-facing Video Replica Expert. It composes reference-video understanding, segment/reference-frame preparation, image generation, Hypit/RunningHub Minimax H3 rendering and jobs/assets Skills. The `.mcp.json` uses a server-side `LAMPSTAGE_API_KEY` placeholder; Hypit, RunningHub and image-provider credentials remain in the persistent Lampstage worker and are not shipped to WorkBuddy.

## Compatibility boundary

The current database and image generation pipeline still contain lighting-specific profile fields and prompt adapters. They are deliberately kept behind the existing workspace routes until a generic `AssetProfile` and provider-neutral job payload are migrated. This lets the platform entry points ship without invalidating existing lamp jobs or their review metadata.
