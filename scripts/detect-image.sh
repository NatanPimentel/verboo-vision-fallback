#!/usr/bin/env bash
# detect-image.sh
# Hook: UserPromptSubmit
# Le o JSON do stdin (payload do hook do Claude Code), verifica se ha imagens
# anexadas na mensagem do usuario. Se houver, injeta instrucao no contexto
# para o modelo usar a skill /describe-image.

set -euo pipefail

INPUT="$(cat)"

# Detecta imagens no payload
HAS_IMAGE=0
if echo "$INPUT" | grep -qiE '\.(png|jpe?g|gif|webp|bmp|tiff)' 2>/dev/null; then
  HAS_IMAGE=1
elif echo "$INPUT" | grep -qiE '"type"[[:space:]]*:[[:space:]]*"image"' 2>/dev/null; then
  HAS_IMAGE=1
elif echo "$INPUT" | grep -qiE '"image"' 2>/dev/null; then
  HAS_IMAGE=1
fi

if [ "$HAS_IMAGE" -eq 0 ]; then
  exit 0
fi

# Ha imagem anexada. Injeta contexto adicional.
# Saida em JSON valido (sem depender de jq).
cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"IMPORTANTE: O usuario anexou uma imagem, mas o modelo atual pode nao suportar visao diretamente.\n\nSe voce receber apenas o nome do arquivo da imagem sem conteudo visual, NAO diga que nao pode ver. Em vez disso, invoque a skill /describe-image passando o caminho ou nome do arquivo da imagem. Essa skill usa um modelo com visao kimi-k2.7 para descrever a imagem em texto, e a descricao voltara para voce usar na resposta.\n\nExemplo de uso:\n/describe-image foto.png\n/describe-image \"C:\\Users\\Natan\\Downloads\\screenshot.png\"\n\nApos receber a descricao, responda normalmente ao usuario com base nela."}}
EOF

exit 0
