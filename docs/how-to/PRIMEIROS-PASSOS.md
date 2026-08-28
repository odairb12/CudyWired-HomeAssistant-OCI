# Primeiros passos no Home Assistant

Este guia considera a arquitetura deste projeto: o **Home Assistant roda na Oracle Cloud Infrastructure (OCI)** e alcança a rede residencial `192.168.10.0/24` através do túnel **WireGuard** com o Cudy WR3000.

O objetivo inicial é cadastrar um dispositivo compatível com **Tuya / Smart Life**, como um interruptor Wi-Fi, e disponibilizá-lo no Home Assistant da forma mais simples e previsível.

## 1. Entenda o cenário OCI

Neste projeto, o Home Assistant não está fisicamente dentro da residência:

```text
Home Assistant (OCI)
        |
     Internet
        |
    WireGuard
        |
   Cudy WR3000
        |
192.168.10.0/24
        |
Dispositivos da casa
```

Por isso, tanto a integração oficial Tuya/Smart Life quanto uma integração de controle local dependem da conectividade com a Internet entre a residência e a OCI.

Se a Internet residencial cair, o túnel WireGuard também fica indisponível e o Home Assistant na OCI não consegue alcançar diretamente os dispositivos da LAN.

## 2. Tuya/Smart Life ou controle local?

Há dois caminhos principais.

### Opção A — Integração oficial Tuya/Smart Life

```text
Home Assistant OCI
        |
     Internet
        |
   Tuya Cloud
        |
     Internet
        |
   Cudy / Wi-Fi
        |
    Interruptor
```

O dispositivo é inicialmente pareado pelo aplicativo **Smart Life** ou **Tuya Smart** e o Home Assistant utiliza a integração oficial Tuya.

### Opção B — Controle local

```text
Home Assistant OCI
        |
     Internet
        |
    WireGuard
        |
   Cudy WR3000
        |
      LAN
        |
    Interruptor
```

Depois do provisionamento necessário para o dispositivo, uma integração compatível com controle local pode fazer o Home Assistant conversar diretamente com o dispositivo através da LAN residencial roteada pelo WireGuard.

> Controle local, neste projeto, não significa independência da Internet. O Home Assistant está na OCI, portanto a conexão residencial continua necessária para manter o WireGuard ativo.

## 3. Diferença prática neste projeto

Como o Home Assistant está na OCI, a principal diferença operacional entre os dois modelos é **latência, quantidade de dependências e manutenção**.

| Característica | Tuya / Smart Life oficial | Controle local via WireGuard |
|---|---|---|
| Internet residencial | Necessária | Necessária |
| OCI acessível | Necessária | Necessária |
| WireGuard para comandar o dispositivo | Não é o caminho principal | Necessário |
| Tuya Cloud durante a operação | Necessária | Normalmente não |
| Latência | Pode ser maior | Normalmente menor |
| Configuração | Mais simples | Mais técnica |
| Manutenção | Menor | Maior |
| Compatibilidade | Maior | Depende do dispositivo |
| Dependências | Internet + Tuya Cloud | Internet + WireGuard + integração local |

Para os primeiros passos deste projeto, a recomendação é **começar pela integração oficial Tuya/Smart Life**.

Ela exige menos configuração, possui manutenção mais simples e permite validar rapidamente o dispositivo, o Home Assistant e as automações. O controle local pode ser avaliado posteriormente para dispositivos em que a redução de latência ou a remoção da Tuya Cloud do caminho justifique a manutenção adicional.

## 4. Antes de cadastrar o primeiro dispositivo

Confirme que:

1. o Cudy WR3000 está conectado à Internet;
2. o Wi-Fi que será utilizado pelo dispositivo está funcionando;
3. o Home Assistant está acessível em `http://10.13.13.1:8123` a partir da rede do Cudy;
4. o túnel WireGuard está ativo;
5. o celular utilizado no pareamento consegue acessar a rede Wi-Fi da residência.

Para dispositivos Tuya Wi-Fi, verifique também se o modelo exige rede **2,4 GHz**. Muitos dispositivos IoT não suportam pareamento em 5 GHz.

## 5. Caminho recomendado — Smart Life / Tuya Smart

### Passo 1 — Instalar o aplicativo

No celular, instale um dos aplicativos suportados pelo dispositivo:

- Smart Life; ou
- Tuya Smart.

Se o dispositivo já estiver cadastrado e funcionando em um deles, mantenha o aplicativo atual. Não é necessário migrar somente para utilizar o Home Assistant.

### Passo 2 — Colocar o dispositivo em pareamento

Para um interruptor Wi-Fi, normalmente é necessário manter o botão pressionado até o LED indicador começar a piscar.

O procedimento exato depende do fabricante e do modelo.

### Passo 3 — Cadastrar no Smart Life/Tuya Smart

No aplicativo:

```text
+ / Adicionar dispositivo
        |
        v
Localizar o interruptor
        |
        v
Selecionar a rede Wi-Fi da casa
        |
        v
Concluir o pareamento
```

Use a rede Wi-Fi fornecida pelo Cudy para o dispositivo sempre que essa for a rede IoT/residencial definida para o projeto.

### Passo 4 — Validar antes do Home Assistant

No aplicativo Smart Life/Tuya Smart:

1. ligue o interruptor;
2. desligue o interruptor;
3. confirme que o estado apresentado pelo aplicativo acompanha o estado físico.

Só continue depois que esse teste funcionar.

## 6. Adicionar a integração Tuya ao Home Assistant

No Home Assistant, acesse:

```text
Configurações
  -> Dispositivos e serviços
  -> Adicionar integração
  -> Tuya
```

Siga o fluxo de autenticação apresentado pelo Home Assistant e pelo aplicativo Tuya/Smart Life.

Dependendo da versão atual da integração, o Home Assistant pode solicitar informações da conta e apresentar um QR Code para vinculação pelo aplicativo.

Ao concluir, os dispositivos compatíveis da conta deverão ser importados automaticamente.

## 7. Validar o interruptor no Home Assistant

Localize o dispositivo recém-importado em:

```text
Configurações
  -> Dispositivos e serviços
  -> Tuya
  -> Dispositivos
```

Faça os dois testes:

```text
Home Assistant -> Ligar -> interruptor físico liga
Home Assistant -> Desligar -> interruptor físico desliga
```

Depois altere fisicamente o interruptor e confirme se o estado é atualizado no Home Assistant.

## 8. Organizar imediatamente o dispositivo

Não deixe nomes genéricos como:

```text
Smart Switch
Tuya Switch 01
Device BF83...
```

Use um nome baseado na função e no local, por exemplo:

```text
Dispositivo: Interruptor da Cozinha
Área:        Cozinha
Entidade:    switch.interruptor_cozinha
```

Uma organização consistente facilita posteriormente:

- dashboards;
- automações;
- Alexa;
- Home Assistant Assist;
- MCP;
- Agents no OpenCode.

## 9. Quando considerar controle local

Depois que o dispositivo estiver funcionando pela integração oficial, identifique fabricante e modelo e verifique se existe suporte confiável a uma integração local compatível.

Vale considerar controle local quando:

- a latência da Tuya Cloud for perceptível;
- uma automação exigir resposta mais rápida;
- houver interesse em retirar a Tuya Cloud do caminho operacional;
- o dispositivo possuir suporte local estável;
- a manutenção adicional for aceitável.

Não migre todos os dispositivos para controle local apenas porque a opção existe. Neste projeto OCI, a Internet continuará sendo necessária para alcançar a residência, então o ganho deve justificar a complexidade adicional.

## 10. Fluxo recomendado para novos dispositivos

```text
Novo dispositivo
      |
      v
Smart Life / Tuya Smart
      |
      v
Testar no aplicativo
      |
      v
Integração Tuya no Home Assistant
      |
      v
Testar ligar/desligar no HA
      |
      v
Renomear + atribuir Área
      |
      v
Criar automações
      |
      v
Avaliar controle local somente se necessário
```

## 11. Próximos passos

Depois do primeiro interruptor funcionando, a sequência recomendada é:

1. criar as Áreas/cômodos da residência;
2. cadastrar os demais dispositivos;
3. padronizar nomes de dispositivos e entidades;
4. criar cenas e automações básicas;
5. integrar Alexa;
6. habilitar acesso por MCP/Agent quando necessário.

Para o MCP com OpenCode, consulte [MCP - habilitar um Agent no OpenCode](MCP-OPENCODE.md).
