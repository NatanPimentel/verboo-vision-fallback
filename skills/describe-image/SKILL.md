---
name: describe-image
description: Use quando o usuário pedir explicitamente uma nova análise manual da imagem ou quando o hook automático de visão do Verboo informar que não conseguiu descrever um anexo. Aceita caminho, nome de arquivo ou latest.
---

# /describe-image

O hook automático `UserPromptSubmit` normalmente descreve os anexos antes de o modelo principal responder. Use esta skill somente para uma nova tentativa manual ou quando o usuário pedir explicitamente outra análise.

## Entrada

Aceite um destes formatos:

```text
/describe-image latest
/describe-image <file-path-or-name>
/describe-image <file-path-or-name> with question: <question>
```

Se não houver um caminho utilizável, use `latest` para selecionar a imagem mais recente do cache do Verboo.

## Execução

Execute a CLI Node.js incluída no plugin com Bash:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/describe-image.mjs" "<file-path-or-latest>" "<question>"
```

Passe a pergunta específica do usuário quando ela existir. Entregue a descrição retornada pelo script e não afirme ter inspecionado detalhes ausentes nessa saída.

A CLI usa primeiro `ultra/kimi-k2.7` e depois `ultra/qwen3.6-27b` como fallback. Ela resolve caminhos explícitos, diretórios comuns do usuário e `latest` em `~/.verboo/image-cache`.

Se o comando falhar, informe o erro resumido e peça ao usuário um caminho válido. Nunca exiba nem solicite a credencial configurada do router.
