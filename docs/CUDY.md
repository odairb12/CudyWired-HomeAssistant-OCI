# Cudy WR3000 + WireGuard

[← Início](../README.md) · [OCI](OCI.md) · [Alexa](ALEXA-CUSTOM-SKILL.md) · [Segurança](SECURITY.md) · [Troubleshooting](TROUBLESHOOTING.md)

O WR3000 atua como **cliente WireGuard** e conecta a rede residencial diretamente ao namespace de rede do host OCI.

> Os endereços deste documento são exemplos mascarados. Use os valores reais somente no `.env` não versionado da OCI.

## Topologia

```text
Cudy LAN 192.168.50.0/24
          |
       WR3000
      10.99.0.2
          |
       WireGuard
          |
      10.99.0.1
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

Valores de exemplo após a importação:

```text
Cudy VPN IP:    10.99.0.2
Mask:           255.255.255.0
MTU:            1420
Endpoint:       IP público OCI
Endpoint port:  51820
```

### Política VPN obrigatória para split tunnel

No firmware testado do WR3000, somente importar o arquivo não é suficiente para garantir que a Internet residencial continue saindo pela WAN normal. Configure a política do Cudy usando a faixa WireGuard definida no seu `.env`. Exemplo:

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

O resultado esperado é:

```text
Destino FAIXA_WIREGUARD -> WireGuard -> OCI
Demais destinos         -> WAN normal do Cudy
```

Essa configuração foi necessária no ambiente validado. Sem a política **Sub-rede remota / Permitir somente os listados**, o Cudy pode aplicar a VPN de forma ampla aos clientes e interromper a navegação normal da casa.

## 3. Split tunnel

O projeto usa `WG_ALLOWED_IPS` para limitar os destinos enviados ao túnel. Exemplo mascarado:

```dotenv
WG_ALLOWED_IPS=10.99.0.1/32
```

Confirme no arquivo gerado:

```bash
sudo grep -E '^AllowedIPs' /srv/home-automation/wireguard/config/peer_cudy/peer_cudy.conf
```

O valor deve corresponder ao `WG_ALLOWED_IPS` do `.env`.

## 4. Site-to-site OCI -> LAN

O Compose usa `HOME_LAN_CIDR` para anunciar ao servidor WireGuard a LAN atrás do peer `cudy`. Exemplo mascarado:

```dotenv
HOME_LAN_CIDR=192.168.50.0/24
```

No servidor WireGuard o peer deve mostrar o IP do peer e a LAN configurados no `.env`.

Como `wg0` roda no host, o próprio Ubuntu deve enxergar a rota:

```bash
ip addr show wg0
ip route show "$HOME_LAN_CIDR"
ip route get IP_DO_CUDY_NA_LAN
```

A rota deve apontar para `wg0`, não para o gateway padrão da OCI.

Teste o Cudy e depois um dispositivo real usando os endereços do seu ambiente:

```bash
ping -c 3 IP_DO_CUDY_NA_LAN
ping -c 3 IP_DE_UM_DISPOSITIVO_LAN
```

O Home Assistant compartilha a rede do host, portanto também deve enxergar a mesma rota:

```bash
sudo docker exec homeassistant ip route get IP_DE_UM_DISPOSITIVO_LAN
```

O resultado deve usar `dev wg0`.

## 5. Validar handshake

```bash
sudo docker exec wireguard wg show
```

Procure:

```text
latest handshake: ...
transfer: ... received, ... sent
```

Teste o peer usando o IP definido na configuração WireGuard real.

## 6. Validar Internet e VPN ao mesmo tempo

Depois de salvar a política no Cudy, valide a partir de um dispositivo conectado à LAN/Wi-Fi do WR3000:

1. abra um site normal para confirmar que a Internet continua pela WAN;
2. acesse o Home Assistant pelo IP WireGuard definido no seu `.env`;
3. confirme que ambos funcionam simultaneamente.

Se a Internet parar ao ativar a VPN, desative temporariamente o cliente WireGuard no Cudy e revise a política **Sub-rede remota** antes de reativar.

## 7. Acessos pela VPN

Exemplo mascarado:

```text
Home Assistant: http://10.99.0.1:8123
Portainer:      https://10.99.0.1:9443
SSH:            SEU_USUARIO@10.99.0.1
```

Como esses serviços estão no host OCI e `wg0` também está no host, não há regra DNAT intermediária para esses acessos.

## 8. Persistência

As chaves e configurações do peer permanecem em:

```text
/srv/home-automation/wireguard/config
```

Recriar o container não deve apagar esse diretório. Não remova `peer_cudy` nem as chaves existentes sem intenção de reconfigurar o roteador.

## 9. Escritas LuCI suportadas

A integração não inventa endpoints OpenWrt. Ela primeiro lê a página do firmware Cudy e aceita somente caminhos previstos pelo código.

No firmware validado, o reboot é disparado pelo JavaScript da página através de:

```text
GET /cgi-bin/luci/admin/system/reboot/apply
```

O parser aceita exclusivamente esse caminho; URLs arbitrárias e o endpoint de reset são rejeitados. Como o roteador pode fechar a conexão imediatamente após aceitar o reboot, esse GET nunca é repetido automaticamente.

O Guest Wi-Fi continua usando o fluxo específico do firmware para salvar e aplicar a alteração nas duas bandas. Firmware e reset de fábrica permanecem fora das operações permitidas pela Alexa.
