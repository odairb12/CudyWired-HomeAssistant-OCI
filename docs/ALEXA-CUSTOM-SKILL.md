# Alexa Custom Skill e Cudy

## Objetivo

A Custom Skill oferece comandos de voz e consultas do Cudy WR3000 sem Home Assistant Cloud/Nabu Casa, AWS Lambda ou hardware adicional na residência.

A arquitetura usa o **Home Assistant como camada central de automação**. A Alexa não acessa o LuCI diretamente: o backend consulta e aciona entidades do Home Assistant; a custom integration `cudy` acessa o roteador pelo WireGuard.

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
security guard
    |
    | 127.0.0.1:3001
    v
backend Alexa
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
| `homeassistant` | Entidades, automações e integração Cudy | privada / WireGuard |
| `wireguard` | VPN site-to-site | UDP 51820 |
| `cudy-alexa-app` | Guard + backend da Custom Skill | loopback |
| `caddy` | TLS/reverse proxy da Skill | TCP 80/443 |
| `portainer` | Gestão visual dos containers | somente WireGuard |

Mosquitto, Node-RED, ESPHome e Zigbee2MQTT permanecem opcionais via Compose profiles.

## Segurança

- O SDK Alexa valida assinatura e timestamp.
- `ALEXA_SKILL_ID` restringe o backend à Skill esperada.
- O token do Home Assistant fica em arquivo privado fora do Git e do `.env`.
- Recomenda-se um usuário dedicado não administrador no Home Assistant para esse token.
- A senha do Cudy pertence à config entry da integração Cudy no Home Assistant, não ao backend Alexa.
- O Caddy publica somente `POST /alexa`.
- O guard limita corpo, taxa, concorrência e tempo de requisição.
- Home Assistant, Portainer, SSH e LuCI não são publicados na Internet.
- WireGuard é o caminho privado OCI -> residência.

## Configuração

Use o `.env` da raiz apenas para parâmetros não secretos:

```dotenv
PUBLIC_HOSTNAME=router.example.invalid
ACME_EMAIL=admin@example.invalid
HA_URL=http://127.0.0.1:8123
ALEXA_SKILL_ID=CHANGE_ME
```

O arquivo de credencial do Home Assistant fica em:

```text
/srv/home-automation/secrets/ha_token
```

Implantação:

```bash
cd /home/ubuntu/CudyWired-HomeAssistant-OCI
sudo ./scripts/setup-home.sh
docker compose up -d --build
```

Validação local:

```bash
docker compose ps
curl -fsS http://127.0.0.1:3000/health
sudo ./scripts/validate.sh
```

Não há `/health` público.

## Operações de voz

A policy atual permite:

- consultas de status/check-up;
- ligar Guest Wi-Fi com duração obrigatória;
- desligar Guest Wi-Fi;
- consultar/cancelar agendamentos;
- reboot com confirmação explícita.

Reset de fábrica, firmware e mudanças de WAN/WISP/VPN/firewall permanecem bloqueados.

## Portainer

O Portainer tem acesso privilegiado ao Docker socket. O firewall local permite `9443` somente pela interface WireGuard e bloqueia as portas legadas `8000/9000`.

## Rollback da Alexa

```bash
docker compose stop caddy cudy-alexa
```

Restaurar:

```bash
docker compose up -d cudy-alexa caddy
```
