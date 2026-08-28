# Troubleshooting

[← Início](../README.md) · [OCI](OCI.md) · [Cudy e WireGuard](CUDY.md) · [Alexa](ALEXA-CUSTOM-SKILL.md) · [Segurança](SECURITY.md)

> Os endereços deste documento são exemplos mascarados. Use os valores reais apenas a partir do `.env` não versionado da OCI.

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
sudo nft list table inet home_automation
sudo systemctl status home-automation-firewall.service --no-pager
```

O projeto usa uma tabela `nftables` própria e não depende da ordem de regras `iptables` fornecidas pela imagem OCI.

## A Alexa entende outra intent ao ouvir “ligue a rede de convidados”

Confirme que o modelo mais recente foi importado e compilado no Alexa Developer Console:

```text
Build -> Interaction Model -> JSON Editor
arquivo: services/cudy-alexa/alexa/pt-BR.json
Save Model -> Build Model
```

As formas `ligue`, `ative`, `habilite`, `desligue` e `desative` devem resolver para o slot `GUEST_ACTION`. Consulte o backend:

```bash
sudo docker compose logs --since=10m cudy-alexa
```

O esperado ao falar “ligue” é `GuestWifiControlIntent` com o slot de ação correspondente. Se aparecer `GuestScheduleStatusIntent`, o modelo publicado ainda está desatualizado.

## “Sim” informa que não existe ação pendente

Atualize o backend e reconstrua somente o serviço Alexa:

```bash
git pull
sudo docker compose up -d --build --no-deps cudy-alexa
curl -fsS http://127.0.0.1:3000/health
```

No fluxo atual, “sim” confirma uma escrita quando existe ação pendente; depois de uma resposta concluída, “sim” mantém a conversa aberta e “não” encerra a Skill.

## WireGuard tem handshake, mas o IP do servidor VPN não responde

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
- `sudo docker compose ps`;
- endpoint/porta importados no Cudy.

```bash
sudo docker logs --tail 100 wireguard
sudo ss -lunp | grep 51820
```

## WireGuard alcança o Cudy, mas OCI não alcança a LAN residencial

Confirme primeiro os Allowed IPs:

```bash
sudo docker exec wireguard wg show
```

O peer deve conter o IP WireGuard do Cudy e a faixa definida por `HOME_LAN_CIDR`. Exemplo mascarado:

```text
allowed ips: 10.99.0.2/32, 192.168.50.0/24
```

Depois confira a rota no host usando os valores reais do seu ambiente:

```bash
ip route show "$HOME_LAN_CIDR"
ip route get IP_DO_CUDY_NA_LAN
```

A rota deve usar `wg0`. Se aparecer o gateway padrão da OCI (`ens3`), confirme `HOME_LAN_CIDR` no `.env` e recrie somente o WireGuard:

```bash
sudo docker compose up -d --force-recreate wireguard
```

Valide com o IP real do Cudy na LAN:

```bash
ping -c 3 IP_DO_CUDY_NA_LAN
```

## Acesso VPN não funciona do computador

Confirme primeiro que o computador está realmente conectado à LAN/Wi-Fi do Cudy. O endereço do servidor WireGuard só será roteado conforme a política WireGuard do WR3000.

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
