from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .const import DOMAIN
async def async_setup_entry(hass,entry,async_add_entities):
 c=hass.data[DOMAIN][entry.entry_id]['coordinator']; async_add_entities([CudyBinary(c,entry.entry_id,'wisp_connected','WISP'),CudyBinary(c,entry.entry_id,'vpn_connected','VPN')])
class CudyBinary(CoordinatorEntity,BinarySensorEntity):
 def __init__(self,c,eid,attr,name): super().__init__(c); self.attr=attr; self._attr_name=name; self._attr_unique_id=f'{eid}_{attr}'
 @property
 def is_on(self): return getattr(self.coordinator.data,self.attr,None)
