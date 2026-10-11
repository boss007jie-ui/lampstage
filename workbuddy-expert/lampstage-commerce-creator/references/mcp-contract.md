# Lampstage API connector contract

The package expects the connector to expose these tools:

- `health` and `capabilities`
- `upload_asset` (image or video)
- `create_image_job`
- `create_video_job`
- `prepare_video_job`
- `render_video_job`
- `get_job`
- `download_output`

The bridge sends `Authorization: Bearer $LAMPSTAGE_API_KEY` to `https://lampstage.com/api/v1`. Each user supplies a personal key from the account page. Image and video execution remains server-side; Hypit, RunningHub and provider credentials are never shipped in the Expert package. Ecommerce copy is produced by the local Expert skills and has no separate server endpoint.
