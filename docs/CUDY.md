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

Importe o `peer_cudy.conf` em **Arquivo de configuração** e mantenha os parâmetros de interface/peer gerados pelo WireGuard.

Valores esperados após a importação:

```text
Cudy VPN IP:    10.13.13.2
Mask:           255.255.255.0
MTU:            1420
Endpoint:       IP público OCI
Endpoint port:  51820
```

### Política VPN obrigatória para split tunnel

No firmware testado do WR3000, somente importar o arquivo não é suficiente para garantir que a Internet residencial continue saindo pela WAN normal. Configure a política do Cudy assim:

```text
Ativar:         Sim
Protocolo:      Cliente WireGuard
Regra padrão:   Permitir todos os dispositivos
Site a Site:    Ativado
Política VPN:   Sub-rede remota

Sub-rede remota:
Regra:          Permitir somente os listados
Endereço IP:    10.13.13.0
Máscara:        255.255.255.0
```

O resultado esperado é:

```text
Destino 10.13.13.0/24 -> WireGuard -> OCI
Demais destinos       -> WAN normal do Cudy
```

Essa configuração foi necessária no ambiente validado. Sem a política **Sub-rede remota / Permitir somente os listados**, o Cudy pode aplicar a VPN de forma ampla aos clientes e interromper a navegação normal da casa.

## 3. Split tunnel

O projeto também define no peer:

```dotenv
WG_ALLOWED_IPS=10.13.13.1/32
```

O `AllowedIPs` do peer limita o destino WireGuard ao endereço OCI, enquanto a política **Sub-rede remota** do Cudy garante que os clientes da LAN só enviem `10.13.13.0/24` pela VPN.

Confirme no arquivo gerado:

```bash
sudo grep -E '^AllowedIPs' /srv/home-automation/wireguard/config/peer_cudy/peer_cudy.conf
```

Esperado:

```text
AllowedIPs = 10.13.13.1/32
```

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

Teste o Cudy:

```bash
ping -c 3 192.168.10.1
```

Depois teste um dispositivo real da LAN:

```bash
ping -c 3 192.168.10.211
```

O Home Assistant compartilha a rede do host, portanto também deve enxergar a mesma rota:

```bash
sudo docker exec homeassistant ip route get 192.168.10.211
```

Esperado:

```text
192.168.10.211 dev wg0 src 10.13.13.1
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
ping -c 3 10.13.13.2
```

## 6. Validar Internet e VPN ao mesmo tempo

Depois de salvar a política no Cudy, valide a partir de um dispositivo conectado à LAN/Wi-Fi do WR3000:

1. abra um site normal para confirmar que a Internet continua pela WAN;
2. acesse `http://10.13.13.1:8123`;
3. confirme que ambos funcionam simultaneamente.

Se a Internet parar ao ativar a VPN, desative temporariamente o cliente WireGuard no Cudy e revise a política **Sub-rede remota** antes de reativar.

## 7. Acessos pela VPN

Conectado à rede do Cudy:

```text
Home Assistant: http://10.13.13.1:8123
Portainer:      https://10.13.13.1:9443
SSH:            ubuntu@10.13.13.1
```

Como esses serviços estão no host OCI e `wg0` também está no host, não há regra DNAT intermediária para esses acessos.

## 8. Persistência

As chaves e configurações do peer permanecem em:

```text
/srv/home-automation/wireguard/config
```

Recriar o container não deve apagar esse diretório. Não remova `peer_cudy` nem as chaves existentes sem intenção de reconfigurar o roteador.
