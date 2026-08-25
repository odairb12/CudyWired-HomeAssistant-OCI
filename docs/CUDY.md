# Cudy WR3000 + WireGuard

O WR3000 atua como **cliente WireGuard** e conecta a rede residencial à VM OCI.

## Topologia

```text
Cudy LAN 192.168.10.0/24
          |
       WR3000
     10.13.13.2
          |
       WireGuard
          |
     10.13.13.1
       Oracle OCI
```

## 1. Gerar o peer

O serviço WireGuard declara:

```text
PEERS=cudy
```

Após o primeiro start, a configuração fica em:

```text
/srv/home-automation/wireguard/config/peer_cudy/peer_cudy.conf
```

Não publique esse arquivo: ele contém chave privada e preshared key.

## 2. Importar no WR3000

Na interface do Cudy:

```text
Configurações -> VPN -> WireGuard
```

Configuração usada:

```text
Ativar:         Sim
Protocolo:      Cliente WireGuard
Regra padrão:   Permitir todos os dispositivos
Site a Site:    Ativado
Política VPN:   Desativar
```

Em **Arquivo de configuração**, importe `cudy.conf`.

Valores esperados após importação:

```text
Cudy VPN IP:    10.13.13.2
Mask:           255.255.255.0
MTU:            1420
Endpoint:       IP público OCI
Endpoint port:  51820
```

## 3. Split tunnel

O projeto define:

```dotenv
WG_ALLOWED_IPS=10.13.13.1/32
```

Isso faz com que os clientes atrás do Cudy usem o túnel para alcançar a OCI em `10.13.13.1`, sem transformar a VM Oracle no gateway padrão de toda a Internet residencial.

Se você alterar `WG_ALLOWED_IPS` depois que o peer já foi importado no Cudy, gere/reimporte a configuração atualizada quando necessário.

## 4. Site-to-site OCI -> LAN

O Compose também declara:

```dotenv
HOME_LAN_CIDR=192.168.10.0/24
```

que é aplicado no servidor WireGuard como subnet adicional do peer `cudy`. Isso prepara o lado OCI para rotear a LAN residencial através do peer.

Valide separadamente o sentido OCI -> LAN, porque ele também depende do encaminhamento/firewall do firmware Cudy.

Exemplo de teste, a partir do container WireGuard:

```bash
sudo docker exec wireguard ping -c 3 192.168.10.1
```

## 5. Validar handshake

```bash
sudo docker exec wireguard wg show
```

Procure:

```text
latest handshake: ...
transfer: ... received, ... sent
```

Teste o peer:

```bash
sudo docker exec wireguard ping -c 3 10.13.13.2
```

## 6. Acessos pela VPN

Conectado à rede do Cudy:

```text
Home Assistant: http://10.13.13.1:8123
Portainer:      https://10.13.13.1:9443
SSH:            ubuntu@10.13.13.1
```

O `wireguard-post-start.sh` cria DNAT dentro do namespace do container para encaminhar essas três portas ao host OCI.
