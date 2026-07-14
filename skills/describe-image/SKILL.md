---
name: describe-image
description: Use quando o usuário pedir uma análise manual de imagem, uma nova tentativa após uma falha do hook automático ou o diagnóstico explícito da configuração de visão. Aceita caminho explícito, nome de arquivo resolvível, latest ou doctor.
---

# /describe-image

O hook nativo `UserPromptSubmit` normalmente descreve os anexos antes de o modelo principal responder. Use esta skill para uma tentativa manual explícita, para recuperação após uma falha ou para executar o diagnóstico `doctor`.

## Entrada aceita

```text
/describe-image latest
/describe-image <file-path-or-resolvable-name>
/describe-image <file-path-or-resolvable-name> <question>
/describe-image doctor
```

`latest` seleciona a imagem mais recente do cache configurado. Caminhos explícitos e nomes de arquivo resolvíveis também são aceitos. Não aceite nem converta `[Image #N]` na interface manual: sem um `session_id` confiável, esse formato não pode escolher uma imagem com segurança.

## Execução

Para uma imagem, execute a CLI incluída no plugin:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/describe-image.mjs" "<file-path-or-name-or-latest>" "<optional-question>"
```

Para diagnosticar a integração, execute:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/describe-image.mjs" doctor
```

Passe a pergunta específica do usuário quando ela existir. Entregue apenas a descrição retornada pelo script e não afirme ter inspecionado detalhes ausentes nessa saída.

## Configuração e segurança

A CLI usa a mesma resolução do hook: `VISION_*` tem precedência sobre `CLAUDE_PLUGIN_OPTION_*`; defaults só existem para valores não secretos seguros. `VISION_API_KEY` tem precedência sobre `CLAUDE_PLUGIN_OPTION_API_KEY`.

`api_key` é uma opção sensível do plugin e deve ser uma credencial persistente aceita pelo endpoint configurado. O plugin não busca OAuth interno do Verboo, keychain, Credential Manager, `.credentials.json`, `opencode.json` nem arquivos internos do CLI. Se o router padrão não emitir uma credencial desse tipo, configure um endpoint externo OpenAI-compatible e a credencial dele.

`model` é obrigatório. Trate todos os IDs de modelo como valores opacos: não remova prefixos, não os normalize e não altere sua ordem. Fallbacks só são tentados na ordem configurada.

O modo `doctor` realiza chamadas externas, inclusive `GET /models` e uma inferência visual mínima para cada modelo configurado, e pode consumir créditos. Ele não deve imprimir credenciais, cabeçalhos de autorização, data URLs, base64 ou corpos remotos brutos.

Se o comando falhar, informe somente o diagnóstico resumido retornado pela CLI e peça ao usuário uma configuração ou um caminho válido. Nunca exiba, solicite ou tente recuperar a credencial do router.
