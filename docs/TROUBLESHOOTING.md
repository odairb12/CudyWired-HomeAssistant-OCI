# Troubleshooting

## Verificação geral

```bash
sudo ./scripts/validate.sh
```

## Home Assistant está `Up`, mas 8123 ainda não abriu

Na VM de 1 GB a primeira inicialização pode levar alguns minutos.

```bash
sudo docker logs --tail 100 homeassistant
sudo ss -lntp | grep 8123
curl http://127.0.0.1:8123
```

Um `curl -I` usa `HEAD`; algumas rotas do Home Assistant podem responder `405 Method Not Allowed` mesmo com o serviço saudável. Para teste use um GET normal.

## Funciona em localhost, mas não pela Internet

Confirme:

1. IP público na VNIC;
2. subnet pública;
3. rota pelo Internet Gateway;
4. Security List/NSG;
5. firewall local.

```bash
sudo iptables -L INPUT -n -v --line-numbers
```

Imagens OCI podem ter uma regra final `REJECT`; o serviço systemd deste projeto insere as portas necessárias antes dela.

## WireGuard tem handshake, mas 10.13.13.1 não responde

Como o WireGuard usa `network_mode: host`, não existem mais regras DNAT Docker para 22/8123/9443. Verifique se a interface `wg0` foi criada no host:

```bash
sudo docker exec wireguard wg show
ip addr show wg0
```

Depois confirme as portas locais:

```bash
sudo ss -lntp | grep -E ':(22|8123|9443)\b'
```

## Handshake não aparece

Verifique se UDP/51820 está liberada:

- OCI Security List/NSG;
- firewall da VM;
- `docker compose ps`;
- endpoint/porta importados no Cudy.

```bash
sudo docker logs --tail 100 wireguard
sudo ss -lunp | grep 51820
```

## WireGuard alcança o Cudy, mas OCI não alcança 192.168.10.x

Confirme primeiro os Allowed IPs:

```bash
sudo docker exec wireguard wg show
```

O peer deve conter:

```text
allowed ips: 10.13.13.2/32, 192.168.10.0/24
```

Depois confira a rota no host:

```bash
ip route show 192.168.10.0/24
ip route get 192.168.10.1
```

A rota deve usar `wg0`. Se aparecer o gateway padrão da OCI (`ens3`), confirme `HOME_LAN_CIDR` no `.env` e recrie somente o WireGuard:

```bash
sudo docker compose up -d --force-recreate wireguard
```

Valide:

```bash
ping -c 3 192.168.10.1
```

## Acesso VPN não funciona do computador

Confirme primeiro que o computador está realmente conectado à LAN/Wi-Fi do Cudy. O endereço `10.13.13.1` só será roteado conforme a política WireGuard do WR3000.

## `wg0` não aparece no host

Confirme que o Compose atual possui:

```yaml
wireguard:
  network_mode: host
```

Depois recrie o serviço:

```bash
sudo docker compose up -d --force-recreate wireguard
ip addr show wg0
```

## Memória

```bash
free -h
sudo docker stats --no-stream
```

Na E2.1.Micro, mantenha Mosquitto, Node-RED, ESPHome e Zigbee2MQTT desligados até haver necessidade real.
