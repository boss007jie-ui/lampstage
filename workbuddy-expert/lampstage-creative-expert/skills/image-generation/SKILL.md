---
name: image-generation
description: Use when creating a Lampstage image from one source or several character, product, scene or state references, including a complete scene for later video work.
---

# Image generation

Read the [image workflow](references/multi-reference-images.md) before creating an image. Confirm the selected assets, their order and roles, goal, model, supported ratio, requested output count and authorized cost. Reuse clear prior choices and authorization. Keep confirmed appearance and product facts in the visible brief without assuming a product category.

The current MCP accepts either `asset_id` or a complete ordered `reference_assets` list of 1–6 images, plus `custom_prompt` and `image_count` (1–4 **outputs**). Four references can produce one image; do not require a pre-composed collage or set output count from reference count. Check live `image.generate` support before using the new list. Six is an application limit for both models, not a verified upstream maximum; OpenLux four/six-reference generation has not been live verified. This release advertises only square `1_1` output.

Creation starts paid image work. Submit once within the user's authorization, save the returned `job_id`, and poll that ID. An uncertain response is not permission to repeat; `list_video_jobs` cannot recover image jobs. Show completed outputs and compare the actual characters, product, scene, text and proportions with the selected sources before using an image as a video state or publishing it.

For an explicit request to save or reuse a person, read [character-library](../character-library/SKILL.md). A generated image output ID is not an uploaded asset ID. Use actual owned assets and the supported upload flow; never regenerate merely to save a character, or treat approval of a person as approval of a full video/template.
