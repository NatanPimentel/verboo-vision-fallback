#!/usr/bin/env bash
# describe-image.sh
# Processa uma imagem usando um modelo com visao e retorna a descricao textual.
#
# Uso:
#   describe-image.sh <caminho-ou-nome-da-imagem> [question...]
#
# Env vars (opcionais):
#   VISION_MODEL            - modelo com visao principal (default: ultra/kimi-k2.7)
#   VISION_FALLBACK_MODELS  - lista de fallbacks separados por espaco
#                            (default: "ultra/qwen3.6-27b ultra/glm-5.2")
#   VISION_BASE_URL         - endpoint do router Verboo (default: https://code.verboo.ai/router/v1)
#   VISION_API_KEY          - chave da API

set -uo pipefail

if [ "$#" -lt 1 ]; then
  echo "ERRO: Uso: describe-image.sh <caminho-ou-nome-da-imagem> [question...]" >&2
  exit 1
fi

IMAGE_INPUT="$1"
shift
QUESTION=""
if [ "$#" -gt 0 ]; then
  QUESTION="$*"
fi

VISION_MODEL="${VISION_MODEL:-ultra/kimi-k2.7}"
# Cadeia de fallbacks: se o modelo principal falhar (404, 5xx, erro de rede),
# tenta cada um na ordem. Separar com espacos.
# Ordem padrao: kimi-k2.7 -> qwen3.6-27b -> glm-5.2
VISION_FALLBACK_MODELS="${VISION_FALLBACK_MODELS:-ultra/qwen3.6-27b ultra/glm-5.2}"
VISION_BASE_URL="${VISION_BASE_URL:-https://code.verboo.ai/router/v1}"

# Tenta obter a API key de varias fontes
if [ -z "${VISION_API_KEY:-}" ]; then
  for cfg in "opencode.json" "$HOME/.config/opencode/opencode.json" "$HOME/.verboo/opencode.json"; do
    if [ -f "$cfg" ]; then
      KEY=$(node -e "try{const c=require('./$cfg');console.log(c.provider?.verboo?.options?.apiKey||'')}catch(e){console.log('')}" 2>/dev/null || true)
      if [ -n "$KEY" ]; then
        VISION_API_KEY="$KEY"
        break
      fi
    fi
  done
fi

if [ -z "${VISION_API_KEY:-}" ]; then
  echo "ERRO: VISION_API_KEY nao configurada." >&2
  echo "Defina a env var VISION_API_KEY ou garanta que opencode.json tenha .provider.verboo.options.apiKey" >&2
  exit 1
fi

# Resolve o caminho da imagem
resolve_image() {
  local name="$1"

  # 1. Caminho absoluto ou relativo direto
  if [ -f "$name" ]; then
    echo "$name"
    return 0
  fi

  # 2. Procura em diretorios comuns
  local candidates=(
    "$HOME/Downloads"
    "$HOME/Pictures"
    "$HOME/Desktop"
    "$HOME/Pictures/Screenshots"
    "${TMPDIR:-/tmp}"
    "/tmp"
    "$PWD"
  )

  for dir in "${candidates[@]}"; do
    if [ -n "$dir" ] && [ -f "$dir/$name" ]; then
      echo "$dir/$name"
      return 0
    fi
  done

  return 1
}

IMAGE_PATH=$(resolve_image "$IMAGE_INPUT" || true)

if [ -z "$IMAGE_PATH" ]; then
  echo "ERRO: Nao consegui encontrar a imagem: $IMAGE_INPUT" >&2
  echo "Diretorios procurados: Downloads, Pictures, Desktop, Screenshots, temp, cwd" >&2
  exit 1
fi

# Detecta mime type usando o comando 'file' (disponivel no Git Bash)
detect_mime() {
  local file="$1"
  local mime
  mime=$(file --mime-type -b "$file" 2>/dev/null || echo "image/png")
  case "$mime" in
    image/jpeg|image/png|image/gif|image/webp|image/bmp) echo "$mime" ;;
    *) echo "image/png" ;;
  esac
}

MIME=$(detect_mime "$IMAGE_PATH")

# Le imagem como base64 (sem quebras de linha)
BASE64=$(base64 -w 0 "$IMAGE_PATH" 2>/dev/null || base64 "$IMAGE_PATH" | tr -d '\n')

if [ -z "$BASE64" ]; then
  echo "ERRO: Falha ao ler imagem como base64." >&2
  exit 1
fi

DATA_URL="data:${MIME};base64,${BASE64}"

# Prompt do usuario
USER_PROMPT="${QUESTION:-Descreva detalhadamente o conteudo desta imagem. Inclua texto visivel, cores, layout, pessoas, objetos, contexto. Se for uma UI ou screenshot, descreva todos os elementos da interface e seu estado.}"

# Remove o prefixo "ultra/" do model ID para a API
MODEL_ID="${VISION_MODEL#ultra/}"

# Monta o body da requisicao usando node (passa dados via stdin pra evitar
# estouro de argument list em imagens grandes)
BODY=$(node -e "
const fs = require('fs');
let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const [model, prompt, dataUrl] = input.split('\n');
  const body = {
    model: model,
    messages: [{
      role: 'user',
      content: [
        {type: 'text', text: prompt},
        {type: 'image_url', image_url: {url: dataUrl}}
      ]
    }],
    max_tokens: 1024
  };
  process.stdout.write(JSON.stringify(body));
});
" <<EOF
${MODEL_ID}
${USER_PROMPT}
${DATA_URL}
EOF
)

# Funcao que faz a chamada a API para um modelo especifico
call_vision_api() {
  local model_id="$1"
  local body="$2"

  # Substitui o model no body JSON (sem jq, usando node)
  local new_body
  new_body=$(echo "$body" | node -e "
let data = '';
process.stdin.on('data', c => data += c);
process.stdin.on('end', () => {
  try {
    const json = JSON.parse(data);
    json.model = process.argv[1];
    process.stdout.write(JSON.stringify(json));
  } catch (e) {
    process.stdout.write(data);
  }
});
" "$model_id")

  echo "$new_body" | curl -sS -w "\n%{http_code}" \
    -X POST "${VISION_BASE_URL}/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${VISION_API_KEY}" \
    --data-binary @- 2>&1
}

# Monta a lista de modelos a tentar, na ordem: principal + fallbacks
# (remove prefixo ultra/, duplicatas e vazios)
ALL_MODELS=$(echo "$MODEL_ID $VISION_FALLBACK_MODELS" | tr ' ' '\n' | sed 's/^ultra\///' | awk 'NF' | awk '!seen[$0]++')

HTTP_CODE=""
BODY_RESPONSE=""
SUCCESS=0

for TRY_MODEL in $ALL_MODELS; do
  RESPONSE=$(call_vision_api "$TRY_MODEL" "$BODY") || CURL_EXIT=$? || CURL_EXIT=1
  CURL_EXIT=${CURL_EXIT:-0}

  if [ "$CURL_EXIT" -ne 0 ]; then
    # Erro de rede/conexao: tenta proximo modelo
    echo "AVISO: curl falhou para $TRY_MODEL (exit $CURL_EXIT), tentando proximo..." >&2
    continue
  fi

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY_RESPONSE=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "200" ]; then
    MODEL_ID="$TRY_MODEL"
    SUCCESS=1
    break
  fi

  # Erro HTTP (404, 5xx, etc.): tenta proximo modelo
  echo "AVISO: modelo $TRY_MODEL retornou HTTP $HTTP_CODE, tentando proximo..." >&2
done

if [ "$SUCCESS" -ne 1 ]; then
  echo "ERRO: Todos os modelos de visao falharam. Ultimo HTTP: $HTTP_CODE" >&2
  echo "$BODY_RESPONSE" >&2
  exit 1
fi

# Extrai a descricao usando node
DESCRIPTION=$(echo "$BODY_RESPONSE" | node -e "
let data = '';
process.stdin.on('data', c => data += c);
process.stdin.on('end', () => {
  try {
    const json = JSON.parse(data);
    const desc = json.choices?.[0]?.message?.content || '(sem descricao)';
    process.stdout.write(desc);
  } catch (e) {
    process.stdout.write('(erro ao parsear resposta)');
  }
});
")

echo "[Descricao da imagem $(basename "$IMAGE_PATH") usando ultra/$MODEL_ID]:"
echo ""
echo "$DESCRIPTION"
