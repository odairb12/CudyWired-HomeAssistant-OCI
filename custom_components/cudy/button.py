from __future__ import annotations
import time
from homeassistant.components.button import ButtonEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .client import CudyApplyError, CudyCannotConnect, CudyUnsupportedFirmware, _inputs
from .const import DOMAIN, SUPPORTED_FIRMWARE_PREFIX

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
        if self.client.firmware and not self.client.firmware.startswith(SUPPORTED_FIRMWARE_PREFIX):
            raise CudyUnsupportedFirmware(f'Writes blocked on firmware {self.client.firmware}')

        # Reboot is intentionally a no-retry operation. Read the authenticated
        # form immediately before POSTing and preserve all hidden CBI fields.
        doc = await self.client.async_get('/cgi-bin/luci/admin/system/reboot')
        fields = _inputs(doc)
        if not fields.get('token'):
            raise CudyApplyError('Reboot form token missing')
        fields['timeclock'] = str(int(time.time()))
        fields['cbi.submit'] = '1'

        try:
            await self.client._request(
                'POST', '/cgi-bin/luci/admin/system/reboot', data=fields, retry_get=False
            )
        except CudyCannotConnect:
            # A reboot commonly closes the HTTP connection immediately after
            # accepting the command. Do not retry because a duplicate reboot
            # command is not safe or useful.
            return
