# Segurança

[← Início](../README.md) · [OCI](OCI.md) · [Cudy e WireGuard](CUDY.md) · [Alexa](ALEXA-CUSTOM-SKILL.md) · [Troubleshooting](TROUBLESHOOTING.md)

## Princípio

A infraestrutura usa defesa em profundidade. A OCI não é mais a única barreira contra exposição acidental:

1. **Firewall local da VM**: uma tabela dedicada `inet home_automation` do `nftables` aceita `22`, `8123` e `9443` somente pela interface WireGuard `wg0`. As portas administrativas são explicitamente bloqueadas nas demais interfaces IPv4 e IPv6.
2. **OCI Security List/NSG**: deve manter a mesma política como segunda barreira.
3. **Aplicações**: Alexa e Portainer possuem controles adicionais de exposição e privilégios.

Abrir acidentalmente `22`, `8123` ou `9443` para `0.0.0.0/0` no NSG não deve tornar esses serviços alcançáveis pela Internet enquanto o firewall local estiver ativo.

## Estado recomendado

| Porta | Serviço | Internet | Host firewall |
|---|---|---|---|
| UDP 51820 | WireGuard | Aberta | Permitida |
| TCP 22 | SSH | Fechada normalmente | Somente `wg0` ou `SSH_PUBLIC_CIDR` explícito |
| TCP 8123 | Home Assistant | Fechada | Somente `wg0` |
| TCP 9443 | Portainer | Fechada | Somente `wg0` |
| TCP 8000/9000 | Portainer legado/Edge/HTTP | Fechada | Bloqueada |
| TCP 80 | ACME/HTTPS | Aberta | Permitida |
| TCP 443 | Alexa HTTPS | Aberta | Permitida |

Se acesso SSH público temporário for indispensável, defina no `.env` apenas um endereço confiável:

```dotenv
SSH_PUBLIC_CIDR=203.0.113.10/32
```

Depois execute novamente `sudo ./scripts/setup-home.sh` ou reinstale a configuração do firewall. Remova o valor assim que terminar.

## SSH

Quando existe pelo menos uma chave em `authorized_keys`, o setup instala um drop-in de hardening que:

- desativa login do usuário `root`;
- desativa autenticação por senha e keyboard-interactive;
- mantém autenticação por chave pública;
- reduz tentativas e tempo de login;
- desativa X11 forwarding, agent forwarding e túneis SSH genéricos.

TCP forwarding permanece habilitado para permitir encaminhamentos administrativos explícitos quando necessários.

A associação ao grupo `docker` é desabilitada por padrão porque esse grupo é equivalente a privilégio root. Use `sudo docker ...`. `ALLOW_DOCKER_GROUP=true` deve ser uma exceção consciente.

## Custom Skill Alexa

O endpoint público é somente:

```text
POST https://SEU-DOMINIO/alexa
```

O Caddy não publica `/health`; o diagnóstico fica local em `http://127.0.0.1:3000/health`.

Controles adicionais:

- limite de headers no Caddy;
- limite de corpo de 256 KiB no Caddy;
- guard local em Node antes do backend Alexa;
- limite de corpo também no guard;
- rate limit por origem;
- limite de requisições simultâneas;
- timeouts de cliente e upstream;
- backend original isolado em `127.0.0.1:3001`;
- validação de assinatura/timestamp da Alexa pelo adapter;
- validação do `ALEXA_SKILL_ID` pelo backend.

O container da Alexa roda como usuário `node`, somente leitura, sem capabilities Linux e com `no-new-privileges`.

## Token do Home Assistant

O Long-Lived Access Token não deve permanecer no `.env`. O setup migra um token legado para:

```text
/srv/home-automation/secrets/ha_token
```

O arquivo é montado como read-only em `/run/secrets/ha_token`. O launcher lê o token em runtime antes de iniciar o backend.

Crie o token usando um **usuário dedicado não administrador** do Home Assistant usado somente pela integração Alexa. Se o backend for comprometido, isso reduz o impacto em comparação com reutilizar o token de uma conta administrativa.

## Portainer

O Portainer possui `/var/run/docker.sock`; comprometê-lo equivale, na prática, a controle do host Docker. Por isso:

- usa HTTPS somente em `9443`;
- roda em `network_mode: host`, fazendo todo tráfego passar pelo firewall `INPUT` do host;
- `9443` é aceita somente em `wg0`;
- `8000` e `9000` são bloqueadas;
- o endereço de tunnel/Edge é ligado somente a `127.0.0.1`, evitando listener público legado;
- nunca deve ser publicado por Caddy ou liberado no NSG para a Internet.

## Containers

Os serviços principais usam versões explícitas quando uma versão portátil estável está disponível. Containers compatíveis recebem `no-new-privileges`; Alexa e Mosquitto também removem capabilities e usam filesystem read-only onde possível.

O WireGuard é a exceção deliberada: precisa de `NET_ADMIN` e `SYS_MODULE`. Essas capabilities não devem ser adicionadas aos demais serviços.

## Atualizações e supply chain

O host habilita `unattended-upgrades` para atualizações de segurança do Ubuntu.

O GitHub executa automaticamente:

- Gitleaks no histórico;
- Trivy para vulnerabilidades, segredos e misconfiguração/IaC;
- `npm audit` das dependências de produção;
- CodeQL para Python e JavaScript;
- testes, lint de shell, validação do Compose e do Caddyfile.

Actions de terceiros são pinadas por SHA. O workflow que publica a imagem Alexa aceita somente `main` e gera SBOM/provenance.

Dependabot verifica semanalmente dependências npm, GitHub Actions e a imagem base do backend Alexa.

O backend Alexa usa Node.js 24 e dependências com versões explícitas. O CI executa também os testes unitários do diálogo, duração, normalização de status e ações Guest Wi-Fi.

## Segredos

Nunca faça commit de:

- `peer_cudy.conf`;
- chaves SSH privadas;
- chaves WireGuard;
- `/srv/home-automation/secrets/`;
- token do Home Assistant;
- backups de `/srv/home-automation`;
- `.env`;
- hostname público real, e-mail ACME ou topologia/IPs operacionais quando não forem indispensáveis ao código.

O repositório mantém apenas exemplos mascarados.

## Logs

O Compose limita os logs `json-file` a três arquivos de 10 MB por container. Não registre tokens, cookies, chaves, payloads completos da Alexa ou respostas completas do Home Assistant.
