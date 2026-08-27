# CudyWired Home Assistant OCI

Home Assistant em OCI com Docker, WireGuard, integração Cudy, backend Alexa e Portainer.

Os dados persistentes e segredos ficam fora do Git, por padrão em `/srv/home-automation`. Todos os endereços deste repositório são exemplos mascarados; valores operacionais pertencem somente ao `.env` privado da VM.

## Arquitetura

```text
Alexa -> HTTPS/Caddy -> guard :3000 -> backend :3001 -> Home Assistant
                                                        |
                                                   integração Cudy
                                                        |
                                                   WireGuard
                                                        |
                                                   Cudy / LAN
```

A Alexa não acessa o roteador diretamente. O backend usa a API do Home Assistant e a integração Cudy atravessa o túnel WireGuard.

## Serviços

| Serviço | Função | Exposição |
|---|---|---|
| Home Assistant | automação e entidades Cudy | WireGuard |
| WireGuard | VPN site-to-site | UDP configurada |
| cudy-alexa | guard e backend da Skill | loopback |
| Caddy | TLS e proxy Alexa | TCP 80/443 |
| Portainer | gestão Docker | WireGuard |

Mosquitto, Node-RED, ESPHome e Zigbee2MQTT permanecem opcionais via profiles.

## Configuração inicial

```bash
git clone https://github.com/odairb12/CudyWired-HomeAssistant-OCI.git
cd CudyWired-HomeAssistant-OCI
cp .env.example .env
chmod 600 .env
sudo ./scripts/setup-home.sh
docker compose up -d --build
sudo ./scripts/validate.sh
```

Use `.env.example` como referência e substitua os exemplos somente no `.env` local. O token dedicado do Home Assistant não fica no `.env`; o runtime usa:

```text
/srv/home-automation/secrets/ha_token
```

O setup migra automaticamente uma configuração legada que ainda contenha esse valor no `.env`.

## Segurança

O projeto aplica defesa em profundidade:

- `22`, `8123` e `9443` são aceitas localmente somente por `wg0`, salvo exceção SSH explícita e restrita;
- `8000/9000` permanecem bloqueadas;
- IPv4 e IPv6 recebem regras equivalentes;
- Caddy publica somente `POST /alexa`; `/health` é local;
- Alexa possui limite de corpo, taxa, concorrência e timeout antes do backend;
- container Alexa é read-only, sem capabilities e com `no-new-privileges`;
- Portainer passa pelo firewall `INPUT` e continua tratado como privilegiado devido ao Docker socket;
- SSH recebe hardening quando há chave pública válida;
- associação ao grupo `docker` é desabilitada por padrão;
- atualizações de segurança do Ubuntu são automáticas;
- CI executa Gitleaks, Trivy, npm audit, CodeQL, testes e validações;
- GitHub Actions usadas nos workflows são pinadas por SHA;
- publicação da imagem Alexa é permitida somente pela `main` e produz SBOM/provenance;
- Dependabot verifica dependências semanalmente.

Consulte [`docs/SECURITY.md`](docs/SECURITY.md) para detalhes.

## Portas

| Porta | Uso | Internet |
|---|---|---|
| UDP 51820 (padrão) | WireGuard | aberta |
| TCP 80/443 | Caddy/Alexa | abertas |
| TCP 22 | SSH | fechada fora da VPN por padrão |
| TCP 8123 | Home Assistant | fechada fora da VPN |
| TCP 9443 | Portainer | fechada fora da VPN |
| TCP 8000/9000 | Portainer legado | bloqueadas |

## Atualização

Como o histórico deste repositório pode ser reescrito durante sanitizações de segurança, prefira um clone limpo quando houver aviso de reescrita. Em operação normal:

```bash
git pull
docker compose pull
docker compose up -d --build
sudo ./scripts/validate.sh
```

## Documentação

- [Segurança](docs/SECURITY.md)
- [OCI](docs/OCI.md)
- [Cudy + WireGuard](docs/CUDY.md)
- [Alexa](docs/ALEXA-CUSTOM-SKILL.md)
- [Setup Alexa](docs/ALEXA-CUSTOM-SKILL-SETUP.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Migração](docs/MIGRATION.md)
