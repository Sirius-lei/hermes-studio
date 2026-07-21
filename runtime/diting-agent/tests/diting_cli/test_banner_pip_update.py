from unittest.mock import patch


def testcheck_via_pypi_detects_update():
    """check_via_pypi returns 1 when PyPI has newer version."""
    from diting_cli.banner import check_via_pypi
    with patch("diting_cli.banner.VERSION", "0.12.0"):
        with patch("diting_cli.banner._fetch_pypi_latest", return_value="0.13.0"):
            result = check_via_pypi()
            assert result == 1


def testcheck_via_pypi_up_to_date():
    """check_via_pypi returns 0 when versions match."""
    from diting_cli.banner import check_via_pypi
    with patch("diting_cli.banner.VERSION", "0.13.0"):
        with patch("diting_cli.banner._fetch_pypi_latest", return_value="0.13.0"):
            result = check_via_pypi()
            assert result == 0


def testcheck_via_pypi_network_failure():
    """check_via_pypi returns None on network error."""
    from diting_cli.banner import check_via_pypi
    with patch("diting_cli.banner._fetch_pypi_latest", return_value=None):
        result = check_via_pypi()
        assert result is None


def test_version_tuple_comparison():
    """Version comparison works with multi-segment versions."""
    from diting_cli.banner import _version_tuple
    assert _version_tuple("0.13.0") > _version_tuple("0.12.0")
    assert _version_tuple("0.13.0") == _version_tuple("0.13.0")
    assert _version_tuple("1.0.0") > _version_tuple("0.99.99")


def test_update_check_skips_network_in_offline_mode(monkeypatch):
    from diting_cli import banner

    monkeypatch.setenv("DiTing_OFFLINE", "1")
    with patch.object(banner, "_fetch_pypi_latest") as fetch:
        assert banner.check_for_updates() is None
    fetch.assert_not_called()
