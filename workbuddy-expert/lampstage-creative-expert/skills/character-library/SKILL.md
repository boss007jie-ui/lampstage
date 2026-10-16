---
name: character-library
description: Use when saving, finding, updating or reusing a character, person reference, C-code or fixed character version, including character-only saves without a finished video.
---

# Character library

Read [character-workflow.md](references/character-workflow.md) before character library operations or image/video references with `character_version_id`. Check live `characters.library` availability. Use explicit user-selected images and fixed versions; do not create probe jobs or promise deterministic identity. Image composition also follows the [image workflow](../image-generation/references/multi-reference-images.md), including paired bindings and its distinct no-null rule.

Saving a C-code character is independent of saving a T-code action template or accepting a full video. A user's explicit choice to save selected character images is sufficient; do not require satisfaction with the film or repeat confirmation already given for those exact images. Saving either entity never automatically creates the other.

Keep owned asset IDs, character/version IDs, image indices and one stable `save_character.idempotency_key`. On an uncertain response, inspect list/detail first and preserve the original request. Do not invent IDs, switch the key to force a new save, or claim success without a real response.

Existing image bytes are shared by exact-file hash within one account when the server supports it. Character records are private to the account; uploaded image URLs retain the existing public-media behavior. Do not call originals private, infer facial identity deduplication, or delete historical copies.

For video reuse, also follow `video-generation`: preserve reference roles/order, actual accepted predecessor tails, new prepare/quote/budget/review, bounded polling, and full-video-plus-segment delivery. Character selection is not paid-generation consent or permission to auto-accept defects.
