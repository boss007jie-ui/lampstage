---
name: video-generation
description: Analyze a reference video, create replacement reference frames, and submit an approved replication job through Hypit and RunningHub Minimax H3.
---

# Video generation

Collect the reference video, replacement product asset, preserved elements, changed elements and any audio instruction. The server uses FFmpeg to inspect and segment the reference clip, then uses the configured image provider to generate opening and ending reference frames for every segment.

Use `create_video_job`, then `prepare_video_job`. Present the generated segment frames and the RH coin estimate for user approval. Only after approval call `render_video_job`; the server-side worker sends the reviewed assets through Hypit's RunningHub Minimax H3 adapter and assembles the final video. Poll with `get_job`, surface failed or attention states clearly, and return a downloadable output only after completion. Do not expose Hypit or RunningHub credentials in Expert messages.
