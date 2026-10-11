---
name: video-generation
description: Analyze a reference video, prepare replacement reference frames and submit an approved replication through the Lampstage video worker.
---

# Video generation

Collect the reference video, replacement asset, preserved elements, changed elements and audio instructions. The server uses FFmpeg to inspect and segment the reference clip, then generates opening and ending reference frames for each segment.

Use `create_video_job`, then `prepare_video_job`. Present generated segment frames and the RH coin estimate for user approval. Only after approval call `render_video_job`; the server worker sends reviewed assets through Hypit's RunningHub Minimax H3 adapter and assembles the final video. Poll with `get_job`, surface failed or attention states clearly, and return a downloadable output only after completion. Never expose provider credentials.
