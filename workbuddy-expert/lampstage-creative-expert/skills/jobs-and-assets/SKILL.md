---
name: jobs-and-assets
description: Upload source assets, track asynchronous jobs and return safe output references.
---

# Jobs and assets

Use `upload_asset` for user files and keep the returned `asset_id`. Use `get_job` with bounded polling and backoff. A timeout is an unknown state: query again before retrying so the user is not charged twice.

Return a stable record containing `job_id`, `status`, `created_at`, `outputs`, `error_code` and `next_action`. Use `download_output` only for completed outputs and avoid logging tokens or signed URLs.
