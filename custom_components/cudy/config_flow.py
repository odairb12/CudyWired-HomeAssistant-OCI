from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_USERNAME

from .client import CudyAuthError, CudyCannotConnect, CudyClient
from .const import CONF_VERIFY_SSL, DEFAULT_HOST, DEFAULT_USERNAME, DOMAIN


class CudyConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def _validate(self, data):
        raw_host = data[CONF_HOST]
        normalized = raw_host if "://" in raw_host else f"http://{raw_host}"
        parsed = urlsplit(normalized)
        if not parsed.hostname:
            raise ValueError("missing host")
        ip = ipaddress.ip_address(parsed.hostname)
        if not (ip.is_private or ip.is_loopback):
            raise ValueError("public host")
        client = CudyClient(
            normalized,
            data[CONF_USERNAME],
            data[CONF_PASSWORD],
            data.get(CONF_VERIFY_SSL, False),
        )
        try:
            await client.async_login()
            snapshot = await client.async_snapshot()
            return normalized, snapshot
        finally:
            await client.async_close()

    async def async_step_user(self, user_input=None):
        errors = {}
        if user_input:
            try:
                normalized, snapshot = await self._validate(user_input)
                await self.async_set_unique_id(snapshot.lan_ip or normalized)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title="Cudy WR3000",
                    data={
                        CONF_HOST: normalized,
                        CONF_USERNAME: user_input[CONF_USERNAME],
                        CONF_PASSWORD: user_input[CONF_PASSWORD],
                    },
                    options={CONF_VERIFY_SSL: user_input[CONF_VERIFY_SSL]},
                )
            except CudyAuthError:
                errors["base"] = "invalid_auth"
            except (CudyCannotConnect, ValueError):
                errors["base"] = "cannot_connect"

        schema = vol.Schema(
            {
                vol.Required(CONF_HOST, default=DEFAULT_HOST): str,
                vol.Required(CONF_USERNAME, default=DEFAULT_USERNAME): str,
                vol.Required(CONF_PASSWORD): str,
                vol.Required(CONF_VERIFY_SSL, default=False): bool,
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    async def async_step_reauth(self, entry_data):
        self._reauth_entry = self._get_reauth_entry()
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input=None):
        errors = {}
        if user_input:
            data = {
                CONF_HOST: self._reauth_entry.data[CONF_HOST],
                CONF_USERNAME: self._reauth_entry.data[CONF_USERNAME],
                CONF_PASSWORD: user_input[CONF_PASSWORD],
                CONF_VERIFY_SSL: self._reauth_entry.options.get(CONF_VERIFY_SSL, False),
            }
            try:
                await self._validate(data)
                return self.async_update_reload_and_abort(
                    self._reauth_entry,
                    data_updates={CONF_PASSWORD: user_input[CONF_PASSWORD]},
                )
            except CudyAuthError:
                errors["base"] = "invalid_auth"
            except (CudyCannotConnect, ValueError):
                errors["base"] = "cannot_connect"

        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema({vol.Required(CONF_PASSWORD): str}),
            errors=errors,
        )
