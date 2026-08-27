# Configuração da Alexa Custom Skill

Este guia configura a Skill privada que consulta e controla o Cudy pela integração do Home Assistant na OCI, através do WireGuard. Ela não depende de Nabu Casa nem de uma Smart Home Skill.

## Pré-requisitos

- A stack principal está em execução pelo `compose.yaml` da raiz.
- O Home Assistant possui a integração Cudy configurada.
- O domínio público aponta para a OCI com certificado TLS válido.
- TCP 443 está liberada para a Alexa alcançar o endpoint.
- A OCI alcança a LAN residencial pelo WireGuard.
- O `.env` da raiz existe somente na OCI e não é versionado.

## Criar a Skill

1. Acesse o Alexa Developer Console.
2. Crie uma Skill `Custom` em Portuguese (BR).
3. Em **Invocation**, configure o nome desejado.
4. Em **Interaction Model > JSON Editor**, importe `services/cudy-alexa/alexa/pt-BR.json`.
5. Em **Endpoint**, configure `https://SEU-DOMINIO/alexa`.
6. Salve, faça o build e habilite o modo Development para testes.

Não habilite Account Linking ou permissões adicionais para esta Skill.

## Configurar a stack

No `.env` da raiz, configure apenas os parâmetros não secretos:

```dotenv
PUBLIC_HOSTNAME=router.example.invalid
ACME_EMAIL=admin@example.invalid
HA_URL=http://127.0.0.1:8123
ALEXA_SKILL_ID=amzn1.ask.skill.SUA-ID
```

O acesso do backend ao Home Assistant usa um arquivo privado fora do Git:

```text
/srv/home-automation/secrets/ha_token
```

Crie o token usando um usuário dedicado não administrador do Home Assistant. O `setup-home.sh` migra automaticamente instalações antigas que ainda possuam esse valor no `.env`.

Suba os serviços:

```bash
cd /home/ubuntu/CudyWired-HomeAssistant-OCI
sudo ./scripts/setup-home.sh
docker compose up -d --build
```

Valide:

```bash
docker compose ps
curl -fsS http://127.0.0.1:3000/health
sudo ./scripts/validate.sh
```

Não existe health check público: requisições HTTPS externas diferentes de `POST /alexa` recebem `404`.

## Frases de teste

- “Alexa, abrir meu roteador.”
- “Alexa, perguntar ao meu roteador como está a rede.”
- “Alexa, perguntar ao meu roteador se há algum serviço indisponível.”
- “Alexa, abrir meu roteador”; depois: “ligar a rede de convidados”; “duas horas”; “pode fazer”.
- “Alexa, perguntar ao meu roteador quando a rede de convidados desliga.”
- “Alexa, pedir ao meu roteador para cancelar o agendamento dos convidados.”
- “Alexa, pedir ao meu roteador para reiniciar.”

Ao ligar a rede de convidados, um prazo é obrigatório. O backend aceita de um minuto a 24 horas, mantém no máximo três agendamentos simultâneos e persiste os temporizadores em `${DATA_DIR}/cudy-alexa/data`. Uma confirmação explícita é exigida antes de operações de escrita.

## Política de operações

`services/cudy-alexa/policy.yaml` define capacidades de leitura e escrita. Guest Wi-Fi e reboot estão habilitados; reset, firmware e outras mudanças de alto impacto permanecem bloqueados.

## Segurança e diagnóstico

- O Caddy publica somente `POST /alexa`.
- O health check existe somente em loopback.
- O Caddy e o guard local limitam tamanho de requisição; o guard também limita taxa, concorrência e tempo de processamento.
- Não versione `.env`, arquivos em `secrets/`, chaves ou credenciais.
- A senha do Cudy fica na integração Cudy do Home Assistant, não no backend Alexa.
- Home Assistant, Portainer e LuCI permanecem privados.

Diagnóstico:

```bash
cd /home/ubuntu/CudyWired-HomeAssistant-OCI
docker compose logs --tail=100 cudy-alexa
docker compose logs --tail=100 caddy
curl -fsS http://127.0.0.1:3000/health
```

## Gestão dos containers

O **Portainer** faz parte do mesmo `compose.yaml` e centraliza a gestão visual dos containers. A porta `9443` é aceita pelo firewall local somente através do WireGuard.
