# Changelog

Todas as mudanças relevantes deste projeto são registradas neste arquivo.

## 0.3.0

- Adiciona configuração de endpoint, credencial, modelo, fallbacks e limites pela UI do plugin ou por variáveis de ambiente.
- Marca `api_key` como opção sensível e usa somente a credencial persistente aceita pelo endpoint configurado.
- Remove dependências de OAuth, keychain, Credential Manager e arquivos internos de autenticação do CLI no código do plugin.
- Trata IDs de modelo como valores opacos, sem normalização ou substituição implícita.
- Adiciona o modo explícito `doctor`, descoberta por `/models`, verificação visual mínima e diagnósticos seguros.
- Endurece a resolução do cache de imagens, os limites de entrada e a recuperação fail-open do hook.
- Usa o hook nativo em `hooks/hooks.json`, com prazo externo de 70 segundos e prazo interno padrão de 55 segundos.
- Documenta instalação limpa, configuração, privacidade, custos, recuperação e migração de hooks manuais antigos.
