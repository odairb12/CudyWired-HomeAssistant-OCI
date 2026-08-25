# Cudy WR3000 + WireGuard

O WR3000 atua como **cliente WireGuard** e conecta a rede residencial diretamente ao namespace de rede do host OCI.

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
          |
      host network
          |
   Home Assistant / SSH / Portainer
```

Com o WireGuard em `network_mode: host`, a interface `wg0` existe no próprio host Ubuntu. Isso elimina a necessidade de DNAT entre o namespace Docker e o host e permite que o Home Assistant, que também usa host network, acesse diretamente a LAN residencial.

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

## 4. Site-to-site OCI -> LAN

O Compose declara:

```dotenv
HOME_LAN_CIDR=192.168.10.0/24
```

No servidor WireGuard isso é aplicado ao peer `cudy` como subnet adicional. O resultado esperado em `wg show` é:

```text
allowed ips: 10.13.13.2/32, 192.168.10.0/24
```

Como `wg0` roda no host, o próprio Ubuntu deve enxergar a rota:

```bash
ip addr show wg0
ip route show 192.168.10.0/24
ip route get 192.168.10.1
```

A rota deve apontar para `wg0`, não para o gateway padrão da OCI.

Teste primeiro o Cudy:

```bash
ping -c 3 192.168.10.1
```

Depois teste um dispositivo real da LAN:

```bash
ping -c 3 192.168.10.211
```

A partir desse ponto, integrações locais do Home Assistant podem alcançar dispositivos `192.168.10.x` diretamente, sujeito ao firewall e ao serviço disponível no dispositivo.

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
ping -c 3 10.13.13.2
```

## 6. Acessos pela VPN

Conectado à rede do Cudy:

```text
Home Assistant: http://10.13.13.1:8123
Portainer:      https://10.13.13.1:9443
SSH:            ubuntu@10.13.13.1
```

Como esses serviços estão no host OCI e `wg0` também está no host, não há mais regra DNAT intermediária para esses acessos.

## 7. Persistência

As chaves e configurações do peer permanecem em:

```text
/srv/home-automation/wireguard/config
```

Recriar o container não deve apagar esse diretório. Não remova `peer_cudy` nem as chaves existentes sem intenção de reconfigurar o roteador.
