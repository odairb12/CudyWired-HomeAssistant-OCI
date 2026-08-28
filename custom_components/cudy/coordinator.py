from __future__ import annotations

import logging
from datetime import timedelta

from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .client import CudyAuthError, CudyError
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


class CudyCoordinator(DataUpdateCoordinator):
    def __init__(self, hass, entry, client, interval=30):
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=DOMAIN,
            update_interval=timedelta(seconds=interval),
        )
        self.client = client

    async def _async_update_data(self):
        try:
            return await self.client.async_snapshot()
        except CudyAuthError as exc:
            raise ConfigEntryAuthFailed from exc
        except CudyError as exc:
            raise UpdateFailed(str(exc)) from exc
