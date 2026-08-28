# MCP - habilitar um Agent no OpenCode

Este guia mostra como usar o **Model Context Protocol (MCP) Server do Home Assistant** com o **OpenCode**, mantendo o modelo de IA (por exemplo, Gemini) separado da autenticação do Home Assistant.

## Visão geral

O fluxo esperado é:

```text
OpenCode
   |
   +--> Gemini API Key -> modelo Gemini
   |
   +--> MCP -> Home Assistant
                 |
                 +--> Assist / entidades
                          |
                          +--> dispositivos da casa
```

No ambiente deste projeto, o Home Assistant está acessível pela VPN em:

```text
http://10.13.13.1:8123
```

O endpoint MCP é:

```text
http://10.13.13.1:8123/api/mcp
```

> Importante: o token/API key do Gemini autentica somente o modelo Gemini. A autenticação do Home Assistant/MCP é separada.

## 1. Habilitar o MCP Server no Home Assistant

No Home Assistant:

```text
Configurações
  -> Dispositivos e serviços
  -> Adicionar integração
  -> Model Context Protocol Server
```

Use a integração **Model Context Protocol Server**.

Depois de criada, confirme que existe a entrada `Assist` dentro da integração.

O MCP Server roda dentro do próprio Home Assistant. Não é necessário criar outro container apenas para o MCP.

## 2. Configurar o Gemini no OpenCode

No OpenCode, execute:

```text
/connect
```

Selecione o provedor Google/Gemini e informe sua API key.

Depois execute:

```text
/models
```

Selecione o modelo Gemini desejado.

## 3. Configurar o Home Assistant como servidor MCP

Crie ou ajuste o arquivo:

```text
~/.config/opencode/opencode.json
```

Ou use um `opencode.json` no diretório do projeto.

Exemplo:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "home-assistant": {
        "type": "remote",
        "url": "http://10.13.13.1:8123/api/mcp"
      }
    }
  }
}
```

## 4. Validar conectividade antes do OpenCode

A máquina onde o OpenCode está rodando precisa alcançar a rede WireGuard deste projeto.

Teste:

```bash
curl -I http://10.13.13.1:8123
```

Também é possível validar no navegador:

```text
http://10.13.13.1:8123
```

Se esse endereço não estiver acessível, resolva primeiro a conectividade entre a máquina cliente e a VPN/Cudy.

## 5. Verificar o MCP no OpenCode

Liste os servidores MCP:

```bash
opencode mcp list
```

Se o Home Assistant solicitar autenticação:

```bash
opencode mcp auth home-assistant
```

Para diagnóstico:

```bash
opencode mcp debug home-assistant
```

## 6. Testar o Agent

Depois que o MCP estiver conectado, faça uma consulta simples no OpenCode, por exemplo:

```text
Use o Home Assistant para listar os dispositivos disponíveis.
```

Depois teste leitura de estado:

```text
Use o Home Assistant para verificar quais luzes estão ligadas.
```

Somente depois de validar leitura, teste comandos de alteração de estado.

## 7. Segurança

Para uso local/VPN, mantenha o acesso pela rede privada:

```text
OpenCode
   -> WireGuard/Cudy
      -> 10.13.13.1:8123
         -> Home Assistant MCP
```

Não abra a porta `8123` publicamente apenas para usar o OpenCode em uma máquina que já possui acesso pela VPN.

Na política atual deste projeto:

```text
UDP 51820 -> WireGuard exposto
TCP 8123  -> Home Assistant fechado para Internet
TCP 9443  -> Portainer fechado para Internet
TCP 22    -> SSH fechado normalmente
```

## 8. Fluxo final

```text
OpenCode
   |
   +--> Gemini
   |      -> interpretação/raciocínio
   |
   +--> MCP Home Assistant
             |
             +--> Assist
                    |
                    +--> Home Assistant
                           |
                           +--> wg0 / WireGuard
                                  |
                                  +--> Cudy WR3000
                                         |
                                         +--> 192.168.10.0/24
                                                |
                                                +--> Tuya / IoT / demais dispositivos
```

## Troubleshooting rápido

### `Connection refused`

Confirme:

```bash
curl -I http://10.13.13.1:8123
```

### MCP não aparece no OpenCode

Confira o JSON:

```bash
opencode mcp list
```

### MCP aparece, mas pede autenticação

Execute:

```bash
opencode mcp auth home-assistant
```

### Diagnóstico detalhado

```bash
opencode mcp debug home-assistant
```

### Home Assistant não alcança os dispositivos da LAN

No host OCI:

```bash
ip route get 192.168.10.211
```

Esperado:

```text
192.168.10.211 dev wg0
```

E dentro do Home Assistant:

```bash
sudo docker exec homeassistant ip route get 192.168.10.211
```

O tráfego para a LAN residencial deve usar `wg0`.
