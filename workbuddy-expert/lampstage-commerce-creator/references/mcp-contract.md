# Lampstage MCP contract

The package expects the server-side MCP adapter to expose these tools:

- `health` and `capabilities`
- `upload_asset`
- `optimize_product_copy`
- `create_image_job`
- `create_video_job`
- `get_job`
- `download_output`

The adapter should send `Authorization: Bearer $LAMPSTAGE_API_KEY` to `https://lampstage.com/api/v1`. Provider keys such as Hypit, image models and language models stay in the Lampstage runtime.
