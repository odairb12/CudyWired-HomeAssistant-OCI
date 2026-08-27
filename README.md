# CudyWired Home Assistant OCI

Home Assistant em uma VM da **Oracle Cloud Infrastructure (OCI)**, executado em Docker e conectado à rede residencial por **WireGuard** através de um **Cudy WR3000**. A mesma stack hospeda a integração privada com a Alexa e o **Portainer** para gestão dos containers.

A infraestrutura fica versionada no Git e os dados persistentes ficam fora do repositório em `/srv/home-automation`.

> Os endereços e faixas deste README são exemplos mascarados. A topologia operacional real deve permanecer somente no `.env` não versionado da OCI.

## Arquitetura

```text
Usuário
  |
  | voz
  v
Amazon Alexa
  |
  | HTTPS :443
  v
Caddy / OCI
  |
  | loopback :3000
  v
cudy-alexa-app
  |
  | Home Assistant REST API
  v
Home Assistant
  |
  | custom_components/cudy
  v
WireGuard
  |
  v
Cudy WR3000
  |
  +--> LAN / dispositivos residenciais
  |
  +--> WISP --> roteador da operadora --> Internet
```

A Alexa **não acessa o Cudy diretamente**. O backend fala com o Home Assistant; a custom integration Cudy acessa o LuCI privado através do WireGuard.

## Stack Docker única

Todos os serviços OCI são administrados pelo `compose.yaml` da raiz.

### Ativos por padrão

| Container | Função |
|---|---|
| `homeassistant` | Automação e entidades Cudy |
| `wireguard` | VPN site-to-site OCI ↔ residência |
| `cudy-alexa-app` | Backend da Alexa Custom Skill |
| `caddy` | HTTPS/TLS e reverse proxy da Skill |
| `portainer` | Gestão visual dos containers |

### Opcionais por profile

- Mosquitto
- Node-RED
- ESPHome
- Zigbee2MQTT

O antigo `services/cudy-alexa/compose.yaml` foi removido para evitar duas fontes de verdade. Configuração e operação usam somente o `compose.yaml` da raiz.

## Configuração

```bash
sudo apt-get update
sudo apt-get install -y git

git clone https://github.com/odairb12/CudyWired-HomeAssistant-OCI.git
cd CudyWired-HomeAssistant-OCI
cp .env.example .env
chmod 600 .env
```

O `.env.example` usa apenas ranges e endpoints de exemplo. Configure no `.env` real:

```dotenv
DATA_DIR=/srv/home-automation
TZ=America/Sao_Paulo

WG_SERVER_URL=auto
WG_SERVER_PORT=51820
WG_PEERS=cudy
WG_INTERNAL_SUBNET=10.99.0.0
WG_ALLOWED_IPS=10.99.0.1/32
HOME_LAN_CIDR=192.168.50.0/24

PUBLIC_HOSTNAME=router.example.invalid
ACME_EMAIL=admin@example.invalid
HA_URL=http://127.0.0.1:8123
HA_TOKEN=CHANGE_ME
ALEXA_SKILL_ID=CHANGE_ME
```

Nunca versione os valores reais.

## Subir a stack

```bash
sudo ./scripts/setup-home.sh

docker compose up -d --build
sudo ./scripts/validate.sh
```

Atualização:

```bash
git pull
docker compose pull
docker compose up -d --build
sudo ./scripts/validate.sh
```

## Portainer

O Portainer faz parte da stack principal e é usado para acompanhar containers, logs, restart e consumo.

A porta `9443` deve permanecer fechada publicamente. O acesso recomendado é pela VPN ou por liberação administrativa temporária restrita a uma origem específica.

## Alexa

Fluxo operacional:

```text
Alexa
 -> Caddy
 -> cudy-alexa-app
 -> Home Assistant API
 -> integração Cudy
 -> WireGuard
 -> WR3000
```

A Skill suporta consultas/check-up, Guest Wi-Fi com duração/agendamento e reboot com confirmação. Reset, firmware e mudanças de WAN/WISP/VPN/firewall permanecem bloqueados.

Documentação:

- [`docs/ALEXA-CUSTOM-SKILL.md`](docs/ALEXA-CUSTOM-SKILL.md)
- [`docs/ALEXA-CUSTOM-SKILL-SETUP.md`](docs/ALEXA-CUSTOM-SKILL-SETUP.md)

## Integração Cudy

A integração customizada está em:

```text
custom_components/cudy/
```

Ela fornece sensores, binary sensors, device trackers, Guest Wi-Fi e reboot controlado. O painel do roteador permanece privado.

## Segurança

Exposição recomendada:

| Porta | Serviço | Internet |
|---|---|---|
| UDP 51820 | WireGuard | aberta |
| TCP 80 | Caddy / ACME | apenas conforme necessário |
| TCP 443 | Alexa Skill | aberta |
| TCP 22 | SSH | fechada normalmente |
| TCP 8123 | Home Assistant | fechada |
| TCP 9443 | Portainer | fechada |
| LuCI do Cudy | administração | nunca exposta |

O Caddy aceita externamente somente `/health` e `/alexa`.

## Persistência

```text
/srv/home-automation/
├── homeassistant/config/
├── wireguard/config/
├── cudy-alexa/data/
├── caddy/data/
├── caddy/config/
├── portainer/data/
├── mosquitto/
├── nodered/
├── esphome/
└── zigbee2mqtt/
```

## Profiles opcionais

```bash
docker compose --profile mqtt up -d
docker compose --profile automation up -d
docker compose --profile esphome up -d
docker compose --profile zigbee up -d
```

## Documentação adicional

- [OCI](docs/OCI.md)
- [Cudy WR3000 e WireGuard](docs/CUDY.md)
- [Segurança](docs/SECURITY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Migração](docs/MIGRATION.md)
- [Primeiros passos Tuya / Smart Life](docs/how-to/PRIMEIROS-PASSOS.md)
- [MCP no OpenCode](docs/how-to/MCP-OPENCODE.md)
