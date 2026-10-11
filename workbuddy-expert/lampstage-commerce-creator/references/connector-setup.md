# WorkBuddy Connector setup

The Expert declares one streamable HTTP MCP dependency named `lampstage` with:

- MCP URL: `https://lampstage.com/api/mcp`
- Authentication: `Authorization: Bearer <LAMPSTAGE_API_KEY>`
- Discovery tools: `health` and `capabilities`
- Image path: `POST /assets` → `POST /image-jobs` → `GET /jobs/:id`
- Video path: `POST /video-assets` → `POST /assets` for the replacement asset → `POST /video-jobs` → `POST /video-jobs/:id/prepare` → user review → `POST /video-jobs/:id/render` → `GET /jobs/:id`
- Request timeout: at least 90 seconds for asynchronous job creation

Keep `LAMPSTAGE_API_KEY` in the WorkBuddy secret or server-side connector vault. Each user creates a personal key at `https://lampstage.com/account`; shared keys merge credits and task history. Do not paste Hypit, RunningHub, image-model or language-model provider keys into Expert messages. The checked-in `scripts/lampstage-http.mjs` bridge remains available for local validation. Ecommerce keyword optimization runs in the Expert from confirmed facts and does not require a server copy endpoint. The paid video render must wait for reference-frame and budget approval.
