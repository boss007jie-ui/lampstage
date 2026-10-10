# WorkBuddy Connector setup

When the WorkBuddy UI asks for an Expert Connector, create one HTTP connector named `lampstage` with:

- Base URL: `https://lampstage.com/api/v1`
- Authentication: `Authorization: Bearer <LAMPSTAGE_API_KEY>`
- Discovery: `GET /health` and `GET /capabilities`
- Request timeout: at least 90 seconds for asynchronous job creation

Keep `LAMPSTAGE_API_KEY` in the WorkBuddy secret or server-side connector vault. Do not paste Hypit, image-model or language-model provider keys into the Expert prompt. The write endpoints should be enabled only after the server has API-key scope checks, idempotency and credit settlement.
