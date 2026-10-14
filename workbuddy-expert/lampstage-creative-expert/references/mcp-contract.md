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

`create_video_job` retains `source_asset_id`, `product_asset_id`, optional `title`, `instructions` and `preserve_audio`. Opt in with `generation_mode: "direct_references"` and exactly two ordered `reference_assets` entries. Each entry is `{ "asset_id": "...", "role": "character|scene|product_detail", "label": "..." }`; the label must be nonempty and at most 80 characters. All three image assets must be distinct. `product_asset_id` becomes Picture 1 and the two extras become Pictures 2 and 3. For baby/mother, send and label the baby then mother references in that order. The service cannot accept a fourth independent image in this mode.

Check the `video.replicate` entry in the `capabilities` array, with `modes.direct_references` and `status: available` before creating or preparing. Missing capability means the deployed server needs an update; do not switch modes. The create response and `get_job` expose `generation_mode`, all three `reference_assets` in actual order, `references_ready` and `source_duration`. After preparation, `get_job` includes the snapshot URLs and SHA-256 values for the references. Preparation freezes those assets and makes 4–5 second windows from the 4–30 second, 9:16 source without generating first/last frames (`image_calls: 0`). Show the actual references, windows and coin quote; obtain explicit budget consent before rendering. Legacy jobs keep their original preparation behavior.
