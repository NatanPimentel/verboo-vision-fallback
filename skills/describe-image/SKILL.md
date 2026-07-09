---
name: describe-image
description: Use PROATIVAMENTE quando o usuário envia uma imagem e o modelo atual não consegue vê-la diretamente. Passe o caminho ou nome do arquivo da imagem. A imagem é processada por um modelo com visão (kimi-k2.7 por padrão, com fallback para qwen3.6-27b) e a descrição textual retorna para o modelo principal usar na resposta.
---

# /describe-image

Use esta skill quando o usuário envia uma imagem e o modelo atual não suporta visão diretamente (ex: `glm-5.2`, `deepseek-v4-flash`, `deepseek-v4-pro`, `mimo-v2.5-pro`, `kimi-k2.7-code`).

## Como invocar

```
/describe-image <caminho-ou-nome-do-arquivo>
/describe-image <caminho-ou-nome-do-arquivo> with question: <sua pergunta>
```

Exemplos:

```
/describe-image screenshot.png
/describe-image "C:\Users\Natan\Downloads\foto.jpg"
/describe-image image.png with question: Qual texto está visível nesta imagem?
```

## O que faz

1. Resolve o caminho do arquivo da imagem (tenta o caminho exato, depois Downloads, Pictures, Desktop, temp, cwd).
2. Lê a imagem como base64.
3. Chama a API do router Verboo com um modelo com visão (padrão: `ultra/kimi-k2.7`).
4. Se o modelo principal falhar (404, erro de rede), tenta o fallback: `qwen3.6-27b`.
5. Retorna uma descrição textual detalhada da imagem.

## Configuração (variáveis de ambiente)

- `VISION_MODEL` — ID do modelo com visão principal (padrão: `ultra/kimi-k2.7`)
- `VISION_FALLBACK_MODELS` — lista de fallbacks separados por espaço (padrão: `ultra/qwen3.6-27b`)
- `VISION_BASE_URL` — endpoint do router Verboo (padrão: `https://code.verboo.ai/router/v1`)
- `VISION_API_KEY` — API key para o modelo de visão. Se não definida, a skill tenta ler do config do Verboo CLI.

## Implementação

A skill roda o script em `${CLAUDE_PLUGIN_ROOT}/scripts/describe-image.sh` com o caminho do arquivo (e pergunta opcional) como argumentos. O script retorna a descrição textual.

## Quando usar

- Usuário envia uma imagem e o modelo principal retorna erro como "Model does not support image inputs"
- Usuário envia uma imagem e o modelo principal vê apenas o nome do arquivo (não o conteúdo)
- Usuário pede explicitamente para descrever ou analisar uma imagem

## Quando NÃO usar

- O modelo principal já suporta visão (ex: `kimi-k2.7`, `qwen3.6-27b`)
- Usuário não enviou nenhuma imagem
