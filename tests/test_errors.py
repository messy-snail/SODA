import ast
from pathlib import Path

import pytest

from soda.api.errors import ApiError
from soda.errors import ERROR_CODES, MESSAGE_CODES, WARNING_CODES, CodedError, message

SOURCE = Path(__file__).parents[1] / "src" / "soda"


def test_api_error_detail_carries_code_and_params():
    error = ApiError(404, "stationNotFound", "지상국 없음", ids=[9])
    assert error.status_code == 404
    assert error.detail == {
        "code": "stationNotFound",
        "message": "지상국 없음",
        "params": {"ids": [9]},
    }


def test_api_error_wraps_a_domain_error():
    domain = CodedError("spanTooLong", "전파 기간은 최대 30일", days=30)
    wrapped = ApiError.of(422, domain)
    assert wrapped.status_code == 422
    assert wrapped.detail == domain.as_message()


def test_unknown_codes_are_rejected():
    with pytest.raises(KeyError):
        message("nothingLikeThis", "…")
    with pytest.raises(KeyError):
        CodedError("nothingLikeThis", "…")
    # A warning code must not be usable as an error and the other way round.
    with pytest.raises(KeyError):
        CodedError("elementsFarFromEpoch", "…")


def test_error_and_warning_codes_do_not_overlap():
    assert not ERROR_CODES & WARNING_CODES
    assert MESSAGE_CODES == ERROR_CODES | WARNING_CODES


def _literal_codes() -> set[str]:
    """First string argument of every ApiError/CodedError-style call under src/soda."""
    builders = {
        "ApiError",
        "CodedError",
        "PropagationRequestError",
        "AccessRequestError",
        "CoverageRequestError",
        "ContactRequestError",
        "PowerRequestError",
        "BatteryCurveError",
        "LogoError",
        "GlbError",
        "ImageryError",
        "ElementsUnavailable",
        "message",
    }
    found: set[str] = set()
    for path in SOURCE.rglob("*.py"):
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = (
                node.func.attr
                if isinstance(node.func, ast.Attribute)
                else getattr(node.func, "id", None)
            )
            if name not in builders or not node.args:
                continue
            # ApiError takes the status code first; every other builder takes the code.
            index = 1 if name == "ApiError" else 0
            if len(node.args) > index and isinstance(node.args[index], ast.Constant):
                value = node.args[index].value
                if isinstance(value, str):
                    found.add(value)
    return found


def test_every_code_used_in_the_source_is_registered():
    """The registry is what the frontend translates, so nothing may be raised outside it."""
    used = _literal_codes()
    assert used, "no coded messages found; the AST scan is looking in the wrong place"
    assert used <= MESSAGE_CODES, sorted(used - MESSAGE_CODES)


def test_registry_has_no_unused_codes():
    assert _literal_codes() | {"invalidRequest"} >= MESSAGE_CODES, sorted(
        MESSAGE_CODES - _literal_codes() - {"invalidRequest"}
    )
