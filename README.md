# Verboo Vision Fallback

Plugin for [Verboo Code](https://github.com/verbeux-ai/code) (a fork of Claude Code) that adds **automatic vision fallback** for text-only models.

When the user sends an image and the active model doesn't support vision (e.g., `glm-5.2`, `deepseek-v4-flash`, `deepseek-v4-pro`, `mimo-v2.5-pro`, `kimi-k2.7-code`), this plugin:

1. Detects the image in the user prompt (via `UserPromptSubmit` hook)
2. Injects context instructing the model to invoke the `/describe-image` skill
3. The skill runs a bash script that calls a vision-capable model (`kimi-k2.7` by default, with `qwen3.6-27b` as fallback) via the Verboo router API
4. The textual description is returned to the main model, which can use it to respond

## Install

### Option 1: Clone directly into the plugins directory

```bash
git clone https://github.com/NatanPimentel/verboo-vision-fallback.git ~/.verboo/plugins/verboo-vision-fallback
```

### Option 2: Add as a plugin marketplace

Add to `~/.verboo/settings.json`:

```json
{
  "enabledPlugins": {
    "verboo-vision-fallback": true
  }
}
```

Then restart Verboo Code.

## Configuration

The plugin works out of the box. The API key is read automatically from `opencode.json` (any of: project root, `~/.config/opencode/opencode.json`, or `~/.verboo/opencode.json`).

### Environment variables (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `VISION_MODEL` | `ultra/kimi-k2.7` | Vision-capable model ID |
| `VISION_FALLBACK_MODEL` | `ultra/qwen3.6-27b` | Fallback model if primary returns 404 |
| `VISION_BASE_URL` | `https://code.verboo.ai/router/v1` | Verboo router endpoint |
| `VISION_API_KEY` | _(read from opencode.json)_ | API key for the vision model |

## Usage

Just send an image as you normally would. If the active model can't see it, the plugin will instruct it to call `/describe-image` automatically.

You can also invoke the skill manually:

```
/describe-image screenshot.png
/describe-image "C:\Users\Natan\Downloads\foto.jpg"
/describe-image image.png with question: What text is visible in this image?
```

## How it works

```
User sends image
    │
    ▼
UserPromptSubmit hook (detect-image.sh)
    │  Detects image in payload
    │  Injects additionalContext: "use /describe-image"
    ▼
Main model (e.g., glm-5.2)
    │  Receives only filename, calls /describe-image skill
    ▼
describe-image.sh
    │  Resolves file path (Downloads, Pictures, Desktop, temp, cwd)
    │  Reads image as base64
    │  Calls Verboo router API with kimi-k2.7
    │  (falls back to qwen3.6-27b on 404)
    ▼
Textual description returned to main model
    │
    ▼
Main model responds to user with image context
```

## Requirements

- [Verboo Code](https://github.com/verbeux-ai/code) CLI (or Claude Code)
- `bash`, `curl`, `base64`, `node`, `file` commands available in PATH
- A Verboo account with access to vision models (`kimi-k2.7` or `qwen3.6-27b`)

## Plugin structure

```
verboo-vision-fallback/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── hooks/
│   └── hooks.json               # UserPromptSubmit hook config
├── scripts/
│   ├── detect-image.sh          # Hook script: detects images in prompts
│   └── describe-image.sh        # Skill script: calls vision API
└── skills/
    └── describe-image/
        └── SKILL.md             # Skill definition
```

## Supported vision models (Verboo)

Tested and confirmed working:

| Model ID | Context | Notes |
|----------|---------|-------|
| `ultra/kimi-k2.7` | 1049K | Default — fast, detailed descriptions |
| `ultra/qwen3.6-27b` | 262K | Fallback |

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

Inspired by [opencode-see-image](https://github.com/alfaoz/opencode-see-image) by alfaoz, adapted for Verboo Code / Claude Code plugin system.
