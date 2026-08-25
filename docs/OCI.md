# Oracle Cloud Infrastructure

## 1. Rede

Crie uma VCN com conectividade à Internet antes da VM:

```text
Networking -> Virtual Cloud Networks -> Start VCN Wizard
             -> Create VCN with Internet Connectivity
```

Use a **Public Subnet** para a VM. Ela precisa de:

- Internet Gateway;
- rota `0.0.0.0/0` para o Internet Gateway;
- IPv4 público na VNIC.

## 2. VM

Configuração validada:

```text
Operating system: Canonical Ubuntu 24.04 Minimal
Shape:            VM.Standard.E2.1.Micro
Boot volume:      50 GB
Public IPv4:      Yes
```

Se uma Ampere A1 estiver disponível e elegível na sua tenancy, ela também pode ser usada com uma imagem `aarch64`; o ambiente validado neste projeto usa E2.1.Micro/x86_64.

## 3. Chave SSH

Selecione uma chave pública existente ou peça à OCI para gerar um par.

No Windows:

```powershell
ssh -i .\ssh-key-private.key ubuntu@IP_PUBLICO_OCI
```

Se um IP reutilizado apresentar `REMOTE HOST IDENTIFICATION HAS CHANGED` após recriar a VM:

```powershell
ssh-keygen -R IP_PUBLICO_OCI
```

## 4. Security List / NSG

Bootstrap SSH:

```text
Source:           SEU_IP_PUBLICO/32
Protocol:         TCP
Source Port:      All
Destination Port: 22
```

WireGuard permanente:

```text
Source:           0.0.0.0/0
Protocol:         UDP
Source Port:      All
Destination Port: 51820
```

Normalmente não publique:

```text
TCP 22
TCP 8123
TCP 9443
```

Quando necessário, abra temporariamente uma dessas portas com origem restrita ao seu IP público `/32`.

> `Source Port` deve permanecer `All`. A porta do serviço é informada em `Destination Port`.

## 5. Boot Volume

O Boot Volume é persistente em reboot, shutdown e stop/start da instância. Ao terminar a VM, revise as opções de preservação do Boot Volume antes de excluir recursos.

A franquia Free Tier e os limites de recursos podem mudar. Confirme os limites exibidos pela sua tenancy antes de aumentar storage ou criar volumes adicionais.
