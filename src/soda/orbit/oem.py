"""CCSDS OEM ephemerides: read one in, sample it, and write one out.

An OEM is a table of states somebody else already propagated. SODA does not propagate it
again: "propagating" such a satellite means interpolating the table, and only inside the
span the table covers.
"""

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import numpy as np

from ..errors import CodedError, message
from ..gp import ndm
from .frames import frame_family, to_gcrs
from .interpolate import DEFAULT_DEGREE, clamp_degree, lagrange
from .kepler import specific_energy
from .propagator import (
    Ephemeris,
    PropagationRequestError,
    as_utc,
    ephemeris_from_gcrs,
    sample_offsets,
    times_at,
    timescale,
)

MAX_OEM_BYTES = 32 * 1024 * 1024
MAX_OEM_SAMPLES = 200_000
MAX_NAME_LENGTH = 60

_KEY_VALUE = re.compile(r"^([A-Z0-9_]+)\s*=\s*(.*)$")
STATE_TAGS = ("X", "Y", "Z", "X_DOT", "Y_DOT", "Z_DOT")


@dataclass(frozen=True)
class StoredEphemeris:
    """An imported ephemeris in GCRS, as it is kept and sampled."""

    name: str
    object_id: str
    #: Frame the file was in.
    frame: str
    #: Time of the first sample, UTC.
    start: datetime
    #: ``(N, 7)``: seconds after ``start``, position in m, velocity in m/s.
    samples: np.ndarray
    #: ``(first, end)`` row ranges of the file's segments; nothing is interpolated across one.
    segments: tuple[tuple[int, int], ...]
    #: Lagrange degree to interpolate with.
    degree: int

    @property
    def stop(self) -> datetime:
        return self.start + timedelta(seconds=float(self.samples[-1, 0]))

    def meta(self) -> dict[str, Any]:
        """What is stored next to the samples."""
        return {
            "object_id": self.object_id,
            "frame": self.frame,
            "degree": self.degree,
            "segments": [list(segment) for segment in self.segments],
        }


@dataclass
class _Segment:
    meta: dict[str, str]
    epochs: list[datetime]
    states: list[list[float]]


def _invalid(text: str) -> CodedError:
    return CodedError("oemInvalid", f"OEM 형식 오류 · {text}", reason=text)


def _kvn_segments(text: str) -> tuple[dict[str, str], list[_Segment]]:
    header: dict[str, str] = {}
    segments: list[_Segment] = []
    block = "header"
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("COMMENT"):
            continue
        if line == "META_START":
            segments.append(_Segment({}, [], []))
            block = "meta"
        elif line == "META_STOP":
            block = "data"
        elif line == "COVARIANCE_START":
            block = "covariance"
        elif line == "COVARIANCE_STOP":
            block = "data"
        elif block == "header" or block == "meta":
            match = _KEY_VALUE.match(line)
            if not match:
                raise ValueError(f"unexpected line {line[:40]!r}")
            (header if block == "header" else segments[-1].meta)[match.group(1)] = match.group(2)
        elif block == "data":
            fields = line.split()
            if len(fields) < 7:
                raise ValueError(f"an ephemeris line needs an epoch and six values: {line[:40]!r}")
            segments[-1].epochs.append(ndm.parse_epoch(fields[0]))
            segments[-1].states.append([float(value) for value in fields[1:7]])
    return header, segments


def _xml_segments(text: str) -> tuple[dict[str, str], list[_Segment]]:
    root = ndm.parse_xml(text)
    oem = root if root.tag == "oem" else root.find(".//oem")
    if oem is None:
        raise ValueError("no OEM in the document")
    header = {"CCSDS_OEM_VERS": oem.get("version", "")}
    segments: list[_Segment] = []
    for element in oem.iter("segment"):
        metadata = element.find("metadata")
        segment = _Segment(ndm.leaf_values(metadata) if metadata is not None else {}, [], [])
        for vector in element.iter("stateVector"):
            values = ndm.leaf_values(vector)
            segment.epochs.append(ndm.parse_epoch(values["EPOCH"]))
            segment.states.append([float(values[tag]) for tag in STATE_TAGS])
        segments.append(segment)
    return header, segments


def parse_oem(text: str, name: str | None = None) -> StoredEphemeris:
    """Read a CCSDS OEM, KVN or XML, into GCRS samples.

    The centre must be the Earth and the time system UTC. Accelerations and covariances are
    ignored. Segments are kept apart, and all of them must be in one frame.

    Args:
        text: Decoded file contents.
        name: Name to store it under; defaults to the file's ``OBJECT_NAME``.

    Raises:
        CodedError: ``oemInvalid``, ``oemFrameUnsupported``, ``oemTimeSystemUnsupported``,
            or ``oemTooManySamples``.
    """
    stripped = text.removeprefix("﻿").lstrip()
    try:
        if stripped.startswith("<"):
            header, segments = _xml_segments(stripped)
        else:
            header, segments = _kvn_segments(stripped)
            if "CCSDS_OEM_VERS" not in header:
                raise ValueError("not an OEM: CCSDS_OEM_VERS is missing")
    except (KeyError, ValueError, IndexError) as error:
        raise _invalid("읽을 수 없는 파일") from error
    segments = [segment for segment in segments if segment.epochs]
    if not segments:
        raise _invalid("ephemeris 줄 없음")
    count = sum(len(segment.epochs) for segment in segments)
    if count > MAX_OEM_SAMPLES:
        raise CodedError(
            "oemTooManySamples",
            f"OEM 샘플 {count:,}개가 최대 {MAX_OEM_SAMPLES:,}개 초과",
            count=count,
            max=MAX_OEM_SAMPLES,
        )
    if count < 2:
        raise _invalid("샘플이 2개 이상 필요")

    meta = segments[0].meta
    frame = meta.get("REF_FRAME", "").strip().upper()
    for segment in segments:
        if segment.meta.get("CENTER_NAME", "EARTH").strip().upper() != "EARTH":
            raise _invalid("CENTER_NAME은 EARTH여야 함")
        time_system = segment.meta.get("TIME_SYSTEM", "").strip().upper()
        if time_system != "UTC":
            raise CodedError(
                "oemTimeSystemUnsupported",
                f"OEM 시간계 {time_system or '없음'} 미지원 · UTC만 가능",
                time_system=time_system,
            )
        if segment.meta.get("REF_FRAME", "").strip().upper() != frame:
            raise _invalid("세그먼트마다 좌표계가 다름")
    if frame_family(frame) is None:
        raise CodedError(
            "oemFrameUnsupported",
            f"OEM 좌표계 {frame or '없음'} 미지원 · EME2000·GCRF·ICRF·ITRF·TEME 가능",
            frame=frame,
        )

    epochs = [epoch for segment in segments for epoch in segment.epochs]
    start = epochs[0]
    seconds = np.array([(epoch - start).total_seconds() for epoch in epochs])
    if not (np.diff(seconds) > 0).all():
        raise _invalid("시각이 증가하는 순서가 아님")
    states = np.array([state for segment in segments for state in segment.states]) * 1000.0
    if not np.isfinite(states).all():
        raise _invalid("값이 숫자가 아님")
    position, velocity = states[:, :3], states[:, 3:]
    if frame_family(frame) != "gcrs":
        position, velocity = to_gcrs(frame, timescale().from_datetimes(epochs), position, velocity)

    bounds: list[tuple[int, int]] = []
    first = 0
    for segment in segments:
        bounds.append((first, first + len(segment.epochs)))
        first += len(segment.epochs)
    try:
        degree = int(meta.get("INTERPOLATION_DEGREE", DEFAULT_DEGREE))
    except ValueError:
        degree = DEFAULT_DEGREE
    # The detail view describes the orbit through the first sample, so it has to be one.
    if not specific_energy(position[0], velocity[0]) < 0:
        raise _invalid("지구에 묶인 궤도가 아님")
    stored_name = (name or meta.get("OBJECT_NAME", "")).strip()[:MAX_NAME_LENGTH]
    if not stored_name:
        raise _invalid("이름 없음")
    return StoredEphemeris(
        name=stored_name,
        object_id=meta.get("OBJECT_ID", "").strip(),
        frame=frame,
        start=start,
        samples=np.column_stack([seconds, position, velocity]),
        segments=tuple(bounds),
        degree=clamp_degree(degree, min(end - begin for begin, end in bounds)),
    )


def interpolate_ephemeris(
    stored: StoredEphemeris, start: datetime, end: datetime, step_s: float
) -> Ephemeris:
    """Sample a stored ephemeris on a regular time grid.

    Samples outside the stored span, or in a gap between two segments, are marked invalid.

    Args:
        stored: The imported ephemeris.
        start: Window start (naive values are UTC).
        end: Window end.
        step_s: Sample spacing in seconds.

    Raises:
        PropagationRequestError: Window, step, or sample count out of range, or
            ``ephemerisNoOverlap`` when the window misses the stored span entirely.
    """
    start, end = as_utc(start), as_utc(end)
    offsets = sample_offsets(start, end, step_s)
    query = (start - stored.start).total_seconds() + offsets
    states = np.full((len(query), 6), np.nan)
    table = stored.samples
    for first, last in stored.segments:
        nodes = table[first:last, 0]
        inside = (query >= nodes[0]) & (query <= nodes[-1])
        if inside.any() and last - first >= 2:
            degree = clamp_degree(stored.degree, last - first)
            states[inside] = lagrange(nodes, table[first:last, 1:], query[inside], degree)
    valid = np.isfinite(states).all(axis=1)
    if not valid.any():
        raise PropagationRequestError(
            "ephemerisNoOverlap",
            "전파 구간이 ephemeris 파일의 구간과 겹치지 않음",
            start=stored.start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            end=stored.stop.strftime("%Y-%m-%dT%H:%M:%SZ"),
        )
    warnings: list[dict[str, Any]] = []
    if not valid.all():
        outside = int((~valid).sum())
        warnings.append(
            message(
                "ephemerisOutsideSpan",
                f"{outside}개 샘플이 ephemeris 파일 구간 밖",
                count=outside,
            )
        )
    t = times_at(start, offsets)
    return ephemeris_from_gcrs(start, step_s, t, states[:, :3], states[:, 3:], valid, warnings)


def write_oem(ephemeris: Ephemeris, name: str, object_id: str = "") -> str:
    """Render a propagated trajectory as a CCSDS OEM (KVN, GCRF, UTC).

    Invalid samples are left out. The result reads back with ``parse_oem``.
    """
    if ephemeris.inertial_velocity_m_s is None:
        raise ValueError("the trajectory carries no inertial velocity")
    keep = ephemeris.valid.nonzero()[0]
    epochs = [
        ephemeris.start + timedelta(seconds=float(index) * ephemeris.step_s) for index in keep
    ]

    def stamp(value: datetime) -> str:
        return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")

    lines = [
        "CCSDS_OEM_VERS = 2.0",
        f"CREATION_DATE = {stamp(datetime.now(UTC))}",
        "ORIGINATOR = SODA",
        "",
        "META_START",
        f"OBJECT_NAME = {name}",
        f"OBJECT_ID = {object_id or 'UNKNOWN'}",
        "CENTER_NAME = EARTH",
        "REF_FRAME = GCRF",
        "TIME_SYSTEM = UTC",
        f"START_TIME = {stamp(epochs[0])}",
        f"STOP_TIME = {stamp(epochs[-1])}",
        "INTERPOLATION = LAGRANGE",
        f"INTERPOLATION_DEGREE = {DEFAULT_DEGREE}",
        "META_STOP",
        "",
    ]
    position_km = ephemeris.inertial_m[keep] / 1000.0
    velocity_km_s = ephemeris.inertial_velocity_m_s[keep] / 1000.0
    for epoch, r, v in zip(epochs, position_km, velocity_km_s, strict=True):
        values = " ".join(f"{value:.9f}" for value in (*r, *v))
        lines.append(f"{stamp(epoch)} {values}")
    return "\n".join(lines) + "\n"
