from __future__ import annotations
from homeassistant.components.diagnostics import async_redact_data
TO_REDACT={'password','key','token','_csrf','salt','sysauth','mac','ip','lan_ip'}
async def async_get_config_entry_diagnostics(hass,entry):
 data=hass.data['cudy'][entry.entry_id]; snap=data['coordinator'].data
 payload={'entry':dict(entry.data),'state':{'uptime':snap.uptime,'firmware':snap.firmware,'connected_clients':snap.connected_clients,'wisp_connected':snap.wisp_connected,'wisp_signal':snap.wisp_signal,'vpn_connected':snap.vpn_connected,'vpn_protocol':snap.vpn_protocol,'guest_24':snap.guest_24,'guest_5':snap.guest_5}}
 return async_redact_data(payload,TO_REDACT)
