# WorkBuddy Connector setup

When the WorkBuddy UI asks for an Expert Connector, create one HTTP connector named `lampstage` with:

- Base URL: `https://lampstage.com/api/v1`
- Authentication: `Authorization: Bearer <LAMPSTAGE_API_KEY>`
- Discovery: `GET /health` and `GET /capabilities`
- Image path: `POST /assets` → `POST /image-jobs` → `GET /jobs/:id`
- Video path: `POST /video-assets` → `POST /assets` for the product image → `POST /video-jobs` → `POST /video-jobs/:id/prepare` → review → `POST /video-jobs/:id/render` → `GET /jobs/:id`
- Request timeout: at least 90 seconds for asynchronous job creation

Keep `LAMPSTAGE_API_KEY` in the WorkBuddy secret or server-side connector vault. Each user must create and bind their own key from `https://lampstage.com/account`; a shared key merges credits and task history. Do not paste Hypit, RunningHub, image-model or language-model provider keys into the Expert prompt. The checked-in `.mcp.json` launches the dependency-free `scripts/lampstage-http.mjs` bridge. The paid render step must wait for the user's reference-frame and budget approval.
