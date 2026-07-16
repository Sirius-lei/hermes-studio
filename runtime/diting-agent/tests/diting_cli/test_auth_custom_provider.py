"""Named custom providers are accepted by shared auth resolution."""

import pytest

from diting_cli.auth import AuthError, resolve_provider


def test_resolve_provider_accepts_configured_named_custom_provider(monkeypatch):
    custom_entry = {
        "name": "Api.unifyllm.top",
        "base_url": "https://api.unifyllm.top/v1",
        "model": "gpt-5.4",
    }
    monkeypatch.setattr(
        "diting_cli.config.load_config",
        lambda: {"custom_providers": [custom_entry]},
    )
    monkeypatch.setattr(
        "diting_cli.config.get_compatible_custom_providers",
        lambda _config: [custom_entry],
    )

    assert resolve_provider("custom:api.unifyllm.top") == "custom"


def test_resolve_provider_rejects_unknown_named_custom_provider(monkeypatch):
    monkeypatch.setattr("diting_cli.config.load_config", lambda: {})
    monkeypatch.setattr(
        "diting_cli.config.get_compatible_custom_providers",
        lambda _config: [],
    )

    with pytest.raises(AuthError, match="Unknown provider"):
        resolve_provider("custom:not-configured")
