# Oracle Cloud Infrastructure

## 1. Rede

Crie uma VCN com conectividade à Internet antes da VM:

```text
Networking -> Virtual Cloud Networks -> Start VCN Wizard
             -> Create VCN with Internet Connectivity
```

Use uma **Public Subnet** para a VM. Ela precisa de Internet Gateway, rota `0.0.0.0/0` para o gateway e IPv4 público na VNIC.

## 2. VM

Configuração validada:

```text
Operating system: Canonical Ubuntu 24.04 Minimal
Shape:            VM.Standard.E2.1.Micro
Boot volume:      50 GB
Public IPv4:      Yes
```

## 3. Chave SSH

Use autenticação por chave pública. Após o setup, quando existe `authorized_keys` válido, autenticação por senha e login direto de root são desabilitados.

No bootstrap, restrinja TCP 22 ao seu IP público. Depois que o WireGuard estiver validado, remova essa regra pública e acesse SSH pela VPN.

## 4. Security List / NSG

Bootstrap SSH temporário:

```text
Source:           SEU_IP_PUBLICO/32
Protocol:         TCP
Destination Port: 22
```

WireGuard permanente:

```text
Source:           0.0.0.0/0
Protocol:         UDP
Destination Port: 51820
```

Custom Skill Alexa:

```text
TCP 80  Source: 0.0.0.0/0  Destination Port: 80
TCP 443 Source: 0.0.0.0/0  Destination Port: 443
```

Não publique no NSG:

```text
TCP 22
TCP 8000
TCP 9000
TCP 8123
TCP 9443
```

A VM possui uma segunda barreira: o firewall local bloqueia `22`, `8123` e `9443` fora de `wg0`, além de bloquear `8000/9000`. Assim, uma abertura acidental no NSG não deve ser suficiente para publicar os serviços administrativos.

Se SSH público emergencial for indispensável, restrinja o NSG a um único `/32` e defina o mesmo CIDR em `SSH_PUBLIC_CIDR` no `.env`; reaplique o setup e remova a exceção assim que terminar. Home Assistant e Portainer não possuem exceção pública equivalente no firewall do projeto.

> `Source Port` deve permanecer `All`. A porta do serviço é informada em `Destination Port`.

## 5. Boot Volume

O Boot Volume é persistente em reboot, shutdown e stop/start da instância. Ao terminar a VM, revise as opções de preservação do Boot Volume antes de excluir recursos.

A franquia Free Tier e os limites de recursos podem mudar. Confirme os limites exibidos pela sua tenancy antes de aumentar storage ou criar volumes adicionais.
