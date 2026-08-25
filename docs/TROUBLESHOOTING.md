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

## WireGuard tem handshake, mas 10.13.13.1:8123 não abre

```bash
sudo docker exec wireguard wg show
sudo docker exec wireguard iptables -t nat -L PREROUTING -n -v
```

Devem existir DNATs para:

```text
22
8123
9443
```

Teste se o container consegue alcançar o host:

```bash
sudo docker exec wireguard sh -c 'GW=$(ip route show default | awk "NR==1 {print \\$3}"); wget -S -O /dev/null http://$GW:8123'
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

## Acesso VPN não funciona do computador

Confirme primeiro que o computador está realmente conectado à LAN/Wi-Fi do Cudy. O endereço `10.13.13.1` só será roteado conforme a política WireGuard do WR3000.

## Memória

```bash
free -h
sudo docker stats --no-stream
```

Na E2.1.Micro, mantenha Mosquitto, Node-RED, ESPHome e Zigbee2MQTT desligados até haver necessidade real.
