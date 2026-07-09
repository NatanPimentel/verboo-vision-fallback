# Verboo Vision Fallback

Plugin para o [Verboo Code](https://github.com/verbeux-ai/code) que fornece visão a modelos de texto.

Quando o prompt contém um anexo como `[Image #1]`, o plugin localiza a imagem no cache da sessão, envia a imagem a um modelo com visão e injeta a descrição pronta no contexto do modelo principal. O fluxo não depende de o modelo principal decidir chamar uma skill.

## Como funciona

```text
Usuário envia [Image #N]
        |
        v
Hook UserPromptSubmit
        |
        +-- resolve ~/.verboo/image-cache/<session_id>/<N>.*
        +-- chama kimi-k2.7 com timeout
        +-- em caso de falha, chama qwen3.6-27b
        |
        v
Descrição entra em additionalContext
        |
        v
Modelo principal responde ao usuário
```

Se todos os modelos falharem, o hook libera o turno e instrui o modelo principal a avisar que não conseguiu analisar a imagem, sem inventar detalhes visuais.

## Instalação

Clone o repositório no diretório de plugins:

```bash
git clone https://github.com/NatanPimentel/verboo-vision-fallback.git ~/.verboo/plugins/verboo-vision-fallback
```

Ative o plugin em `~/.verboo/settings.json`:

```json
{
  "enabledPlugins": {
    "verboo-vision-fallback": true
  }
}
```

Reinicie o Verboo Code após instalar ou atualizar o plugin.

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
| `VISION_MODEL` | `ultra/kimi-k2.7` | Modelo com visão principal |
| `VISION_FALLBACK_MODELS` | `ultra/qwen3.6-27b` | Fallbacks separados por espaço ou vírgula |
| `VISION_BASE_URL` | `https://code.verboo.ai/router/v1` | Endpoint compatível com OpenAI Chat Completions |
| `VISION_API_KEY` | lida da configuração | Credencial do router Verboo |
| `VISION_TIMEOUT_MS` | `20000` | Limite por modelo, em milissegundos |
| `VISION_TOTAL_TIMEOUT_MS` | `42000` | Deadline interno de toda a cadeia, preservando margem para o hook |
| `VISION_MAX_TOKENS` | `1024` | Limite da descrição visual |
| `VERBOO_HOME` | `~/.verboo` | Diretório de dados do Verboo; útil para testes |

O hook tem limite externo de 45 segundos e deadline interno de 42 segundos. Com os padrões, Kimi pode usar até 20 segundos, Qwen pode usar até 20 segundos e ainda há margem para o hook devolver um aviso seguro.

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
| `ultra/kimi-k2.7` | Principal |
| `ultra/qwen3.6-27b` | Fallback |

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
