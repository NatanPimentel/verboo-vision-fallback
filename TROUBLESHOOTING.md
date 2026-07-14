# Troubleshooting — verboo-vision-fallback

## "A credencial não está configurada" no hook automático

### Causa

O plugin não encontrou uma credencial de visão. Ele procura nesta ordem:

1. Variáveis `VISION_API_KEY` / `CLAUDE_PLUGIN_OPTION_API_KEY`
2. Arquivos `opencode.json` da assinatura Verboo:
   - `./opencode.json` (diretório do projeto)
   - `~/.config/opencode/opencode.json`
   - `~/.verboo/opencode.json`
3. Padrões do router Verboo (`https://code.verboo.ai/router/v1`, `qwen3.6-27b`)

Se nenhuma credencial for encontrada, o hook falha de forma segura (fail-open).

### Solução automática (assinatura Verboo)

Se você tem uma assinatura Verboo ativa, o plugin deve funcionar automaticamente. Verifique:

```bash
node scripts/describe-image.mjs doctor
```

Saída esperada: `Doctor concluído: ... qwen3.6-27b aceitaram a imagem de teste.`

Se o arquivo `~/.config/opencode/opencode.json` existir e tiver `provider.verboo.options.apiKey`, o plugin o usará.

### Solução manual (outro provedor)

Para usar outro provedor OpenAI-compatible (ex: OpenRouter):

1. Copie `.env.example` para `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edite `.env` com sua credencial real:
   ```env
   VISION_API_KEY=sk-or-v1-...
   VISION_BASE_URL=https://openrouter.ai/api/v1
   VISION_MODEL=openai/gpt-4o
   ```

3. Para **CLI manual**, exporte as variáveis:
   ```bash
   source .env
   node scripts/describe-image.mjs doctor
   ```

4. Para o **hook automático no Verboo Code**, configure as opções do plugin na UI:
   - `api_key`: sua chave do provedor
   - `base_url`: `https://openrouter.ai/api/v1`
   - `model`: `openai/gpt-4o`

### Provedores testados

- **Verboo router** (`https://code.verboo.ai/router/v1`) com `qwen3.6-27b` — funciona automaticamente via `opencode.json`.
- **OpenRouter** (`https://openrouter.ai/api/v1`) com `openai/gpt-4o` — funciona via variáveis/opções.
