# Lampstage MCP contract

The package expects the server-side MCP adapter to expose these tools:

- `health` and `capabilities`
- `upload_asset` (image or video)
- `create_image_job`
- `create_video_job`
- `prepare_video_job`
- `render_video_job`
- `get_job`
- `download_output`

The checked-in HTTP bridge sends `Authorization: Bearer $LAMPSTAGE_API_KEY` to `https://lampstage.com/api/v1`. Each user supplies their own key from the account page. Hypit and RunningHub credentials stay in the persistent Lampstage video worker; the Expert only receives reviewable frame URLs, task state and final output URLs.
