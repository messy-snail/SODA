"""Size-limited request bodies for file uploads."""

import asyncio
import contextlib
from pathlib import Path

from fastapi import Request

from .errors import ApiError


async def read_limited_body(request: Request, max_bytes: int, too_large: ApiError) -> bytes:
    """Read the raw request body, rejecting it as soon as it exceeds ``max_bytes``.

    Args:
        request: Incoming upload request.
        max_bytes: Largest accepted body.
        too_large: Prepared 413 error raised when the body does not fit.

    Raises:
        ApiError: 413 when the declared or streamed body is too large.
    """
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > max_bytes:
        raise too_large
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > max_bytes:
            raise too_large
    return bytes(body)


async def stream_limited_body(
    request: Request, target: Path, max_bytes: int, too_large: ApiError
) -> int:
    """Write the raw request body to ``target`` without holding it in memory.

    The partial file is removed when the body is too large or the client goes away.

    Args:
        request: Incoming upload request.
        target: File to create; its directory must exist.
        max_bytes: Largest accepted body.
        too_large: Prepared 413 error raised when the body does not fit.

    Returns:
        The number of bytes written.

    Raises:
        ApiError: 413 when the declared or streamed body is too large.
    """
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > max_bytes:
        raise too_large
    written = 0
    try:
        with target.open("wb") as output:
            async for chunk in request.stream():
                written += len(chunk)
                if written > max_bytes:
                    raise too_large
                await asyncio.to_thread(output.write, chunk)
    except BaseException:
        with contextlib.suppress(OSError):
            target.unlink()
        raise
    return written
