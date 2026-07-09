---
name: describe-image
description: Use PROACTIVELY when the user sends an image and the current model cannot see it directly. Pass the image file path or name. The image is processed by a vision-capable model (kimi-k2.7 by default) and the textual description is returned so the main model can use it in the response.
---

# /describe-image

Use this skill when the user sends an image and the current model does not support vision directly (e.g., glm-5.2, deepseek-v4-flash, deepseek-v4-pro, mimo-v2.5-pro, kimi-k2.7-code).

## How to invoke

```
/describe-image <file-path-or-name>
/describe-image <file-path-or-name> with question: <your question>
```

Examples:

```
/describe-image screenshot.png
/describe-image "C:\Users\Natan\Downloads\foto.jpg"
/describe-image image.png with question: What text is visible in this image?
```

## What it does

1. Resolves the image file path (tries the exact path, then Downloads, Pictures, Desktop, temp, cwd).
2. Reads the image as base64.
3. Calls the Verboo router API with a vision-capable model (default: `ultra/kimi-k2.7`).
4. Returns a detailed textual description of the image.

## Configuration (environment variables)

- `VISION_MODEL` — vision-capable model ID (default: `ultra/kimi-k2.7`)
- `VISION_BASE_URL` — Verboo router endpoint (default: `https://code.verboo.ai/router/v1`)
- `VISION_API_KEY` — API key for the vision model. If not set, the skill will try to read it from the Verboo CLI config.

## Implementation

The skill runs the script at `${CLAUDE_PLUGIN_ROOT}/scripts/describe-image.sh` with the file path (and optional question) as arguments. The script outputs the description text.

## When to use

- User sends an image and the main model returns an error like "Model does not support image inputs"
- User sends an image and the main model only sees the filename (not the content)
- User explicitly asks to describe or analyze an image

## When NOT to use

- The main model already supports vision (e.g., kimi-k2.7)
- The user did not send any image
