import pytest

from custom_components.cudy.client import (
    CudyClient,
    CudyUnsupportedFirmware,
    _match,
    _reboot_apply_path,
    _form_fields,
    _bool_status,
    _sha,
)


def test_double_hash_vector():
    password, salt, token = "secret", "salt", "token"
    assert _sha(_sha(password + salt) + token) == (
        "5979d17c3412c095070041c552c86e6b0805c7732946111368d40569d3f99efe"
    )


def test_form_fields_preserves_controls():
    html = """
    <input type="hidden" name="token" value="abc">
    <input type="checkbox" name="enabled" value="1" checked>
    <input type="checkbox" name="ignored" value="1">
    <select name="encryption">
      <option value="none">None</option>
      <option value="psk2" selected>WPA2</option>
    </select>
    <textarea name="note">hello</textarea>
    """
    fields = _form_fields(html)
    assert fields["token"] == "abc"
    assert fields["enabled"] == "1"
    assert "ignored" not in fields
    assert fields["encryption"] == "psk2"
    assert fields["note"] == "hello"


def test_write_requires_confirmed_firmware():
    client = CudyClient("192.168.10.1", "admin", "secret", False)
    with pytest.raises(CudyUnsupportedFirmware):
        client._assert_write_supported()
    client.firmware = "2.4.19 US"
    client._assert_write_supported()


def test_firmware_version_label_extracts_semantic_version():
    assert _match("Firmware Version 2.4.19-20250828-192837", [r"\b(\d+\.\d+\.\d+(?:-[\w.\-]+)?)\b"]) == "2.4.19-20250828-192837"


def test_host_without_scheme_is_normalized():
    client = CudyClient("192.168.10.1", "admin", "secret", False)
    assert client.base == "http://192.168.10.1"


def test_reboot_apply_path_is_extracted_only_from_expected_luci_javascript():
    document = """<script>$.get('/cgi-bin/luci/admin/system/reboot/apply', function () {});</script>"""
    assert _reboot_apply_path(document) == "/cgi-bin/luci/admin/system/reboot/apply"
    assert _reboot_apply_path("<script>$.get('/cgi-bin/luci/admin/system/reset/apply')</script>") is None


@pytest.mark.parametrize("text", ["Status Connected", "Status Enabled", "Status SOLE", "Status Ativo"])
def test_operational_status_is_true(text):
    assert _bool_status(text) is True


@pytest.mark.parametrize("text", ["Status Disconnected", "Status Disabled", "Status Inativo"])
def test_operational_status_is_false(text):
    assert _bool_status(text) is False
