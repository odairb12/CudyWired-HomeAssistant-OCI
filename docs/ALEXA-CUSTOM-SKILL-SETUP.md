# Configuração da Alexa Custom Skill

Este guia configura a Skill privada que consulta o Cudy pela OCI através do WireGuard. Ela não depende de Home Assistant, Nabu Casa ou de uma Smart Home Skill.

## Pré-requisitos

- O serviço `cudy-alexa` está em execução na OCI com Docker.
- O domínio público aponta para a OCI e possui certificado TLS válido por uma CA confiável.
- A porta TCP 443 está liberada para a Alexa alcançar o endpoint.
- A OCI alcança o Cudy pelo WireGuard.
- O arquivo `.env` existe **somente na OCI** e não é versionado.

## Criar a Skill

1. Acesse [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask).
2. Escolha **Create Skill**.
3. Nome: `Rede da Casa`.
4. Idioma principal: **Portuguese (BR)**.
5. Tipo: **Custom**; modelo: **Provision your own**; método: **Start from scratch**.
6. Em **Build > Invocation**, informe `meu roteador`. Salve.
7. Em **Interaction Model > Intents**, crie/importe os intents do serviço. Mantenha os built-ins `AMAZON.HelpIntent`, `AMAZON.CancelIntent`, `AMAZON.StopIntent` e `AMAZON.FallbackIntent`.
8. Em **Endpoint**, selecione **HTTPS**, com certificado de autoridade certificadora confiável, e use `https://SEU-DOMINIO/alexa`.
9. Clique em **Build skill**.
10. Em **Test**, selecione **Development**.

Não habilite Account Linking, permissões de conta ou interfaces adicionais para esta Skill.

## Associar a Skill ao backend

Depois de criar a Skill, copie o **Application ID** em **Build > Endpoint** e defina-o somente no `.env` da OCI:

```dotenv
ALEXA_SKILL_ID=amzn1.ask.skill.SUA-ID
```

Recrie o serviço:

```bash
cd /home/ubuntu/cudy-alexa
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3000/health
```

O backend valida assinatura, timestamp e Application ID antes de processar `POST /alexa`.

## Frases de teste

- “Alexa, abrir meu roteador.”
- “Alexa, perguntar ao meu roteador como está a rede.”
- “Alexa, perguntar ao meu roteador qual é o status do Wi-Fi.”
- “Alexa, pedir ao meu roteador para ligar a rede de convidados.” (somente quando a operação estiver implementada e habilitada pela política)
- “Alexa, pedir ao meu roteador para reiniciar.” (idem)

## Política de operações

`services/cudy-alexa/policy.yaml` define as capacidades de leitura e escrita. A política atual pode permitir apenas rede de convidados e reboot, mas **permitir na política não executa uma alteração no roteador**: cada operação de escrita precisa de uma implementação autenticada, testes no firmware Cudy e confirmação por voz.

Não exponha por voz reset de fábrica, firmware, WAN/WISP/VPN, firewall, logs ou alteração de configuração até que cada ação tenha desenho, autorização e rollback próprios.

## Segurança e diagnóstico

- O Caddy publica somente `GET /health` e `POST /alexa`; os demais caminhos respondem 404.
- `/status` é local à OCI e serve apenas para diagnóstico.
- Não versione `.env`, senhas Cudy, chaves SSH, chaves WireGuard, cookies ou o Application ID real.
- Para investigar uma falha:

```bash
cd /home/ubuntu/cudy-alexa
docker compose logs --tail=100 app
curl http://127.0.0.1:3000/status
```

O conector trata nova autenticação quando o Cudy devolve redirecionamento de sessão. As leituras do panorama de rede são serializadas para reduzir disputa pela sessão do roteador.
