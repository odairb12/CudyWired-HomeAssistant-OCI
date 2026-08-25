# CudyWired Home Assistant OCI

Home Assistant em uma VM da **Oracle Cloud Infrastructure (OCI)**, executado em Docker e conectado à rede residencial por **WireGuard** através de um **Cudy WR3000**.

A arquitetura mantém os arquivos de infraestrutura versionados no Git e os dados persistentes fora do repositório em `/srv/home-automation`.

## Estado validado

- Ubuntu 24.04 Minimal;
- `VM.Standard.E2.1.Micro` com 1 GB de RAM;
- 2 GB de swap;
- Home Assistant Container;
- Portainer CE;
- WireGuard em Docker;
- Cudy WR3000 como cliente WireGuard;
- VPN `10.13.13.0/24`;
- LAN residencial `192.168.10.0/24` roteada pelo peer Cudy;
- Home Assistant acessível pela rede do Cudy em `http://10.13.13.1:8123`;
- OCI/WireGuard alcançando dispositivos reais da LAN residencial.

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
          OCI network         10.13.13.1              |
                                   |          +--------+--------+
                                   |          |        |        |
                                   |         HA    Portainer  WireGuard
                                   |       host net             host net
                                   |
                             WireGuard VPN
                                   |
                            Cudy WR3000
                            10.13.13.2
                                   |
                         192.168.10.0/24
                                   |
                            dispositivos LAN
```

O WireGuard usa `network_mode: host`. Assim, `wg0` existe diretamente no host Ubuntu. Isso permite que o Home Assistant, que também usa host network, acesse `192.168.10.x` sem DNAT intermediário entre namespaces Docker.

Pela VPN:

| Serviço | Endereço |
|---|---|
| Home Assistant | `http://10.13.13.1:8123` |
| SSH | `ssh ubuntu@10.13.13.1` |
| Portainer | `https://10.13.13.1:9443` |

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
    └── MIGRATION.md
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

A VM deve estar em uma subnet pública com Internet Gateway e rota de Internet. Detalhes em [`docs/OCI.md`](docs/OCI.md).

### 2. Security List / NSG

Durante o bootstrap, libere SSH preferencialmente apenas para seu IP:

```text
TCP 22
Source: SEU_IP_PUBLICO/32
```

Mantenha permanentemente para a VPN:

```text
UDP 51820
Source: 0.0.0.0/0
```

Depois da instalação, mantenha `22`, `8123` e `9443` fechadas na OCI. O firewall do Ubuntu fica preparado; se precisar de acesso público temporário, basta criar uma regra OCI para seu IP `/32`.

### 3. Clonar e configurar

```bash
sudo apt-get update
sudo apt-get install -y git

git clone https://github.com/odairb12/CudyWired-HomeAssistant-OCI.git
cd CudyWired-HomeAssistant-OCI
cp .env.example .env
chmod +x scripts/*.sh
```

Padrões:

```dotenv
DATA_DIR=/srv/home-automation
TZ=America/Sao_Paulo
WG_SERVER_URL=auto
WG_SERVER_PORT=51820
WG_PEERS=cudy
WG_INTERNAL_SUBNET=10.13.13.0
WG_ALLOWED_IPS=10.13.13.1/32
HOME_LAN_CIDR=192.168.10.0/24
```

`WG_ALLOWED_IPS=10.13.13.1/32` mantém split tunnel. `HOME_LAN_CIDR` informa ao servidor WireGuard que a LAN residencial está atrás do peer `cudy`.

### 4. Provisionar

```bash
sudo ./scripts/setup-home.sh
```

O script instala pacotes básicos, 2 GB de swap, Docker Engine + Compose, `ip_forward`, `src_valid_mark`, firewall persistente, diretórios de runtime e sobe os serviços principais.

### 5. Validar

```bash
sudo ./scripts/validate.sh
```

Além dos containers, a validação verifica se `wg0` existe no host e se `192.168.10.0/24` está roteada por `wg0`.

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

No Cudy:

```text
Configurações -> VPN -> WireGuard

Ativar:         Sim
Protocolo:      Cliente WireGuard
Regra padrão:   Permitir todos os dispositivos
Site a Site:    Ativado
Política VPN:   Desativar
```

Importe o arquivo do peer e salve. Valide:

```bash
sudo docker exec wireguard wg show
```

O peer deve mostrar:

```text
allowed ips: 10.13.13.2/32, 192.168.10.0/24
latest handshake: ...
transfer: ... received, ... sent
```

Depois valide o host:

```bash
ip addr show wg0
ip route show 192.168.10.0/24
ping -c 3 192.168.10.1
```

E um dispositivo real:

```bash
ping -c 3 192.168.10.211
```

Detalhes em [`docs/CUDY.md`](docs/CUDY.md).

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

## Documentação

- [OCI](docs/OCI.md)
- [Cudy WR3000 e WireGuard](docs/CUDY.md)
- [Segurança](docs/SECURITY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Migração](docs/MIGRATION.md)
