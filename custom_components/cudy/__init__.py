from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_USERNAME
from homeassistant.core import HomeAssistant
from .client import CudyClient
from .const import CONF_VERIFY_SSL, DEFAULT_SCAN_INTERVAL, DOMAIN, PLATFORMS
from .coordinator import CudyCoordinator

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    client=CudyClient(entry.data[CONF_HOST],entry.data[CONF_USERNAME],entry.data[CONF_PASSWORD],entry.options.get(CONF_VERIFY_SSL,False))
    await client.async_login()
    coordinator=CudyCoordinator(hass,client,entry.options.get('scan_interval',DEFAULT_SCAN_INTERVAL))
    await coordinator.async_config_entry_first_refresh()
    hass.data.setdefault(DOMAIN,{})[entry.entry_id]={'client':client,'coordinator':coordinator}
    await hass.config_entries.async_forward_entry_setups(entry,PLATFORMS)
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    ok=await hass.config_entries.async_unload_platforms(entry,PLATFORMS)
    if ok:
        data=hass.data[DOMAIN].pop(entry.entry_id)
        await data['client'].async_close()
    return ok
