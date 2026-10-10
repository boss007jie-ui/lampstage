---
name: video-generation
description: Create a Lampstage video job from reference media, a product asset and a shot brief.
---

# Video generation

Collect the reference video or storyboard, source product asset, duration, aspect ratio, motion direction and destination channel. Separate visual intent from factual product claims.

Use `create_video_job` with a Hypit-backed preset when available. Poll with `get_job`, surface failed stages clearly, and return a downloadable output only after the server reports completion. Do not expose Hypit credentials in Expert messages.
