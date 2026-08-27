# Configuração da Alexa Custom Skill

Este guia configura a Skill privada que consulta e controla o Cudy pela integração do Home Assistant na OCI, através do WireGuard. Ela não depende de Nabu Casa nem de uma Smart Home Skill.

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
7. Em **Interaction Model > JSON Editor**, importe o arquivo `services/cudy-alexa/alexa/pt-BR.json` e clique em **Save Model**.
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
- “Alexa, perguntar ao meu roteador se há algum serviço indisponível.”
- “Alexa, abrir meu roteador”; depois: “ligar a rede de convidados”; “duas horas”; “pode fazer”.
- “Alexa, perguntar ao meu roteador quando a rede de convidados desliga.”
- “Alexa, pedir ao meu roteador para cancelar o agendamento dos convidados.”
- “Alexa, pedir ao meu roteador para reiniciar.”

Ao ligar a rede de convidados, um prazo é obrigatório. O backend aceita de um minuto a 24 horas, mantém no máximo três agendamentos simultâneos e persiste os temporizadores no volume Docker `cudy_alexa_data`. Uma confirmação explícita é exigida antes de ligar, desligar, cancelar agendas ou reiniciar.

## Política de operações

`services/cudy-alexa/policy.yaml` define as capacidades de leitura e escrita. Atualmente, somente o controle da rede de convidados e o reboot estão habilitados. Reset de fábrica, firmware e outras mudanças de configuração continuam bloqueados.

Não exponha por voz reset de fábrica, firmware, WAN/WISP/VPN, firewall, logs ou alteração de configuração até que cada ação tenha desenho, autorização e rollback próprios.

## Segurança e diagnóstico

- O Caddy publica somente `GET /health` e `POST /alexa`; os demais caminhos respondem 404.
- `/health` informa apenas a saúde do backend e do Home Assistant, sem expor dados do roteador.
- Não versione `.env`, senhas Cudy, chaves SSH, chaves WireGuard, cookies ou o Application ID real.
- Para investigar uma falha:

```bash
cd /home/ubuntu/cudy-alexa
docker compose logs --tail=100 app
curl http://127.0.0.1:3000/health
```

O check-up consulta Internet/WISP, VPN, LAN, Wi-Fi 2,4 GHz, Wi-Fi 5 GHz, Mesh e DHCP. Estado `unknown` é informado como não verificado, nunca como falha confirmada.
