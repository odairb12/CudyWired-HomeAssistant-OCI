# Alexa Custom Skill e Cudy

## Objetivo

A Custom Skill oferece comandos de voz e consultas do Cudy WR3000 sem Home Assistant Cloud/Nabu Casa, AWS Lambda ou hardware adicional na residência.

A arquitetura atual usa o **Home Assistant como camada central de automação**. A Alexa não acessa o LuCI diretamente: o backend consulta e aciona entidades do Home Assistant; a custom integration `cudy` acessa o roteador pelo WireGuard.

## Arquitetura

```text
Amazon Alexa
    |
    | HTTPS + assinatura Alexa
    v
PUBLIC_HOSTNAME :443
    |
    v
Caddy / OCI
    |
    | 127.0.0.1:3000
    v
cudy-alexa-app
    |
    | Home Assistant REST API
    v
Home Assistant
    |
    | custom_components/cudy
    v
WireGuard privado
    |
    v
Cudy WR3000 / LAN privada
```

## Stack Docker única

Todos os serviços OCI são administrados pelo `compose.yaml` da raiz.

| Container | Função | Exposição |
|---|---|---|
| `homeassistant` | Entidades, automações e integração Cudy | privada |
| `wireguard` | VPN site-to-site | UDP 51820 |
| `cudy-alexa-app` | Backend da Custom Skill | loopback 127.0.0.1:3000 |
| `caddy` | TLS/reverse proxy da Skill | TCP 80/443 |
| `portainer` | Gestão visual dos containers | manter privado |

Mosquitto, Node-RED, ESPHome e Zigbee2MQTT permanecem opcionais via Compose profiles.

## Segurança

- O SDK Alexa valida assinatura e timestamp.
- `ALEXA_SKILL_ID` restringe o backend à Skill esperada.
- `HA_TOKEN` fica somente no `.env` da OCI.
- A senha do Cudy pertence à config entry da integração Cudy no Home Assistant, não ao backend Alexa.
- O Caddy publica somente `/health` e `/alexa`.
- Home Assistant, Portainer, SSH e LuCI não devem ser publicados na Internet.
- WireGuard é o caminho privado OCI -> residência.

## Configuração

Use somente o `.env` da raiz do repositório:

```dotenv
PUBLIC_HOSTNAME=router.example.invalid
ACME_EMAIL=admin@example.invalid
HA_URL=http://127.0.0.1:8123
HA_TOKEN=CHANGE_ME
ALEXA_SKILL_ID=CHANGE_ME
```

Implantação:

```bash
cd /home/ubuntu/CudyWired-HomeAssistant-OCI
docker compose up -d --build
```

Validação:

```bash
docker compose ps
curl -fsS http://127.0.0.1:3000/health
curl -fsS https://PUBLIC_HOSTNAME/health
```

## Operações de voz

A policy atual permite:

- consultas de status/check-up;
- ligar Guest Wi-Fi com duração obrigatória;
- desligar Guest Wi-Fi;
- consultar/cancelar agendamentos;
- reboot com confirmação explícita.

Reset de fábrica, firmware e mudanças de WAN/WISP/VPN/firewall permanecem bloqueados.

## Portainer

O Portainer faz parte da mesma stack para gestão dos containers, logs, restart e observação operacional. Mantenha a porta 9443 acessível apenas por VPN ou origem administrativa restrita.

## Rollback da Alexa

```bash
docker compose stop caddy cudy-alexa
```

Restaurar:

```bash
docker compose up -d cudy-alexa caddy
```
