# CudyWired Home Assistant OCI

Home Assistant em uma VM da **Oracle Cloud Infrastructure (OCI)**, executado em Docker e conectado à rede residencial por **WireGuard** através de um **Cudy WR3000**.

A infraestrutura fica versionada no Git e os dados persistentes ficam fora do repositório em `/srv/home-automation`.

> Os endereços IP e faixas mostrados neste README são exemplos mascarados. A topologia operacional real deve permanecer somente no `.env` não versionado do host.

## Estado validado

- Ubuntu 24.04 Minimal;
- `VM.Standard.E2.1.Micro` com 1 GB de RAM;
- 2 GB de swap;
- Home Assistant Container;
- Portainer CE;
- WireGuard em Docker com `network_mode: host`;
- Cudy WR3000 como cliente WireGuard;
- VPN de exemplo `10.99.0.0/24`;
- LAN de exemplo `192.168.50.0/24` roteada pelo peer Cudy;
- Home Assistant acessível pela VPN no endereço de exemplo `http://10.99.0.1:8123`;
- OCI e Home Assistant alcançando dispositivos da LAN residencial;
- Internet residencial continuando pela WAN normal do Cudy através de split tunnel.

## Arquitetura

```text
                                INTERNET
                                   |
                            UDP 51820/WireGuard
                                   |
                     +-------------v-------------+
                     |        Oracle OCI         |
                     |     IPv4 publico da VM    |
                     +-------------+-------------+
                                   |
                          Ubuntu 24.04 Minimal
                                   |
                +------------------+------------------+
                |                  |                  |
             ens3                wg0             Docker Engine
          OCI network         10.99.0.1               |
                                   |          +--------+--------+
                                   |          |        |        |
                                   |         HA    Portainer  WireGuard
                                   |       host net             host net
                                   |
                             WireGuard VPN
                                   |
                            Cudy WR3000
                            10.99.0.2
                                   |
                         192.168.50.0/24
                                   |
                            dispositivos LAN
```

O WireGuard e o Home Assistant usam a rede do host. Assim, `wg0` existe diretamente no Ubuntu e o Home Assistant consegue acessar a LAN residencial sem DNAT entre namespaces Docker.

Pela VPN, usando a faixa de exemplo:

| Serviço | Endereço |
|---|---|
| Home Assistant | `http://10.99.0.1:8123` |
| SSH | `ssh SEU_USUARIO@10.99.0.1` |
| Portainer | `https://10.99.0.1:9443` |

## Estrutura do repositório

```text
.
├── README.md
├── compose.yaml
├── .env.example
├── .gitignore
├── config/
│   └── mosquitto/
│       └── mosquitto.conf
├── scripts/
│   ├── setup-home.sh
│   ├── migrate-legacy-layout.sh
│   ├── configure-host-firewall.sh
│   └── validate.sh
├── systemd/
│   └── home-automation-firewall.service
└── docs/
    ├── OCI.md
    ├── CUDY.md
    ├── SECURITY.md
    ├── TROUBLESHOOTING.md
    ├── MIGRATION.md
    └── how-to/
        ├── PRIMEIROS-PASSOS.md
        └── MCP-OPENCODE.md
```

## Instalação rápida

### 1. Criar a VM na OCI

Configuração testada:

```text
Image:       Canonical Ubuntu 24.04 Minimal
Shape:       VM.Standard.E2.1.Micro
RAM:         1 GB
Boot volume: 50 GB
Subnet:      Public
IPv4 public: Yes
SSH key:     sua chave pública
```

A VM deve estar em subnet pública, com Internet Gateway e rota de Internet. Veja [`docs/OCI.md`](docs/OCI.md).

### 2. Security List / NSG

Durante o bootstrap, libere SSH preferencialmente somente para seu IP:

```text
TCP 22
Source: SEU_IP_PUBLICO/32
```

Mantenha permanentemente para a VPN:

```text
UDP 51820
Source: 0.0.0.0/0
```

Depois da instalação, mantenha `22`, `8123` e `9443` fechadas na OCI. O firewall do Ubuntu fica preparado; se precisar de acesso público temporário, basta abrir a porta correspondente na OCI para seu IP `/32`.

### 3. Clonar e configurar

```bash
sudo apt-get update
sudo apt-get install -y git

git clone https://github.com/odairb12/CudyWired-HomeAssistant-OCI.git
cd CudyWired-HomeAssistant-OCI
cp .env.example .env
chmod +x scripts/*.sh
```

Exemplo mascarado:

```dotenv
DATA_DIR=/srv/home-automation
TZ=America/Sao_Paulo
WG_SERVER_URL=auto
WG_SERVER_PORT=51820
WG_PEERS=cudy
WG_INTERNAL_SUBNET=10.99.0.0
WG_ALLOWED_IPS=10.99.0.1/32
HOME_LAN_CIDR=192.168.50.0/24
```

Substitua as faixas de exemplo pelas faixas reais apenas no `.env` local. `WG_ALLOWED_IPS` mantém split tunnel no peer e `HOME_LAN_CIDR` informa ao servidor WireGuard qual LAN está atrás do Cudy.

### 4. Provisionar

```bash
sudo ./scripts/setup-home.sh
```

O setup instala pacotes básicos, 2 GB de swap, Docker Engine + Compose, `ip_forward`, `src_valid_mark`, firewall persistente, diretórios de runtime e sobe os serviços principais.

### 5. Validar

```bash
sudo ./scripts/validate.sh
```

A saída normal é curta e retorna `STATUS: OK` ou `STATUS: ERRO`.

Para diagnóstico detalhado:

```bash
sudo ./scripts/validate.sh --verbose
```

## Containers

Ativos por padrão:

```text
homeassistant
portainer
wireguard
```

Preparados, mas desligados via Compose profiles:

```text
mosquitto
nodered
esphome
zigbee2mqtt
```

Ativação sob demanda:

```bash
sudo docker compose --profile mqtt up -d
sudo docker compose --profile automation up -d
sudo docker compose --profile esphome up -d
sudo docker compose --profile zigbee up -d
```

## Configurar o Cudy WR3000

Após o primeiro start, o peer é gerado em:

```text
/srv/home-automation/wireguard/config/peer_cudy/peer_cudy.conf
```

Esse arquivo contém chave privada e não deve ser enviado ao Git ou compartilhado.

Importe o arquivo em:

```text
Configurações -> VPN -> WireGuard
```

Depois configure o WR3000 usando as faixas definidas no seu `.env`. Exemplo mascarado:

```text
Ativar:         Sim
Protocolo:      Cliente WireGuard
Regra padrão:   Permitir todos os dispositivos
Site a Site:    Ativado
Política VPN:   Sub-rede remota

Sub-rede remota:
Regra:          Permitir somente os listados
Endereço IP:    10.99.0.0
Máscara:        255.255.255.0
```

Essa política é importante. No firmware testado, deixar a política VPN desativada fez o roteador aplicar a VPN de forma ampla aos clientes e interrompeu a navegação normal da casa.

O comportamento correto é:

```text
FAIXA_WIREGUARD -> WireGuard -> OCI
outros destinos -> WAN normal do Cudy
```

Confirme também o peer gerado:

```bash
sudo grep -E '^AllowedIPs' /srv/home-automation/wireguard/config/peer_cudy/peer_cudy.conf
```

O valor deve corresponder ao `WG_ALLOWED_IPS` definido no `.env`.

Valide o servidor:

```bash
sudo docker exec wireguard wg show
```

O peer deve mostrar as faixas configuradas no seu ambiente, além de handshake e tráfego recentes.

Valide as rotas usando os IPs reais do seu `.env` e da sua LAN:

```bash
ip addr show wg0
ip route show "$HOME_LAN_CIDR"
ip route get IP_DE_UM_DISPOSITIVO_LAN
```

A rota deve usar `dev wg0`.

Depois teste um dispositivo real:

```bash
ping -c 3 IP_DE_UM_DISPOSITIVO_LAN
```

E confirme que o Home Assistant enxerga a mesma rota:

```bash
sudo docker exec homeassistant ip route get IP_DE_UM_DISPOSITIVO_LAN
```

Por fim, conectado ao Cudy, valide simultaneamente:

```text
Internet normal pela WAN        OK
Home Assistant pela VPN         OK
```

Veja o procedimento detalhado em [`docs/CUDY.md`](docs/CUDY.md).

## Segurança

A política é:

```text
Firewall Ubuntu -> serviços preparados
OCI Security List / NSG -> exposição pública
```

Estado recomendado:

| Porta | Serviço | Internet |
|---|---|---|
| UDP 51820 | WireGuard | Aberta |
| TCP 22 | SSH | Fechada normalmente |
| TCP 8123 | Home Assistant | Fechada normalmente |
| TCP 9443 | Portainer | Fechada normalmente |

Se precisar de acesso direto, abra temporariamente a porta desejada com `Source = SEU_IP_PUBLICO/32`.

## Persistência

```text
/srv/home-automation/
├── homeassistant/config/
├── portainer/data/
├── wireguard/config/
├── mosquitto/data/
├── mosquitto/log/
├── nodered/data/
├── esphome/config/
├── zigbee2mqtt/data/
└── backups/
```

O Boot Volume da OCI é persistente entre reboot/stop/start. Ao terminar uma instância, confira as opções de preservação do volume.

## Atualização

```bash
git pull
sudo docker compose pull
sudo docker compose up -d
sudo ./scripts/validate.sh
```

O Home Assistant usa `stop_grace_period: 90s`. Os logs Docker têm rotação de 10 MB / 3 arquivos por container.

## Migração do layout legado

Se a instalação anterior ainda usa `/opt/home-automation`:

```bash
sudo ./scripts/migrate-legacy-layout.sh
sudo ./scripts/setup-home.sh
```

Não remova o diretório antigo até validar Home Assistant, handshake WireGuard e acesso pelo Cudy. Consulte [`docs/MIGRATION.md`](docs/MIGRATION.md).

## How to

Guias práticos para configuração e uso do ambiente:

1. [Primeiros passos - configurar dispositivos Tuya / Smart Life](docs/how-to/PRIMEIROS-PASSOS.md)
2. [MCP - habilitar um Agent no OpenCode](docs/how-to/MCP-OPENCODE.md)

## Documentação

- [OCI](docs/OCI.md)
- [Cudy WR3000 e WireGuard](docs/CUDY.md)
- [Segurança](docs/SECURITY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Migração](docs/MIGRATION.md)
