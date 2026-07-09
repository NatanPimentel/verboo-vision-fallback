# Verboo Vision Fallback

Plugin para o [Verboo Code](https://github.com/verbeux-ai/code) (um fork do Claude Code) que adiciona **fallback automático de visão** para modelos de texto.

Quando o usuário envia uma imagem e o modelo ativo não suporta visão (ex: `glm-5.2`, `deepseek-v4-flash`, `deepseek-v4-pro`, `mimo-v2.5-pro`, `kimi-k2.7-code`), este plugin:

1. Detecta a imagem no prompt do usuário (via hook `UserPromptSubmit`)
2. Injeta contexto instruindo o modelo a invocar a skill `/describe-image`
3. A skill roda um script bash que chama um modelo com visão (`kimi-k2.7` por padrão) via API do router Verboo
4. A descrição textual retorna para o modelo principal, que pode usá-la na resposta

Se o modelo principal falhar (404, erro de rede, etc.), o plugin tenta automaticamente os modelos de fallback na ordem: `kimi-k2.7` → `qwen3.6-27b` → `glm-5.2`.

## Instalação

### Opção 1: Clonar diretamente no diretório de plugins

```bash
git clone https://github.com/NatanPimentel/verboo-vision-fallback.git ~/.verboo/plugins/verboo-vision-fallback
```

### Opção 2: Adicionar como plugin

Adicione ao `~/.verboo/settings.json`:

```json
{
  "enabledPlugins": {
    "verboo-vision-fallback": true
  }
}
```

Depois reinicie o Verboo Code.

## Configuração

O plugin funciona out of the box. A API key é lida automaticamente do `opencode.json` (em qualquer um destes: raiz do projeto, `~/.config/opencode/opencode.json`, ou `~/.verboo/opencode.json`).

### Variáveis de ambiente (opcionais)

| Variável | Default | Descrição |
|----------|---------|-----------|
| `VISION_MODEL` | `ultra/kimi-k2.7` | ID do modelo com visão principal |
| `VISION_FALLBACK_MODELS` | `ultra/qwen3.6-27b ultra/glm-5.2` | Lista de fallbacks separados por espaço |
| `VISION_BASE_URL` | `https://code.verboo.ai/router/v1` | Endpoint do router Verboo |
| `VISION_API_KEY` | _(lido do opencode.json)_ | API key para o modelo de visão |

## Uso

Basta enviar uma imagem como faria normalmente. Se o modelo ativo não conseguir vê-la, o plugin vai instruí-lo a chamar `/describe-image` automaticamente.

Você também pode invocar a skill manualmente:

```
/describe-image screenshot.png
/describe-image "C:\Users\Natan\Downloads\foto.jpg"
/describe-image image.png with question: Qual texto está visível nesta imagem?
```

## Como funciona

```
Usuário envia imagem
    │
    ▼
Hook UserPromptSubmit (detect-image.sh)
    │  Detecta imagem no payload
    │  Injeta additionalContext: "use /describe-image"
    ▼
Modelo principal (ex: glm-5.2)
    │  Recebe apenas o nome do arquivo, chama a skill /describe-image
    ▼
describe-image.sh
    │  Resolve o caminho do arquivo (Downloads, Pictures, Desktop, temp, cwd)
    │  Lê a imagem como base64
    │  Chama a API do router Verboo com kimi-k2.7
    │  ┌──────────────────────────────────────────────────────┐
    │  │  Cadeia de fallback:                                  │
    │  │  1. kimi-k2.7 (principal)                             │
    │  │     └─ se falhar (404/5xx/rede) → tenta próximo       │
    │  │  2. qwen3.6-27b (fallback 1)                          │
    │  │     └─ se falhar → tenta próximo                      │
    │  │  3. glm-5.2 (fallback 2)                              │
    │  └──────────────────────────────────────────────────────┘
    ▼
Descrição textual retorna para o modelo principal
    │
    ▼
Modelo principal responde ao usuário com contexto da imagem
```

## Requisitos

- [Verboo Code](https://github.com/verbeux-ai/code) CLI (ou Claude Code)
- Comandos `bash`, `curl`, `base64`, `node`, `file` disponíveis no PATH
- Uma conta Verboo com acesso a modelos de visão (`kimi-k2.7`, `qwen3.6-27b` ou `glm-5.2`)

## Estrutura do plugin

```
verboo-vision-fallback/
├── .claude-plugin/
│   └── plugin.json              # Manifesto do plugin
├── hooks/
│   └── hooks.json               # Configuração do hook UserPromptSubmit
├── scripts/
│   ├── detect-image.sh          # Script do hook: detecta imagens nos prompts
│   └── describe-image.sh        # Script da skill: chama a API de visão
└── skills/
    └── describe-image/
        └── SKILL.md             # Definição da skill
```

## Modelos de visão suportados (Verboo)

Testados e confirmados funcionando:

| ID do modelo | Contexto | Notas |
|--------------|----------|-------|
| `ultra/kimi-k2.7` | 1049K | Padrão — rápido, descrições detalhadas |
| `ultra/qwen3.6-27b` | 262K | Fallback 1 |
| `ultra/glm-5.2` | 524K | Fallback 2 |

## Licença

MIT — veja [LICENSE](LICENSE).

## Agradecimentos

Inspirado no [opencode-see-image](https://github.com/alfaoz/opencode-see-image) do alfaoz, adaptado para o sistema de plugins do Verboo Code / Claude Code.
