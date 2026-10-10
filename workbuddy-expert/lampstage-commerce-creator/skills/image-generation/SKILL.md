---
name: image-generation
description: Create an asynchronous Lampstage image job with a source asset, prompt and output settings.
---

# Image generation

Before calling the tool, confirm the source asset, goal, aspect ratio, number of outputs and any locked product details. Write a concise prompt that preserves confirmed identity attributes and describes the intended composition.

Use the Lampstage MCP `create_image_job` tool. Store the returned `job_id`, poll with `get_job`, and report each output URL only after the job is complete. Ask the user to review shape, color, text and proportions before publication.
