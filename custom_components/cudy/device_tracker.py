from homeassistant.components.device_tracker.config_entry import TrackerEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .const import DOMAIN
async def async_setup_entry(hass,entry,async_add_entities):
 c=hass.data[DOMAIN][entry.entry_id]['coordinator']; async_add_entities([CudyTracker(c,entry.entry_id,d.key) for d in c.data.clients])
class CudyTracker(CoordinatorEntity,TrackerEntity):
 def __init__(self,c,eid,key): super().__init__(c); self.key=key; self._attr_unique_id=f'{eid}_client_{key.replace(":","")}'
 @property
 def _device(self): return next((d for d in self.coordinator.data.clients if d.key==self.key),None)
 @property
 def is_connected(self): return bool(self._device and self._device.connected)
 @property
 def name(self): return self._device.hostname if self._device else self.key
 @property
 def ip_address(self): return self._device.ip if self._device else None
 @property
 def mac_address(self): return self._device.mac if self._device else None
