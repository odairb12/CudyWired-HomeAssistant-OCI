# Migracao do layout legado

[← Início](../README.md) · [OCI](OCI.md) · [Cudy e WireGuard](CUDY.md) · [Alexa](ALEXA-CUSTOM-SKILL.md) · [Segurança](SECURITY.md) · [Troubleshooting](TROUBLESHOOTING.md)

Use este procedimento somente se a VM atual foi montada durante os testes anteriores e possui dados persistentes diretamente em:

```text
/opt/home-automation/
```

A estrutura atual do repositorio separa os arquivos versionados dos dados de runtime e usa, por padrao:

```text
/srv/home-automation/
```

Nao execute o novo `setup-home.sh` sobre uma instalacao existente antes de preservar principalmente:

- `homeassistant/config`;
- `wireguard/config`;
- `portainer/data`.

A pasta `wireguard/config` contem as chaves do peer ja importado no Cudy. Perde-la gera um novo peer e exige nova importacao no roteador.

## Migrar

No clone do repositorio:

```bash
chmod +x scripts/*.sh
sudo ./scripts/migrate-legacy-layout.sh
sudo ./scripts/setup-home.sh
```

O script de migracao:

1. para o Compose antigo quando encontra o arquivo;
2. copia os diretorios persistentes com `rsync`;
3. preserva `/opt/home-automation` para rollback;
4. valida se Home Assistant e WireGuard foram copiados.

Depois do novo setup, valide:

```bash
sudo ./scripts/validate.sh
sudo docker exec wireguard wg show
```

E, conectado a rede do Cudy:

```text
http://10.13.13.1:8123
```

So remova ou arquive `/opt/home-automation` depois de confirmar Home Assistant, handshake WireGuard e acesso pelo Cudy.
