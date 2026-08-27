# Segurança

## Princípio

Há duas camadas distintas:

1. **Firewall local da VM**: deixa os serviços preparados.
2. **OCI Security List/NSG**: decide quais portas podem ser alcançadas pela Internet.

Isso permite liberar acesso público temporário sem precisar alterar a VM.

## Estado recomendado

| Porta | Serviço | OCI |
|---|---|---|
| UDP 51820 | WireGuard | Aberta |
| TCP 22 | SSH | Fechada normalmente |
| TCP 8123 | Home Assistant | Fechada normalmente |
| TCP 9443 | Portainer | Fechada normalmente |
| TCP 80 | Desafio ACME/redirecionamento HTTPS da Custom Skill | Aberta para Internet |
| TCP 443 | Endpoint HTTPS da Custom Skill | Aberta para Internet |

Para acesso temporário, prefira:

```text
Source CIDR = SEU_IP_PUBLICO/32
```

em vez de `0.0.0.0/0`.

## Exceção pública: Custom Skill Alexa

A Custom Skill usa `https://SEU-DOMINIO/alexa`. O domínio real fica apenas no `.env` do host OCI, através de `PUBLIC_HOSTNAME`, e não deve ser versionado. O Caddy expõe somente TCP 80/443 para emitir/renovar o certificado e receber requisições autenticadas da Alexa. O serviço de aplicação escuta exclusivamente em `127.0.0.1:3000` e acessa o Cudy pela WireGuard.

Não use estas portas para publicar LuCI, Home Assistant ou Portainer.

## Por que 51820 fica pública

WireGuard precisa receber os pacotes UDP iniciais do Cudy pela Internet. A autenticação do túnel depende das chaves criptográficas do peer.

## Segredos

Nunca faça commit de:

- `peer_cudy.conf`;
- chaves SSH privadas;
- chaves WireGuard;
- backups de `/srv/home-automation`;
- `.env` caso futuramente passe a conter segredo;
- hostname público real, e-mail ACME ou topologia/IPs operacionais quando não forem necessários ao código.

O repositório mantém apenas exemplos mascarados em `.env.example`.

## Portainer

O Portainer possui acesso ao Docker socket e, por consequência, alto privilégio sobre o host Docker. Não exponha `9443` permanentemente à Internet.

## Logs

O Compose limita os logs `json-file` a três arquivos de 10 MB por container para reduzir risco de crescimento indefinido no Boot Volume.
