import pytest
from custom_components.cudy.client import _form_fields, _sha, CudyClient, CudyUnsupportedFirmware


def test_double_hash_vector():
    password, salt, token = 'secret', 'salt', 'token'
    assert _sha(_sha(password + salt) + token) == '625e8b3f25b8c2cf41d77e32af7ed6b2d19e1eab33a67f989a4b6499995b21c8'


def test_form_fields_preserves_controls():
    html = '''
    <input type="hidden" name="token" value="abc">
    <input type="checkbox" name="enabled" value="1" checked>
    <input type="checkbox" name="ignored" value="1">
    <select name="encryption"><option value="none">None</option><option value="psk2" selected>WPA2</option></select>
    <textarea name="note">hello</textarea>
    '''
    fields = _form_fields(html)
    assert fields['token'] == 'abc'
    assert fields['enabled'] == '1'
    assert 'ignored' not in fields
    assert fields['encryption'] == 'psk2'
    assert fields['note'] == 'hello'


def test_write_requires_confirmed_firmware():
    client = CudyClient('192.168.10.1', 'admin', 'secret', False)
    with pytest.raises(CudyUnsupportedFirmware):
        client._assert_write_supported()
    client.firmware = '2.4.19 US'
    client._assert_write_supported()
