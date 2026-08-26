# Alexa Custom Skill e Cudy

## Objetivo

Este projeto pode oferecer comandos de voz e consultas de status do Cudy WR3000 sem usar Home Assistant Cloud, Nabu Casa, AWS Lambda, uma Smart Home Skill ou qualquer hardware adicional na residência.

O Home Assistant continua sendo um serviço independente do ambiente. A integração Alexa descrita aqui não depende dele.

## Arquitetura

```text
Amazon Alexa
    |
    | HTTPS + assinatura Alexa
    v
home-d20.duckdns.org:443
    |
    v
Caddy (OCI, portas 80/443)
    |
    | loopback 127.0.0.1:3000
    v
Serviço Docker cudy-alexa
    |
    | WireGuard privado (wg0)
    v
Cudy WR3000 - 192.168.10.1
```

A interface LuCI do Cudy continua privada na LAN. Ela não recebe portas públicas nem encaminhamento da Internet. O serviço na OCI é o único componente que consulta o roteador pelo túnel WireGuard.

## Componentes implantados

O serviço operacional fica em `/home/ubuntu/cudy-alexa` na OCI e possui dois containers em `network_mode: host`:

| Componente | Função | Escuta |
|---|---|---|
| `cudy-alexa-app` | Autentica no LuCI e responde à Custom Skill | `127.0.0.1:3000` |
| `caddy` | TLS público e proxy reverso | `:80`, `:443` |

O Caddy obtém e renova automaticamente o certificado TLS do Let's Encrypt para `home-d20.duckdns.org`. A porta 80 é usada apenas para desafio ACME e redirecionamento HTTPS.

## Segurança

- O endpoint da skill é `https://home-d20.duckdns.org/alexa`.
- O SDK Alexa valida assinatura e timestamp das requisições antes de o backend processá-las.
- Credenciais do Cudy ficam somente no arquivo `.env` local da OCI, com permissão restritiva; nunca entram no Git.
- O Caddy não publica `/cgi-bin/luci/`, Home Assistant (`8123`) nem Portainer (`9443`).
- As regras públicas necessárias são apenas TCP `80` e `443`; WireGuard continua em UDP `51820`.
- Não exponha SSH, LuCI, Home Assistant ou Portainer à Internet.

## Integração com Alexa Developer Console

Crie uma **Custom Skill** e use:

```text
Endpoint HTTPS: https://home-d20.duckdns.org/alexa
Tipo: Custom
Nome de invocação sugerido: minha rede
Intent: NetworkStatusIntent
```

Frases de exemplo:

```text
como está a rede
qual o status da internet
quantos dispositivos estão conectados
```

A skill deve ser testada somente após `https://home-d20.duckdns.org/health` responder JSON com `ok: true` e apresentar certificado público válido.

## Verificação operacional

Na OCI:

```bash
cd /home/ubuntu/cudy-alexa
docker compose ps
curl -fsS https://home-d20.duckdns.org/health
curl -fsS http://127.0.0.1:3000/status
```

O primeiro comando valida o proxy/TLS. O segundo confirma a consulta privada ao Cudy pelo WireGuard. Não inclua senha, cookie, token ou saída de login em tickets, commits ou logs.

## Rollback

Para interromper somente a Custom Skill, sem alterar WireGuard ou Home Assistant:

```bash
cd /home/ubuntu/cudy-alexa
docker compose down
```

Isso libera as portas 80/443 e não altera a configuração do Cudy. Para remover a exposição pública correspondente, remova também as regras TCP 80/443 da Security List/NSG da OCI e do firewall local, após confirmar que nenhum outro serviço depende delas.

## Fonte versionada e implantação

A configuração do serviço está versionada em `services/cudy-alexa/`. O arquivo `.env` permanece exclusivamente na OCI e é ignorado pelo Git.

Para implantar uma atualização:

```bash
cd /home/ubuntu/CudyWired-HomeAssistant-OCI
cp -a services/cudy-alexa /home/ubuntu/cudy-alexa
cd /home/ubuntu/cudy-alexa
cp .env.example .env
chmod 600 .env
# preencher CUDY_PASSWORD somente no .env local
docker compose up -d --build
```

O cliente reutiliza a sessão LuCI e só executa novo login quando identifica expiração. O endpoint `/status` é diagnóstico local; o Caddy permite da Internet apenas `/health` e `/alexa`.
