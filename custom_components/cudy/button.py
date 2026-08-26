from __future__ import annotations
import time
from homeassistant.components.button import ButtonEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .client import CudyApplyError, CudyCannotConnect, _inputs
from .const import DOMAIN

async def async_setup_entry(hass, entry, async_add_entities):
    data = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([CudyRebootButton(data['coordinator'], data['client'], entry.entry_id)])

class CudyRebootButton(CoordinatorEntity, ButtonEntity):
    _attr_name = 'Reboot router'
    _attr_icon = 'mdi:restart'

    def __init__(self, coordinator, client, entry_id):
        super().__init__(coordinator)
        self.client = client
        self._attr_unique_id = f'{entry_id}_reboot'

    async def async_press(self) -> None:
        self.client._assert_write_supported()
        doc = await self.client.async_get('/cgi-bin/luci/admin/system/reboot')
        fields = _inputs(doc)
        if not fields.get('token'):
            raise CudyApplyError('Reboot form token missing')
        fields['timeclock'] = str(int(time.time()))
        fields['cbi.submit'] = '1'
        try:
            await self.client._request('POST', '/cgi-bin/luci/admin/system/reboot', data=fields, retry_get=False)
        except CudyCannotConnect:
            # The router can close the socket after accepting reboot. This is
            # deliberately not retried; callers should treat it as unconfirmed.
            return
