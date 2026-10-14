# WorkBuddy Connector setup

The Expert declares one streamable HTTP MCP dependency named `lampstage` with:

- MCP URL: `https://lampstage.com/api/mcp`
- Authentication: `Authorization: Bearer <LAMPSTAGE_API_KEY>`
- Discovery tools: `health` and `capabilities`
- Image path: `POST /assets` → `POST /image-jobs` → `GET /jobs/:id`
- Video path: upload the source and each selected image → check the `video.replicate` entry in the `capabilities` array, with `modes.direct_references` and `status: available` → `POST /video-jobs` with explicit mode and two ordered references → `POST /video-jobs/:id/prepare` → review the three snapshots, source windows and quote → `POST /video-jobs/:id/render` after explicit budget consent → `GET /jobs/:id`
- Request timeout: at least 90 seconds for asynchronous job creation

Keep `LAMPSTAGE_API_KEY` in the WorkBuddy secret or server-side connector vault. Each user creates a personal key at `https://lampstage.com/account`; shared keys merge credits and task history. Do not paste Hypit, RunningHub, image-model or language-model provider keys into Expert messages. The checked-in `scripts/lampstage-http.mjs` bridge remains available for local validation. Ecommerce keyword optimization runs in the Expert from confirmed facts and does not require a server copy endpoint. In direct-reference mode, preparation does not generate first/last frames. The paid video render must wait for reference, window and budget approval. Older jobs keep their legacy preparation path.
