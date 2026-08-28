# Cudy WR3000 Home Assistant Integration

[← Início](../../README.md) · [Cudy e WireGuard](../CUDY.md) · [Alexa](../ALEXA-CUSTOM-SKILL.md) · [Segurança](../SECURITY.md) · [Troubleshooting](../TROUBLESHOOTING.md)

Implementation baseline: WR3000 V1.0 / firmware `2.4.19-20250828-192837`.

## Architecture

There is now exactly one Cudy/LuCI implementation:

```text
Alexa Custom Skill -> cudy-alexa -> Home Assistant REST API
                                      |
                         custom_components/cudy
                                      |
                               WireGuard/LAN
                                      |
                                  Cudy WR3000
```

The Alexa backend no longer stores Cudy credentials, authenticates to LuCI, parses Cudy HTML, or writes directly to the router. It uses a dedicated Home Assistant Long-Lived Access Token and operates/query the semantic HA entities. Cudy credentials remain only in the Home Assistant config entry.

## Implemented Home Assistant layer

- LuCI double SHA-256 challenge login with aiohttp CookieJar and session reuse.
- Controlled reauthentication after an expired session.
- System, LAN, device summary/list, Wi-Fi, WISP, VPN and Guest reads.
- Sensors: uptime, firmware, LAN IP, connected clients, WISP signal, VPN protocol, Wi-Fi channel.
- Binary sensors: WISP and VPN.
- Dynamic device trackers based on discovered clients.
- Guest Wi-Fi 2.4 GHz (`wlan02`) and 5 GHz (`wlan12`) switches.
- Guest write: GET -> preserve successful form controls -> change disabled -> apply guest/firewall -> wait -> GET verify.
- Reboot button that reads the authenticated page and extracts only the firmware-owned `GET /cgi-bin/luci/admin/system/reboot/apply` endpoint, without blind retry.
- Writes require positively identified supported firmware; unknown firmware is read-only.
- Diagnostics redact credentials and router host.
- Config-entry startup uses Home Assistant retry/auth failure semantics.

## Alexa layer

The Alexa backend only performs:

1. Alexa request signature/timestamp verification through the ASK Express adapter.
2. `ALEXA_SKILL_ID` validation.
3. Intent/slot processing and confirmation dialogue.
4. Home Assistant state reads.
5. Home Assistant `switch.turn_on`, `switch.turn_off` and `button.press` service calls.
6. Voice response generation.

Required backend environment:

```text
HA_URL=http://127.0.0.1:8123
ALEXA_SKILL_ID=<Amazon skill id>
```

The dedicated Home Assistant token is read from `/run/secrets/ha_token`, mounted read-only from `${DATA_DIR}/secrets/ha_token`; it is not stored in `.env` or committed to Git.

`CUDY_USERNAME`, `CUDY_PASSWORD` and `CUDY_URL` must not be configured in the Alexa service anymore.

## Supported voice controls

After invoking the Custom Skill:

- status geral da rede;
- quantidade de dispositivos conectados;
- status WISP/VPN;
- ligar/desligar rede de convidados;
- ligar/desligar convidados em 2.4 GHz;
- ligar/desligar convidados em 5 GHz;
- reiniciar o roteador.

Guest and reboot require explicit confirmation. Guest activation requires a duration from one minute to 24 hours, supports at most three simultaneous schedules and persists them under `${DATA_DIR}/cudy-alexa/data`. Guest operations are verified by re-reading the Home Assistant switch state after the service call.

The dialogue accepts natural imperative action forms such as `ligue`, `ative`, `habilite`, `desligue` and `desative`. After a completed query or operation, Alexa explicitly offers another interaction. `sim` keeps the session open; `não` closes it. When an action is pending, the same yes/no intents confirm or cancel that action instead.

## Intentionally excluded controls

Factory reset, firmware upgrade, LAN/WAN/WISP/VPN mutation, firewall mutation, log clearing and broad service restart remain excluded because they were not validated and have a larger blast radius.

## Hardware validation

Guest activation and deactivation were physically validated on both 2.4 GHz and 5 GHz networks, including the firmware apply/restart flow and final state verification. The integration uses read-before-write, no blind write retry and firmware gating.

The reboot page and its exact apply endpoint were confirmed in the deployed firmware, and the parser is covered by an allow-listed unit test. A real reboot is intentionally excluded from automated validation because it disrupts WISP, WireGuard and residential connectivity; it must remain a supervised test.

Bandwidth remains unsupported because the discovered simple request returned HTTP 500 and required parameters are unknown. WAN online state is not inferred from panel reachability because no authoritative endpoint was confirmed.
