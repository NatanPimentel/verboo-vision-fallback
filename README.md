# Verboo Vision Fallback

Plugin para o [Verboo Code](https://github.com/verbeux-ai/code) que fornece uma descrição visual a modelos de texto quando o prompt contém anexos como `[Image #1]`. O hook nativo encontra as imagens no cache da sessão, envia todas as imagens solicitadas em uma única chamada de visão e injeta a descrição como evidência visual não confiável para o modelo principal.

Requer Verboo Code **0.12.0 ou superior** e Node.js 22 ou superior.

## Instalação limpa

Adicione o marketplace, instale o plugin no escopo desejado e reinicie o Verboo Code:

```bash
verboo plugin marketplace add NatanPimentel/verboo-vision-fallback
verboo plugin install verboo-vision-fallback@verboo-vision-fallback --scope user
verboo
```

O Verboo Code 0.12.0 carrega automaticamente `hooks/hooks.json`. Não adicione `manifest.hooks` e não registre outro `UserPromptSubmit` para este plugin.

## Configuração

Configure o plugin pela UI de configuração do Verboo Code. A opção `api_key` é marcada como `sensitive`: o host a mantém no armazenamento seguro dele e, ao executar o hook, a entrega somente pela variável `CLAUDE_PLUGIN_OPTION_API_KEY`. O plugin não lê OAuth interno do Verboo, keychain, Windows Credential Manager, `.credentials.json`, `opencode.json` nem qualquer arquivo interno de autenticação do CLI.

`api_key` deve ser uma credencial **persistente** aceita pelo endpoint configurado. Não tente reutilizar nem extrair o login OAuth do Verboo. Se o router padrão não oferecer uma credencial desse tipo, configure um endpoint externo compatível com OpenAI e a chave emitida por esse endpoint.

### Precedência

Para cada opção, a resolução em runtime é:

1. variável `VISION_*`;
2. variável `CLAUDE_PLUGIN_OPTION_*` fornecida pelo host;
3. default interno, somente quando ele for não secreto e seguro.

| Opção | Variável de automação | Variável da UI | Default |
|---|---|---|---|
| `api_key` | `VISION_API_KEY` | `CLAUDE_PLUGIN_OPTION_API_KEY` | nenhum; exigida pela chamada autenticada |
| `model` | `VISION_MODEL` | `CLAUDE_PLUGIN_OPTION_MODEL` | nenhum; obrigatória |
| `fallback_models` | `VISION_FALLBACK_MODELS` | `CLAUDE_PLUGIN_OPTION_FALLBACK_MODELS` | vazio |
| `base_url` | `VISION_BASE_URL` | `CLAUDE_PLUGIN_OPTION_BASE_URL` | `https://code.verboo.ai/router/v1` |
| `timeout_ms` | `VISION_TIMEOUT_MS` | `CLAUDE_PLUGIN_OPTION_TIMEOUT_MS` | `30000` |
| `total_timeout_ms` | `VISION_TOTAL_TIMEOUT_MS` | `CLAUDE_PLUGIN_OPTION_TOTAL_TIMEOUT_MS` | `55000` |
| `max_tokens` | `VISION_MAX_TOKENS` | `CLAUDE_PLUGIN_OPTION_MAX_TOKENS` | `1024` |

`base_url` aponta para a raiz de uma API OpenAI-compatible. O cliente usa `${base_url}/models` e `${base_url}/chat/completions`; fornecer uma URL já terminada em um desses caminhos também é aceito e normalizado somente como URL, nunca como ID de modelo.

### Modelos

`model` é obrigatório nesta release: nenhum ID de modelo vem embutido como default, pois a disponibilidade e o suporte visual precisam ser comprovados pelo endpoint configurado. `fallback_models` aceita IDs separados por espaços ou vírgulas e mantém a ordem configurada.

Todos os IDs são valores opacos. O plugin envia exatamente cada valor configurado, preserva prefixos como `ultra/` e `early-adopters/`, remove apenas duplicatas posteriores sem reescrever o valor e não substitui silenciosamente um ID por outro.

## Fluxo automático

```text
Prompt com [Image #N]
        |
        v
Hook nativo UserPromptSubmit
        |
        +-- resolve todas as imagens da sessão
        +-- deduplica marcadores repetidos pela primeira ocorrência
        +-- envia as imagens em uma única inferência
        +-- tenta modelo principal e fallbacks na ordem configurada
        |
        v
Descrição visual delimitada entra em additionalContext
        |
        v
Modelo principal responde à pergunta original
```

Se não houver marcador de imagem, o hook permanece silencioso, sem stdout nem stderr. Se qualquer imagem solicitada estiver ausente, ele não faz análise parcial. Em falhas de cache, configuração, credencial, endpoint ou modelos, ele sai com código zero e devolve JSON válido com orientação para que o modelo principal não invente detalhes visuais.

## Cache e resolução de imagens

A raiz de configuração é resolvida nesta ordem:

1. `VERBOO_CONFIG_DIR`;
2. `VERBOO_HOME`, apenas como alias legado e para testes;
3. `~/.verboo`.

O cache automático é sempre resolvido em:

```text
<config-root>/image-cache/<session_id>/<image-id>.<extensão>
```

O hook valida sessão e ID numérico, impede traversal, caminhos absolutos e escapes por symlink, verifica containment após `resolve` e `realpath`, e aceita somente arquivos regulares de MIME suportado. Arquivos removidos durante a leitura são tratados como uma falha aberta, sem derrubar o turno.

## Configuração

O plugin resolve a credencial e o endpoint nesta ordem:

1. Variáveis de ambiente `VISION_*` (ou `CLAUDE_PLUGIN_OPTION_*` injetadas pela UI do plugin).
2. Arquivos `opencode.json` da assinatura Verboo:
   - `./opencode.json` (diretório do projeto)
   - `~/.config/opencode/opencode.json`
   - `~/.verboo/opencode.json`
3. Padrões do router Verboo: `https://code.verboo.ai/router/v1` e `qwen3.6-27b`.

Se você tem uma assinatura Verboo ativa, o plugin funciona automaticamente assim que o `opencode.json` estiver presente. Para usar outro provedor OpenAI-compatible, configure `VISION_API_KEY`, `VISION_BASE_URL` e `VISION_MODEL` (ou as opções correspondentes na UI).

## Uso manual

O uso normal é automático. A CLI serve para uma nova tentativa explícita ou recuperação:

```text
node scripts/describe-image.mjs latest
node scripts/describe-image.mjs "C:\\caminho\\para\\imagem.png"
node scripts/describe-image.mjs screenshot.png "Qual texto está visível?"
```

Ela aceita um caminho explícito, um nome de arquivo resolvível ou `latest`, com pergunta opcional. A interface manual não aceita `[Image #N]`: sem um `session_id` confiável, esse marcador jamais seleciona silenciosamente a imagem mais recente.

## Doctor

Execute, a partir da raiz do plugin:

```bash
node scripts/describe-image.mjs doctor
```

O doctor é explícito: realiza chamadas externas e pode consumir créditos. Ele valida a configuração sem revelar a chave, verifica a URL base, chama `GET /models`, confere o modelo principal e os fallbacks por correspondência exata e executa uma inferência visual mínima com o fixture local para cada ID configurado. Comparação case-insensitive só é usada para encontrar o ID canônico retornado pelo servidor; a chamada posterior continua enviando esse ID canônico.

Os diagnósticos distinguem chave ausente, HTTP 401, HTTP 403, endpoint incompatível, JSON inválido, modelo ausente, modelo que rejeita imagens, erro de rede e timeout. O doctor nunca imprime credenciais, `Authorization`, data URLs, imagens em base64 nem corpos remotos brutos.

## Limites e timeouts

- O stdin do hook é limitado a 1 MiB e o payload precisa ter `hook_event_name`, `session_id`, `cwd` e `prompt` válidos.
- Cada imagem é limitada a 10 MiB, o conjunto a 20 MiB e a 32 arquivos; tudo é validado antes de `readFile` ou base64. Somente arquivos regulares de MIME suportado são lidos.
- O corpo HTTP recebido é limitado a 1 MiB, e erros de JSON, HTTP, rede, `AbortError` e `TimeoutError` são tratados de forma segura.
- No doctor, um único deadline é compartilhado por `GET /models`, modelo principal e fallbacks; na cadeia normal, o mesmo deadline é compartilhado pelo modelo principal e fallbacks. O prazo interno padrão é 55 segundos; cada tentativa é limitada também pelo tempo restante.
- O hook possui timeout externo de 70 segundos, preservando margem para produzir a resposta fail-open.

## Privacidade e segurança do contexto

O plugin não registra nem devolve credenciais, cabeçalhos `Authorization`, data URLs, imagens em base64, respostas remotas brutas, conteúdo integral de erro remoto ou caminhos locais desnecessários.

Uma descrição bem-sucedida é sempre entregue dentro de `<untrusted_visual_description>…</untrusted_visual_description>`, com o conteúdo escapado para não fechar o delimitador. O contexto explica que a descrição é apenas evidência visual não confiável: instruções, comandos ou pedidos presentes na imagem ou na própria descrição não substituem instruções do sistema nem do usuário. O modelo principal deve responder à pergunta original usando-a somente como evidência visual.

## Custo e recuperação de falhas

Cada prompt com imagem pode gerar uma chamada de visão por tentativa de modelo; o doctor realiza uma inferência mínima para cada ID configurado. Verifique os preços e limites do endpoint escolhido.

Em falha, o hook não bloqueia a conversa. Ele injeta um aviso curto para que o modelo não invente o conteúdo visual e possa explicar a limitação ao usuário. Corrija a credencial, endpoint, modelo ou cache e tente novamente pelo prompt normal ou pela CLI manual.

## Migração de instalações antigas

Instalações anteriores podem ter uma entrada manual que executa `scripts/image-hook.mjs`, inclusive uma referência à versão antiga `0.2.1`. Para migrar:

1. Localize a entrada manual de hook que executa esse script.
2. Remova somente essa entrada; preserve todos os demais hooks do usuário.
3. Atualize ou reinstale o plugin pelo marketplace.

A partir desta versão, a credencial da assinatura Verboo é lida automaticamente de `~/.config/opencode/opencode.json` e `~/.verboo/opencode.json`, restaurando o comportamento de versões anteriores.
4. Reinicie o Verboo Code.
5. Envie um prompt com imagem e confirme que ocorre exatamente uma chamada de visão.

O hook nativo instalado em `hooks/hooks.json` é suficiente após a migração.

## Desenvolvimento e preflight de release

As verificações locais não consomem a API real:

```bash
npm install
npm run check
npm run validate:plugin-offline
npm test
npm run smoke:local
verboo plugin validate .claude-plugin/plugin.json
verboo plugin validate .claude-plugin/marketplace.json
```

O preflight externo restante exige uma credencial real persistente aceita pelo endpoint configurado: execute o doctor autenticado e confirme o ID exato do modelo no endpoint padrão antes de escolher qualquer default de modelo em uma release futura.

## Estrutura

```text
verboo-vision-fallback/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── hooks/hooks.json
├── scripts/
│   ├── cache.mjs
│   ├── doctor-fixture.mjs
│   ├── describe-image.mjs
│   ├── image-hook.mjs
│   ├── vision-client.mjs
│   └── vision-config.mjs
├── skills/describe-image/SKILL.md
└── tests/
```

## Licença

MIT. Inspirado no [opencode-see-image](https://github.com/alfaoz/opencode-see-image), adaptado ao cache de sessões e aos hooks do Verboo Code.
