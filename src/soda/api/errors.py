"""HTTP errors that carry a translation code alongside their Korean text."""

from typing import Any

from fastapi import HTTPException

from ..errors import CodedError, message


class ApiError(HTTPException):
    """``HTTPException`` whose ``detail`` is a ``{code, message, params}`` object."""

    def __init__(self, status_code: int, code: str, text: str, **params: Any) -> None:
        super().__init__(status_code, message(code, text, **params))

    @classmethod
    def of(cls, status_code: int, error: CodedError) -> "ApiError":
        """Wrap a domain error, keeping the code it already chose."""
        return cls(status_code, error.code, str(error), **error.params)
