# Verboo Vision Fallback

Plugin para o [Verboo Code](https://github.com/verbeux-ai/code) que dá visão a modelos de texto.

Quando o prompt contém um anexo como `[Image #1]`, o hook localiza a imagem no cache da sessão, envia a imagem a um modelo com visão e injeta a descrição pronta no contexto do modelo principal. O fluxo não depende de o modelo principal decidir chamar uma skill.

## Como funciona

```text
Usuário envia [Image #N]
        |
        v
Hook UserPromptSubmit (registrado em ~/.verboo/settings.json)
        |
        +-- resolve ~/.verboo/image-cache/<session_id>/<N>.*
        +-- chama qwen3.6-27b com timeout
        +-- em caso de falha, chama kimi-k2.7
        |
        v
Descrição entra em additionalContext
        |
        v
Modelo principal responde ao usuário
```

Se todos os modelos falharem, o hook libera o turno e instrui o modelo principal a avisar que não conseguiu analisar a imagem, sem inventar detalhes visuais.

## Instalação

### 1. Adicione o marketplace

```bash
verboo plugin marketplace add NatanPimentel/verboo-vision-fallback
```

### 2. Instale o plugin

```bash
verboo plugin install verboo-vision-fallback@verboo-vision-fallback --scope user
```

Isso ativa o identificador qualificado em `~/.verboo/settings.json`:

```json
{
  "enabledPlugins": {
    "verboo-vision-fallback@verboo-vision-fallback": true
  }
}
```

### 3. Registre o hook manualmente

> **Importante:** o Verboo Code não carrega hooks automaticamente a partir do manifesto do plugin. Você precisa registrar o `UserPromptSubmit` diretamente em `~/.verboo/settings.json`.

Abra `~/.verboo/settings.json` e adicione a seção `hooks`:

```json
{
  "enabledPlugins": {
    "verboo-vision-fallback@verboo-vision-fallback": true
  },
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/image-hook.mjs\"",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

A variável `${CLAUDE_PLUGIN_ROOT}` é resolvida pelo Verboo Code para o diretório de instalação do plugin.

### 4. Reinicie o Verboo Code

```bash
verboo
```

## Autenticação

A credencial do router é resolvida nesta ordem:

1. variável `VISION_API_KEY`;
2. `opencode.json` do projeto atual;
3. `~/.config/opencode/opencode.json`;
4. `~/.verboo/opencode.json`.

Nos arquivos `opencode.json`, o valor esperado fica em `provider.verboo.options.apiKey`. A credencial nunca é incluída na saída do hook.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `VISION_MODEL` | `ultra/qwen3.6-27b` | Modelo com visão principal |
| `VISION_FALLBACK_MODELS` | `ultra/kimi-k2.7` | Fallbacks separados por espaço ou vírgula |
| `VISION_BASE_URL` | `https://code.verboo.ai/router/v1` | Endpoint compatível com OpenAI Chat Completions |
| `VISION_API_KEY` | lida da configuração | Credencial do router Verboo |
| `VISION_TIMEOUT_MS` | `30000` | Limite por modelo, em milissegundos |
| `VISION_TOTAL_TIMEOUT_MS` | `60000` | Deadline interno de toda a cadeia |
| `VISION_MAX_TOKENS` | `1024` | Limite da descrição visual |
| `VERBOO_HOME` | `~/.verboo` | Diretório de dados do Verboo; útil para testes |

O hook tem limite externo de 60 segundos (`timeout` em `settings.json`) e deadline interno de 60 segundos. Com os padrões, Qwen pode usar até 30 segundos, Kimi pode usar até 30 segundos e ainda há margem para o hook devolver um aviso seguro.

## Uso

O uso normal é automático: anexe uma imagem e envie a pergunta ao modelo de texto ativo.

A skill `/describe-image` continua disponível como recuperação manual:

```text
/describe-image latest
/describe-image "C:\Users\Natan\Downloads\foto.jpg"
/describe-image screenshot.png with question: Qual texto está visível?
```

`latest` usa a imagem mais recente de `~/.verboo/image-cache`. Caminhos explícitos e nomes presentes no diretório atual, Downloads, Pictures, Pictures/Screenshots ou Desktop também são aceitos.

## Modelos confirmados

| Modelo | Papel |
|---|---|
| `ultra/qwen3.6-27b` | Principal (melhor OCR no momento) |
| `ultra/kimi-k2.7` | Fallback |

Modelos como `glm-5.2`, `deepseek-v4-flash`, `deepseek-v4-pro`, `mimo-v2.5-pro` e `kimi-k2.7-code` são o público-alvo do fallback porque não processam imagens diretamente.

## Desenvolvimento

Requer Node.js 22 ou superior, a mesma versão mínima exigida pelo Verboo Code.

```bash
npm test
```

Os testes usam cache e servidor HTTP temporários; não consomem a API real.

```text
verboo-vision-fallback/
├── .claude-plugin/plugin.json
├── hooks/hooks.json
├── scripts/
│   ├── image-hook.mjs
│   ├── describe-image.mjs
│   └── vision-client.mjs
├── skills/describe-image/SKILL.md
└── tests/
```

## Licença

MIT. Inspirado no [opencode-see-image](https://github.com/alfaoz/opencode-see-image), adaptado ao cache de sessões e aos hooks do Verboo Code.
