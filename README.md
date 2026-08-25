# CudyWired Home Assistant OCI

Home Assistant em uma VM da **Oracle Cloud Infrastructure (OCI)**, executado em Docker e conectado à rede residencial por **WireGuard** através de um **Cudy WR3000**.

O projeto foi estruturado para que a VM possa ser reconstruída de forma reproduzível: o `compose.yaml` é a fonte de verdade dos containers, o `setup-home.sh` prepara o host e os dados persistentes ficam fora do repositório em `/srv/home-automation`.

## Estado validado

A topologia foi validada com:

- Ubuntu 24.04 Minimal;
- `VM.Standard.E2.1.Micro` com 1 GB de RAM;
- 2 GB de swap;
- Home Assistant Container;
- Portainer CE;
- WireGuard em Docker;
- Cudy WR3000 como cliente WireGuard;
- Home Assistant acessível pela rede do Cudy em `http://10.13.13.1:8123`.

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
                                Docker
                    +--------------+--------------+
                    |              |              |
              Home Assistant    Portainer      WireGuard
                host:8123       host:9443      10.13.13.1
                    |              |              |
                    +--------------+--------------+
                                                  |
                                             VPN criptografada
                                                  |
                                           +------v------+
                                           | Cudy WR3000 |
                                           | 10.13.13.2  |
                                           +------+------+
                                                  |
                                           192.168.10.0/24
```

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
├── compose.yaml                 # Orquestração Docker
├── .env.example                 # Configuração sem segredos
├── config/
│   └── mosquitto/
│       └── mosquitto.conf
├── scripts/
│   ├── setup-home.sh            # Provisionamento idempotente do host
│   ├── configure-host-firewall.sh
│   ├── wireguard-post-start.sh  # DNAT VPN -> serviços do host
│   └── validate.sh
├── systemd/
│   └── home-automation-firewall.service
└── docs/
    ├── OCI.md
    ├── CUDY.md
    ├── SECURITY.md
    └── TROUBLESHOOTING.md
```

A organização separa **infraestrutura**, **configuração**, **scripts operacionais**, **persistência** e **documentação**, evitando gerar Compose ou arquivos de configuração dentro de um script monolítico.

---

# Instalação rápida

## 1. Criar a VM na OCI

Resumo da configuração testada:

```text
Image:       Canonical Ubuntu 24.04 Minimal
Shape:       VM.Standard.E2.1.Micro
RAM:         1 GB
Boot volume: 50 GB
Subnet:      Public
IPv4 public: Yes
SSH key:     sua chave pública
```

A VM deve estar em uma **subnet pública** com Internet Gateway e rota de Internet. Veja o passo a passo completo em [`docs/OCI.md`](docs/OCI.md).

## 2. Security List / NSG

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

Por padrão, deixe **22, 8123 e 9443 fechadas na OCI** depois da instalação. O host continua preparado para essas portas; se precisar de acesso público emergencial, basta criar temporariamente uma regra OCI para seu IP `/32`.

## 3. Conectar por SSH

```bash
ssh -i sua-chave.key ubuntu@IP_PUBLICO_OCI
```

## 4. Clonar o projeto

```bash
sudo apt-get update
sudo apt-get install -y git

git clone https://github.com/odairb12/CudyWired-HomeAssistant-OCI.git
cd CudyWired-HomeAssistant-OCI
```

## 5. Configuração

Crie `.env` a partir do exemplo:

```bash
cp .env.example .env
```

Os padrões já correspondem ao ambiente validado:

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

`WG_ALLOWED_IPS=10.13.13.1/32` mantém **split tunnel**: somente o endereço VPN da OCI é roteado pelo túnel, em vez de enviar toda a Internet da casa através da Oracle.

`HOME_LAN_CIDR` anuncia a LAN atrás do Cudy no lado servidor para o cenário site-to-site.

## 6. Provisionar tudo

```bash
chmod +x scripts/*.sh
sudo ./scripts/setup-home.sh
```

O script:

1. instala os pacotes básicos e OpenSSH;
2. cria 2 GB de swap;
3. habilita IP forwarding;
4. instala Docker Engine e Compose Plugin pelo repositório oficial;
5. cria os diretórios persistentes em `/srv/home-automation`;
6. instala um serviço systemd idempotente para o firewall local;
7. valida `compose.yaml`;
8. baixa as imagens principais;
9. sobe Home Assistant, Portainer e WireGuard;
10. aguarda o Home Assistant ficar disponível e executa validações.

## 7. Containers

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

Verifique:

```bash
sudo ./scripts/validate.sh
```

---

# Configurar o Cudy WR3000

Após o primeiro start do WireGuard, o peer é gerado em:

```text
/srv/home-automation/wireguard/config/peer_cudy/peer_cudy.conf
```

Esse arquivo contém **chave privada**. Nunca o envie para Git nem o compartilhe.

Copie temporariamente para o usuário Ubuntu:

```bash
sudo cp /srv/home-automation/wireguard/config/peer_cudy/peer_cudy.conf /home/ubuntu/cudy.conf
sudo chown ubuntu:ubuntu /home/ubuntu/cudy.conf
sudo chmod 600 /home/ubuntu/cudy.conf
```

Baixe para seu computador:

```powershell
scp -i .\sua-chave.key ubuntu@IP_PUBLICO_OCI:/home/ubuntu/cudy.conf .\
```

No Cudy:

```text
Configurações
  -> VPN
  -> WireGuard
```

Use:

```text
Ativar:         Sim
Protocolo:      Cliente WireGuard
Regra padrão:   Permitir todos os dispositivos
Site a Site:    Ativado
Política VPN:   Desativar
```

Importe `cudy.conf` em **Arquivo de configuração** e clique em **Salvar & Aplicar**.

Valide na OCI:

```bash
sudo docker exec wireguard wg show
```

O peer deve mostrar `latest handshake` recente e contadores de `transfer` aumentando.

Depois, conectado à rede do Cudy, abra:

```text
http://10.13.13.1:8123
```

Detalhes: [`docs/CUDY.md`](docs/CUDY.md).

---

# Segurança e exposição pública

A política do projeto é deliberadamente simples:

```text
Firewall do Ubuntu -> deixa os serviços preparados
OCI Security List  -> decide o que a Internet pode alcançar
```

Estado recomendado na OCI:

| Porta | Serviço | Internet |
|---|---|---|
| UDP 51820 | WireGuard | Aberta |
| TCP 22 | SSH | Fechada normalmente |
| TCP 8123 | Home Assistant | Fechada normalmente |
| TCP 9443 | Portainer | Fechada normalmente |

Se precisar acessar diretamente pela Internet, abra temporariamente a porta desejada com `Source = SEU_IP_PUBLICO/32`, use o serviço e remova a regra.

Mais detalhes em [`docs/SECURITY.md`](docs/SECURITY.md).

---

# Persistência

Os arquivos de infraestrutura permanecem no Git. Os dados de runtime ficam fora do repositório:

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

Isso permite atualizar ou reclonar o projeto sem misturar código com banco, configurações do Home Assistant ou chaves do WireGuard.

O Boot Volume da OCI é persistente entre reboot/stop/start. Ao **terminar a instância**, confira as opções de preservação do volume antes de apagar a VM.

---

# Serviços opcionais

MQTT/Mosquitto:

```bash
sudo docker compose --profile mqtt up -d
```

Node-RED:

```bash
sudo docker compose --profile automation up -d
```

ESPHome:

```bash
sudo docker compose --profile esphome up -d
```

Zigbee2MQTT:

```bash
sudo docker compose --profile zigbee up -d
```

Em uma VM de 1 GB, acompanhe a memória antes de habilitar componentes extras:

```bash
sudo docker stats --no-stream
free -h
```

---

# Atualização

```bash
git pull
sudo docker compose pull
sudo docker compose up -d
sudo ./scripts/validate.sh
```

O Home Assistant tem `stop_grace_period: 90s` para reduzir a chance de encerramento abrupto do SQLite durante recriações/atualizações.

Os logs Docker usam rotação (`10 MB`, 3 arquivos por container) para evitar crescimento indefinido no Boot Volume.

---

# Backup

Exemplo:

```bash
sudo tar -czf /home/ubuntu/home-automation-$(date +%Y%m%d-%H%M%S).tar.gz \
  /srv/home-automation
```

O backup contém **chaves WireGuard e dados sensíveis do Home Assistant**. Proteja-o como segredo.

---

# Integrações Home Assistant

## Tuya

No Home Assistant:

```text
Settings -> Devices & services -> Add integration -> Tuya
```

A integração oficial Tuya usa a infraestrutura cloud da Tuya; hospedar o Home Assistant na OCI não transforma automaticamente esses dispositivos em locais.

## Alexa

As opções principais são Home Assistant Cloud ou a configuração manual da integração Alexa Smart Home. A segunda exige arquitetura adicional para endpoint HTTPS e não faz parte do bootstrap deste repositório.

---

# Documentação detalhada

- [Criação e rede na OCI](docs/OCI.md)
- [Cudy WR3000 e WireGuard](docs/CUDY.md)
- [Modelo de segurança](docs/SECURITY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## Referências oficiais

- Home Assistant Container: https://www.home-assistant.io/installation/linux
- Docker Engine Ubuntu: https://docs.docker.com/engine/install/ubuntu/
- LinuxServer WireGuard: https://docs.linuxserver.io/images/docker-wireguard/
- OCI Compute: https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/launchinginstance.htm
- Cudy VPN/WireGuard: https://docs.cudy.com/user_guide/industrial_router/vpn/
