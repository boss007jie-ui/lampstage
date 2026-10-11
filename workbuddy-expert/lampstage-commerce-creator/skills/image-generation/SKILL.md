---
name: image-generation
description: Create an asynchronous Lampstage image job from a confirmed source asset and creative brief.
---

# Image generation

Confirm the source asset, goal, aspect ratio, output count and locked facts. Use the product understanding brief and write a concise prompt that preserves confirmed identity attributes without assuming a product category.

Use `create_image_job`, store the returned `job_id`, poll with `get_job`, and report output URLs only after completion. Ask the user to review shape, color, text and proportions before publication.
