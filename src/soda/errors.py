"""User-facing messages with stable codes.

Every message the UI can show travels as ``{code, message, params}``. ``code`` is the key
the frontend translates; ``message`` is the Korean fallback that keeps the API readable on
its own from curl, from logs, and from the OpenAPI schema, and keeps the screen correct
while a translation for a new code is still missing.
"""

from typing import Any

#: Codes that accompany a failed request.
ERROR_CODES = frozenset(
    {
        # Routing and startup
        "apiNotFound",
        "frontendNotBuilt",
        "invalidRequest",
        # Element sets
        "elementsNotFound",
        "unsupportedGroup",
        "ephemerisUnavailable",
        "satelliteRefInvalid",
        # User-supplied elements
        "customElementsInvalid",
        "customElementNotFound",
        "customElementNameTaken",
        "elementFileTooLarge",
        "elementFileUnreadable",
        "elementFileWrongKind",
        "elementFileTooManyRecords",
        # User-supplied state vectors
        "stateVectorInvalid",
        "stateNotFound",
        "stateNameTaken",
        "sourceNeedsElements",
        # Imported ephemerides
        "oemInvalid",
        "oemFrameUnsupported",
        "oemTimeSystemUnsupported",
        "oemTooLarge",
        "oemTooManySamples",
        "ephemerisNotFound",
        "ephemerisNameTaken",
        "ephemerisNoOverlap",
        # Ground stations
        "stationNotFound",
        "stationNameTaken",
        # Sensor presets
        "sensorPresetNotFound",
        "sensorPresetNameTaken",
        # Propagation
        "endBeforeStart",
        "spanTooLong",
        "stepTooSmall",
        "tooManySamples",
        "sensorWidthAmbiguous",
        "propagatorNotAllowed",
        "hpopSpanTooLong",
        "hpopEpochTooFar",
        # Passes
        "passWindowTooLong",
        "noStationSelected",
        "tooManyStations",
        # Imaging opportunities
        "accessWindowTooLong",
        "noTargetSelected",
        "tooManyTargets",
        "coverageGridTooLarge",
        "coverageTooHeavy",
        # Contact plans
        "passBudgetExceeded",
        "noSatelliteSelected",
        "tooManySatellites",
        # Power budget
        "powerIntervalsTooMany",
        "powerStartOutsideRun",
        "batteryCurveInvalid",
        # Simulated TC/TM link
        "tmtcBadCommand",
        # Horizon masks
        "maskTooFewPoints",
        "maskTooManyPoints",
        "maskBadPoint",
        "maskAzimuthRange",
        "maskElevationRange",
        "maskDuplicateAzimuth",
        # Logos
        "logoNotFound",
        "logoBadName",
        "logoBusy",
        "logoBuiltinLocked",
        "logoTooLarge",
        "logoNotPng",
        "logoHeaderUnreadable",
        "logoTooWide",
        # Settings
        "databaseUrlInvalid",
        "databaseProbeFailed",
        "databaseUrlFromEnv",
        "databaseTableUnknown",
        # 3D models
        "modelNotFound",
        "modelBadName",
        "modelBusy",
        "modelTooLarge",
        "glbNotGlb",
        "glbVersion",
        "glbLengthMismatch",
        "glbJsonChunk",
        "glbExternalUri",
        # User imagery
        "imageryNotFound",
        "imageryBusy",
        "imageryTooLarge",
        "imageryTooMany",
        "imageryQueueFull",
        "imagerySidecarInvalid",
        "imageryCatalogAreaTooLarge",
        "imageryCatalogUnavailable",
        "imageryCatalogItemUnknown",
        "imageryDownloadFailed",
        "imageryDownloadNotAllowed",
        "imageryMbtilesInvalid",
        "imageryMbtilesNotRaster",
        "imageryImageUnreadable",
        "imageryCornersInvalid",
        "imageryTooManyPixels",
        "imageryGeotiffUnreadable",
        "imageryNotGeoreferenced",
        "imageryProductInvalid",
        "imagerySampleLocked",
        "imageryWarpUnavailable",
        "imageryImportFailed",
    }
)

#: Codes for notes attached to an otherwise successful response.
WARNING_CODES = frozenset(
    {
        "elementsFarFromEpoch",
        "sgp4Failures",
        "hpopFailures",
        "hpopAssumedSpacecraft",
        "ephemerisOutsideSpan",
        "historyNeedsSpaceTrack",
        "historyNotFound",
        "eclipseUnavailable",
        "powerCoarseStep",
    }
)

MESSAGE_CODES = ERROR_CODES | WARNING_CODES


def message(code: str, text: str, **params: Any) -> dict[str, Any]:
    """One user-facing message.

    Raises:
        KeyError: ``code`` is not registered above, which is always a typo.
    """
    if code not in MESSAGE_CODES:
        raise KeyError(f"unknown message code: {code!r}")
    return {"code": code, "message": text, "params": params}


class CodedError(Exception):
    """Error whose text the frontend may replace with a translation of ``code``."""

    def __init__(self, code: str, text: str, **params: Any) -> None:
        super().__init__(text)
        if code not in ERROR_CODES:
            raise KeyError(f"unknown error code: {code!r}")
        self.code = code
        self.params = params

    def as_message(self) -> dict[str, Any]:
        return message(self.code, str(self), **self.params)
