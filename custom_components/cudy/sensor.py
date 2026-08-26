from dataclasses import dataclass
from homeassistant.components.sensor import SensorEntity, SensorEntityDescription
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .const import DOMAIN

@dataclass(frozen=True,kw_only=True)
class Desc(SensorEntityDescription): attr:str
DESCS=[Desc(key='uptime',name='Uptime',attr='uptime'),Desc(key='firmware',name='Firmware',attr='firmware'),Desc(key='lan_ip',name='LAN IP',attr='lan_ip'),Desc(key='connected_clients',name='Connected clients',attr='connected_clients'),Desc(key='wisp_signal',name='WISP signal',attr='wisp_signal'),Desc(key='vpn_protocol',name='VPN protocol',attr='vpn_protocol'),Desc(key='wifi_channel',name='Wi-Fi channel',attr='wifi_channel')]
async def async_setup_entry(hass,entry,async_add_entities):
    c=hass.data[DOMAIN][entry.entry_id]['coordinator']; async_add_entities([CudySensor(c,d,entry.entry_id) for d in DESCS])
class CudySensor(CoordinatorEntity,SensorEntity):
    def __init__(self,c,d,eid): super().__init__(c); self.entity_description=d; self._attr_unique_id=f'{eid}_{d.key}'
    @property
    def native_value(self): return getattr(self.coordinator.data,self.entity_description.attr,None)
