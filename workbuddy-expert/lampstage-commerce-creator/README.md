# Lampstage Creative Expert

This WorkBuddy Expert connects a user's workflow to the Lampstage API and combines five skills:

- product understanding from supplied facts and source assets
- ecommerce keyword and listing copy optimization
- image generation through `image-jobs`
- reference-video preparation and Hypit / RunningHub H3 rendering
- asset upload, job polling and output retrieval

## Configure the connector

1. Register at `https://lampstage.com` and create a personal API key at `/account`.
2. Import this directory as a WorkBuddy Expert package.
3. Connect the `lampstage` MCP dependency and enter the API key in WorkBuddy's token dialog.
4. The package connects to `https://lampstage.com/api/mcp`, which forwards to the versioned `/api/v1` API.

The Expert checks `health` and `capabilities` before write operations. It asks for approval before paid video rendering and does not expose provider credentials.

## Runtime readiness

The package structure and bundled bridge can be validated without provider calls. Real image/video jobs require the Lampstage production database migrations, object storage credentials and worker runtime to be healthy. A `503` health response means the package imported successfully but the API is not ready to accept tasks yet.
