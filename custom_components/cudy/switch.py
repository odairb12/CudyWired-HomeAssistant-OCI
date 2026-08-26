from homeassistant.components.switch import SwitchEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .const import DOMAIN
async def async_setup_entry(hass,entry,async_add_entities):
 d=hass.data[DOMAIN][entry.entry_id]; async_add_entities([GuestSwitch(d['coordinator'],d['client'],entry.entry_id,'2.4','guest_24','Guest Wi-Fi 2.4 GHz'),GuestSwitch(d['coordinator'],d['client'],entry.entry_id,'5','guest_5','Guest Wi-Fi 5 GHz')])
class GuestSwitch(CoordinatorEntity,SwitchEntity):
 def __init__(self,c,client,eid,band,attr,name): super().__init__(c); self.client=client; self.band=band; self.attr=attr; self._attr_name=name; self._attr_unique_id=f'{eid}_guest_{band}'
 @property
 def is_on(self): return getattr(self.coordinator.data,self.attr,None)
 async def async_turn_on(self,**kwargs): await self.client.async_set_guest(self.band,True); await self.coordinator.async_request_refresh()
 async def async_turn_off(self,**kwargs): await self.client.async_set_guest(self.band,False); await self.coordinator.async_request_refresh()
