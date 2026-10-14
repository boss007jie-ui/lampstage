# Lampstage Creative Expert

This WorkBuddy Expert connects a user's workflow to the Lampstage API and combines five skills:

- product understanding from supplied facts and source assets
- ecommerce keyword and listing copy optimization
- image generation through `image-jobs`
- reference-video preparation and RunningHub Minimax H3 rendering
- asset upload, job polling and output retrieval

## Configure the connector

1. Register at `https://lampstage.com` and create a personal API key at `/account`.
2. Import this directory as a WorkBuddy Expert package.
3. Connect the `lampstage` MCP dependency and enter the API key in WorkBuddy's token dialog.
4. The package connects to `https://lampstage.com/api/mcp`, which forwards to the versioned `/api/v1` API.

The connector declaration uses the standard `streamable-http` transport type. The package keeps the MCP configuration in the root `.mcp.json`; do not remove or rename this hidden file when repacking.

The Expert checks `health`, `capabilities` and the actual tool input contract before write operations. Legacy preparation may generate paid reference images. In `direct_references` mode, preparation snapshots three supplied references and automatically slices the source; it does not generate opening or ending frames. Rendering and any separate image preparation require the user's authorization and budget. The package does not expose provider credentials.

## Direct reference replication · 0.3.0

The new opt-in `generation_mode: "direct_references"` uses the original 9:16, 4–30 second video for motion, the product image as Picture 1, and exactly two ordered image references as Pictures 2 and 3. Each extra reference needs an asset ID, `role` (`character`, `scene` or `product_detail`) and a descriptive label. For baby/mother work, label both identities. A separate scene image must fit one of those two positions or already be included in a confirmed reference; otherwise the source video supplies scene context. The service automatically splits the source into 4–5 second windows; it does not offer semantic window selection.

This mode requires a `video.replicate` entry with `modes.direct_references` and `status: available` in the deployed server capability catalog. If absent, the Expert stops before preparation and explains that a supporting deployment is required. It never switches to the older frame-generation workflow for a direct-reference request. Before rendering, the Expert shows the three actual references, labels/roles, source windows and coin quote and obtains explicit budget consent. Existing jobs keep their original mode.

## Infant clothing replication guidance

For baby clothing demonstrations, baby/mother replacement and bedsheet color changes, the Expert loads the [infant clothing guide](skills/video-generation/references/infant-clothing.md) and [production review record](skills/video-generation/references/replication-review-template.md). They cover confirmed product structure, action completeness, compatible shot reuse, localized repairs, audio review and attempt/cost tracking.

These are production and review rules derived from prior cases. They do not add independent identity controls, custom segmentation, mask recoloring, selected-segment submission or narration tools to the API, and do not guarantee one-shot success. Requirements needing unavailable controls are identified before paid generation.

Import this version again to receive the new guidance. An older installed package does not automatically read future local knowledge-base updates.

## Runtime readiness

The package structure and bundled bridge can be validated without provider calls. Real image/video jobs require the Lampstage production database migrations, object storage credentials and worker runtime to be healthy. A `503` health response means the package imported successfully but the API is not ready to accept tasks yet.

The bundled bridge accepts source assets through a public `http(s)` URL so the server can fetch them safely. Validate one publicly readable image URL before testing an image job; a local file path or a private-network URL will be rejected by design.
