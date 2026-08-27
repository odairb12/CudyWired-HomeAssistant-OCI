# Cudy WR3000 Home Assistant Integration

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
- Reboot button using the authenticated `/cgi-bin/luci/admin/system/reboot` form, without blind POST retry.
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
HA_TOKEN=<dedicated Home Assistant Long-Lived Access Token>
ALEXA_SKILL_ID=<Amazon skill id>
```

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

Guest and reboot require explicit confirmation. Guest operations are verified by re-reading the Home Assistant switch state after the service call.

## Intentionally excluded controls

Factory reset, firmware upgrade, LAN/WAN/WISP/VPN mutation, firewall mutation, log clearing and broad service restart remain excluded because they were not validated and have a larger blast radius.

## Hardware validation

Guest POST, `servicectl/restart/guest,firewall`, and reboot were discovered but not executed in the original mapping session. The integration uses read-before-write, no blind write retry, firmware gating and final Guest verification. These operations still require supervised physical WR3000 validation before being considered production-validated.

Bandwidth remains unsupported because the discovered simple request returned HTTP 500 and required parameters are unknown. WAN online state is not inferred from panel reachability because no authoritative endpoint was confirmed.
