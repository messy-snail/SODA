"""Request models and JSON helpers shared by API routers."""

from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any, ClassVar, Literal, Self

import numpy as np
from pydantic import BaseModel, Field, model_validator

from ..gp.classify import classify
from ..gp.models import ElementSet
from ..gp.store import CustomElements, SensorPreset, Station
from ..imagery.limits import (
    MAX_ATTRIBUTION_LENGTH,
    MAX_CATALOG_IMPORT_ITEMS,
    MAX_LICENSE_LENGTH,
    MAX_NAME_LENGTH,
)
from ..orbit.access import Target
from ..orbit.access_geometry import Pointing
from ..orbit.battery import MAX_OCV_POINTS, Battery
from ..orbit.contacts import DEFAULT_TURNAROUND_S, MAX_TURNAROUND_S
from ..orbit.horizon import MAX_MASK_POINTS, HorizonMask
from ..orbit.hpop.constants import DEFAULT_GRAVITY_DEGREE, MAX_GRAVITY_DEGREE
from ..orbit.hpop.propagate import HpopOptions
from ..orbit.passes import MAX_STATIONS
from ..orbit.power import ContactAttitude, PowerSpec
from ..orbit.propagation import Propagator
from ..orbit.propagator import PropagationRequestError, orbit_summary, tle_lines


class SatelliteRef(BaseModel):
    """Which satellite a request is about: exactly one of the ids.

    ``norad_id`` and ``custom_id`` name mean elements, which every endpoint can use.
    ``state_id`` names a state vector and ``ephemeris_id`` an imported ephemeris; neither
    has elements, so a request model that needs them sets ``elements_only``.
    """

    elements_only: ClassVar[bool] = False

    norad_id: int | None = Field(default=None, gt=0)
    custom_id: int | None = Field(default=None, gt=0)
    state_id: int | None = Field(default=None, gt=0)
    ephemeris_id: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def one_satellite(self) -> Self:
        given = [self.norad_id, self.custom_id, self.state_id, self.ephemeris_id]
        if sum(value is not None for value in given) != 1:
            raise PropagationRequestError(
                "satelliteRefInvalid",
                "norad_id, custom_id, state_id, ephemeris_id 중 하나만 지정 필요",
            )
        if self.elements_only and self.norad_id is None and self.custom_id is None:
            raise PropagationRequestError(
                "sourceNeedsElements",
                "상태벡터·ephemeris로는 계산 불가 · 궤도요소(TLE·OMM)가 있는 위성 필요",
                kind="state" if self.state_id is not None else "ephemeris",
            )
        return self


class HpopOptionsModel(BaseModel):
    """HPOP force model and spacecraft. Spacecraft fields left out are estimated."""

    gravity_degree: int = Field(default=DEFAULT_GRAVITY_DEGREE, ge=2, le=MAX_GRAVITY_DEGREE)
    #: ``None`` means the same as the degree.
    gravity_order: int | None = Field(default=None, ge=0, le=MAX_GRAVITY_DEGREE)
    third_body: bool = True
    drag: bool = True
    srp: bool = True
    mass_kg: float | None = Field(default=None, gt=0, le=1e6)
    drag_area_m2: float | None = Field(default=None, gt=0, le=1e4)
    cd: float | None = Field(default=None, gt=0, le=10)
    srp_area_m2: float | None = Field(default=None, gt=0, le=1e4)
    cr: float | None = Field(default=None, gt=0, le=3)

    @model_validator(mode="after")
    def order_within_degree(self) -> Self:
        if self.gravity_order is not None and self.gravity_order > self.gravity_degree:
            raise ValueError("gravity_order must not exceed gravity_degree")
        return self

    def options(self) -> HpopOptions:
        return HpopOptions(**self.model_dump())


class PropagateRequest(SatelliteRef):
    start: datetime
    end: datetime
    step_s: float = Field(default=30.0, ge=1.0, le=3600.0)
    #: ``None`` picks the default for the kind of source the satellite comes from.
    propagator: Propagator | None = None
    #: Only read when the propagator is ``hpop``.
    hpop: HpopOptionsModel | None = None


class SensorModel(BaseModel):
    fov_deg: float | None = Field(default=None, gt=0, lt=179)
    swath_km: float | None = Field(default=None, gt=0, le=5000)
    max_off_nadir_deg: float = Field(default=0.0, ge=0, lt=89)
    min_sun_elev_deg: float = Field(default=10.0, ge=-18, le=90)

    @model_validator(mode="after")
    def one_width(self) -> Self:
        if (self.fov_deg is None) == (self.swath_km is None):
            raise PropagationRequestError(
                "sensorWidthAmbiguous", "fov_deg와 swath_km 중 하나만 지정 필요"
            )
        return self


class SwathRequest(PropagateRequest):
    sensor: SensorModel


class AccessTarget(BaseModel):
    """A ground point, or a box when all four edges are given (``east < west`` wraps)."""

    id: str = Field(min_length=1, max_length=64)
    lat_deg: float | None = Field(default=None, ge=-90, le=90)
    lon_deg: float | None = Field(default=None, ge=-180, le=180)
    west_deg: float | None = Field(default=None, ge=-180, le=180)
    south_deg: float | None = Field(default=None, ge=-90, le=90)
    east_deg: float | None = Field(default=None, ge=-180, le=180)
    north_deg: float | None = Field(default=None, ge=-90, le=90)

    @model_validator(mode="after")
    def point_or_box(self) -> Self:
        point = (self.lat_deg, self.lon_deg)
        box = (self.west_deg, self.south_deg, self.east_deg, self.north_deg)
        is_point = all(v is not None for v in point) and all(v is None for v in box)
        is_box = all(v is not None for v in box) and all(v is None for v in point)
        if not (is_point or is_box):
            raise ValueError("either lat_deg/lon_deg or all four box edges")
        if is_box and self.south_deg >= self.north_deg:  # type: ignore[operator]
            raise ValueError("south_deg must be below north_deg")
        return self

    def target(self) -> Target:
        if self.lat_deg is not None and self.lon_deg is not None:
            return Target.point(self.id, self.lat_deg, self.lon_deg)
        assert self.west_deg is not None and self.south_deg is not None
        assert self.east_deg is not None and self.north_deg is not None
        return Target.box(self.id, self.west_deg, self.south_deg, self.east_deg, self.north_deg)


class PointingFields(BaseModel):
    """How far the sensor can point; see ``orbit.access`` for the two pointing models."""

    mode: Literal["roll", "roll_pitch"] = "roll"
    max_roll_deg: float = Field(gt=0, lt=89)
    max_pitch_deg: float = Field(default=30.0, ge=0, lt=89)
    fov_deg: float = Field(default=0.0, ge=0, lt=179)
    min_sun_elev_deg: float = Field(default=10.0, ge=-90, le=90)

    def pointing(self) -> Pointing:
        return Pointing(
            self.mode, self.max_roll_deg, self.max_pitch_deg, self.fov_deg, self.min_sun_elev_deg
        )


class AccessRequest(SatelliteRef, PointingFields):
    """Imaging opportunity search."""

    elements_only: ClassVar[bool] = True

    targets: list[AccessTarget]
    start: datetime
    end: datetime
    #: Length of one acquisition; sets the strip drawn for each window.
    shot_s: float = Field(default=10.0, ge=1, le=600)


class CoverageRequest(SatelliteRef, PointingFields):
    """Imaging events of every cell of a grid over a box (``east < west`` wraps)."""

    elements_only: ClassVar[bool] = True

    west_deg: float = Field(ge=-180, le=180)
    south_deg: float = Field(ge=-90, le=90)
    east_deg: float = Field(ge=-180, le=180)
    north_deg: float = Field(ge=-90, le=90)
    nx: int = Field(ge=1)
    ny: int = Field(ge=1)
    start: datetime
    end: datetime

    @model_validator(mode="after")
    def box_has_area(self) -> Self:
        if self.south_deg >= self.north_deg:
            raise ValueError("south_deg must be below north_deg")
        if self.west_deg == self.east_deg:
            raise ValueError("west_deg and east_deg must differ")
        return self

    def box(self) -> tuple[float, float, float, float]:
        return (self.west_deg, self.south_deg, self.east_deg, self.north_deg)


class PassSatellite(SatelliteRef):
    """One satellite of a pass prediction and the span searched (its propagated run)."""

    elements_only: ClassVar[bool] = True

    start: datetime
    end: datetime


class PassesRequest(BaseModel):
    """Satellites in priority order (first wins a conflict) over the same stations."""

    satellites: list[PassSatellite]
    station_ids: list[int] = Field(min_length=1, max_length=MAX_STATIONS)
    min_elev_deg: float | None = Field(default=None, ge=0, le=89)
    turnaround_s: float = Field(default=DEFAULT_TURNAROUND_S, ge=0, le=MAX_TURNAROUND_S)

    @model_validator(mode="after")
    def unique_stations(self) -> Self:
        """Drop repeats but keep the order, which is what fixes each station's colour."""
        object.__setattr__(self, "station_ids", list(dict.fromkeys(self.station_ids)))
        return self


class PowerShot(BaseModel):
    """One imaging acquisition and the attitude it is taken at."""

    start: datetime
    end: datetime
    roll_deg: float = Field(default=0.0, gt=-89, lt=89)
    pitch_deg: float = Field(default=0.0, gt=-89, lt=89)


class PowerContact(BaseModel):
    """One ground contact; ``downlink`` picks which of the two contact loads it draws."""

    start: datetime
    end: datetime
    station_id: int = Field(gt=0)
    downlink: bool = True


class OcvPoint(BaseModel):
    """One point of an open-circuit voltage curve. Named fields keep the two apart."""

    soc_pct: float = Field(ge=0, le=100)
    cell_v: float = Field(gt=0, le=10)


class BatteryModel(BaseModel):
    """Equivalent circuit of the battery; see ``orbit.battery.Battery``."""

    cells_series: int = Field(ge=1, le=200)
    capacity_ah: float = Field(gt=0, le=1e5)
    resistance_ohm: float = Field(ge=0, le=10)
    max_charge_a: float = Field(gt=0, le=1e4)
    cell_max_v: float = Field(gt=0, le=10)
    cell_min_v: float = Field(gt=0, le=10)
    ocv: list[OcvPoint] = Field(min_length=2, max_length=MAX_OCV_POINTS)

    def battery(self) -> Battery:
        """The battery, or ``BatteryCurveError`` when the curve or limits are unusable."""
        return Battery(
            cells_series=self.cells_series,
            capacity_ah=self.capacity_ah,
            resistance_ohm=self.resistance_ohm,
            max_charge_a=self.max_charge_a,
            cell_max_v=self.cell_max_v,
            cell_min_v=self.cell_min_v,
            ocv_soc=tuple(point.soc_pct / 100 for point in self.ocv),
            ocv_cell_v=tuple(point.cell_v for point in self.ocv),
        )


class PowerModel(BaseModel):
    """Array, battery and loads; see ``orbit.power.PowerSpec``."""

    array_w: float = Field(gt=0, le=1e5)
    capacity_wh: float = Field(gt=0, le=1e6)
    initial_soc_pct: float = Field(default=100.0, ge=0, le=100)
    charge_efficiency: float = Field(default=0.9, ge=0.5, le=1)
    discharge_efficiency: float = Field(default=0.9, ge=0.5, le=1)
    dod_limit_pct: float = Field(default=30.0, ge=1, le=100)
    base_w: float = Field(default=0.0, ge=0, le=1e5)
    imaging_w: float = Field(default=0.0, ge=0, le=1e5)
    downlink_w: float = Field(default=0.0, ge=0, le=1e5)
    contact_w: float = Field(default=0.0, ge=0, le=1e5)
    contact_attitude: ContactAttitude = "sun"
    slew_s: float = Field(default=60.0, ge=0, le=600)
    #: Left out, the battery is the energy balance of ``capacity_wh`` and the efficiencies.
    battery: BatteryModel | None = None

    def spec(self) -> PowerSpec:
        return PowerSpec(
            array_w=self.array_w,
            capacity_wh=self.capacity_wh,
            initial_soc=self.initial_soc_pct / 100,
            charge_efficiency=self.charge_efficiency,
            discharge_efficiency=self.discharge_efficiency,
            dod_limit=self.dod_limit_pct / 100,
            base_w=self.base_w,
            imaging_w=self.imaging_w,
            downlink_w=self.downlink_w,
            contact_w=self.contact_w,
            contact_attitude=self.contact_attitude,
            slew_s=self.slew_s,
            battery=self.battery.battery() if self.battery else None,
        )


class PowerRequest(PropagateRequest):
    """Battery state of charge over a propagated run and the activities planned in it."""

    shots: list[PowerShot] = Field(default_factory=list)
    contacts: list[PowerContact] = Field(default_factory=list)
    #: When the battery holds ``power.initial_soc_pct``; ``None`` is the start of the run.
    soc_at: datetime | None = None
    power: PowerModel


class TmtcSessionRequest(SatelliteRef):
    """Simulated link over this satellite's passes; ``start``/``end`` are its run."""

    elements_only: ClassVar[bool] = True

    start: datetime
    end: datetime
    station_ids: list[int] = Field(min_length=1, max_length=MAX_STATIONS)


class AzMaskPoint(BaseModel):
    """One horizon mask vertex. Named fields keep the two angles from being swapped."""

    az_deg: float = Field(ge=0, lt=360)
    min_elev_deg: float = Field(ge=0, le=89)


class StationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    lat_deg: float = Field(ge=-90, le=90)
    lon_deg: float = Field(ge=-180, le=180)
    alt_m: float = Field(default=0.0, ge=-500, le=9000)
    min_elev_deg: float = Field(default=10.0, ge=0, le=89)
    preset_id: str | None = Field(default=None, max_length=48, pattern=r"^[a-z0-9-]+$")
    az_mask: list[AzMaskPoint] = Field(default_factory=list, max_length=MAX_MASK_POINTS)

    @model_validator(mode="after")
    def usable_mask(self) -> Self:
        """Reject a mask at save time rather than when a prediction first trips over it."""
        HorizonMask.from_points(self.mask_points())
        return self

    def mask_points(self) -> list[tuple[float, float]]:
        return [(point.az_deg, point.min_elev_deg) for point in self.az_mask]

    def store_fields(self) -> dict[str, Any]:
        return {**self.model_dump(exclude={"az_mask"}), "az_mask": self.mask_points()}


class SensorPresetCreate(BaseModel):
    """A saved sensor. Both widths are stored; ``mode`` says which one drives the swath."""

    name: str = Field(min_length=1, max_length=40)
    mode: Literal["swath", "fov"]
    swath_km: float = Field(gt=0, le=5000)
    fov_deg: float = Field(gt=0, lt=179)
    max_off_nadir_deg: float = Field(ge=0, lt=89)
    min_sun_elev_deg: float = Field(ge=-18, le=90)


class CustomElementsCreate(BaseModel):
    """Elements pasted by the user: 2-3 TLE lines or one OMM JSON record."""

    name: str = Field(min_length=1, max_length=60)
    text: str = Field(min_length=1, max_length=20000)


class SpacecraftFields(BaseModel):
    """What drag and radiation pressure need; anything left out is estimated by HPOP."""

    mass_kg: float | None = Field(default=None, gt=0, le=1e6)
    drag_area_m2: float | None = Field(default=None, gt=0, le=1e4)
    cd: float | None = Field(default=None, gt=0, le=10)
    srp_area_m2: float | None = Field(default=None, gt=0, le=1e4)
    cr: float | None = Field(default=None, gt=0, le=3)

    def spacecraft(self) -> dict[str, float]:
        fields = SpacecraftFields.model_fields
        return {key: getattr(self, key) for key in fields if getattr(self, key) is not None}


class CustomStateCreate(SpacecraftFields):
    """A state vector typed in by the user, in the frame named by ``frame``."""

    name: str = Field(min_length=1, max_length=60)
    epoch: datetime
    #: A CCSDS ``REF_FRAME``: ``GCRF``/``EME2000``/``ICRF``, ``ITRF``, or ``TEME``.
    frame: str = Field(default="GCRF", min_length=1, max_length=20)
    x_m: float
    y_m: float
    z_m: float
    vx_m_s: float
    vy_m_s: float
    vz_m_s: float


class ImportedCustomState(BaseModel):
    """A state vector as ``/database/export`` writes it; ``state`` is GCRS and re-checked."""

    name: str = Field(min_length=1, max_length=60)
    epoch: datetime
    frame: str = Field(default="GCRF", min_length=1, max_length=20)
    state: dict[str, Any]
    input_format: Literal["form", "opm"] = "form"


class ImportedCustomElements(BaseModel):
    """User elements as ``/database/export`` writes them; the OMM is re-validated on import."""

    name: str = Field(min_length=1, max_length=60)
    omm: dict[str, Any]
    input_format: Literal["tle", "omm"] = "omm"


class UserDataImport(BaseModel):
    """A ``/database/export`` file. Extra fields such as ``id`` are ignored."""

    format: Literal["soda-userdata"]
    version: Literal[1]
    stations: list[StationCreate] = Field(default_factory=list, max_length=1000)
    sensor_presets: list[SensorPresetCreate] = Field(default_factory=list, max_length=1000)
    custom_elements: list[ImportedCustomElements] = Field(default_factory=list, max_length=1000)
    custom_states: list[ImportedCustomState] = Field(default_factory=list, max_length=1000)


class DatabaseUrlRequest(BaseModel):
    """A database URL to test or save; empty means the default under ``data_dir``."""

    url: str = Field("", max_length=4096)


class ModelSettings(BaseModel):
    """Display settings for a 3D model; angles rotate the model in its own body frame."""

    heading_deg: float = Field(default=0.0, ge=-180, le=180)
    pitch_deg: float = Field(default=0.0, ge=-180, le=180)
    roll_deg: float = Field(default=0.0, ge=-180, le=180)
    scale: float = Field(default=1.0, gt=0, le=1000)
    minimum_size_px: float = Field(default=48.0, ge=0, le=512)


class ImageryUpdate(BaseModel):
    """The fields of an uploaded imagery set that can change after the import."""

    name: str = Field(min_length=1, max_length=MAX_NAME_LENGTH)
    attribution: str = Field("", max_length=MAX_ATTRIBUTION_LENGTH)
    #: ``None`` leaves the licence as it is.
    license: str | None = Field(None, max_length=MAX_LICENSE_LENGTH)
    acquired_at: datetime | None = None
    #: ``None`` leaves the sensor as it is; an empty string clears it.
    sensor: Literal["optical", "sar", ""] | None = None


class ImageryCatalogImport(BaseModel):
    """Catalogue items to import, named by id; the server finds their addresses itself."""

    source: Literal["maxar", "oam"]
    item_ids: list[str] = Field(min_length=1, max_length=MAX_CATALOG_IMPORT_ITEMS)


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def flat(values: np.ndarray, decimals: int) -> list[float]:
    """Row-major flattened, rounded list with non-finite values replaced by zero."""
    clean = np.where(np.isfinite(values), values, 0.0)
    return np.round(clean, decimals).ravel().tolist()


def station_summary(station: Station) -> dict[str, Any]:
    """Station JSON. The mask travels as named angles, the way requests send it."""
    return {
        **asdict(station),
        "az_mask": [{"az_deg": az, "min_elev_deg": elev} for az, elev in station.az_mask],
    }


def sensor_preset_summary(preset: SensorPreset) -> dict[str, Any]:
    """Sensor preset JSON: the dataclass fields as they are."""
    return asdict(preset)


def element_summary(elements: ElementSet) -> dict[str, Any]:
    return {
        "norad_id": elements.norad_id,
        "name": elements.name,
        "object_id": elements.object_id,
        "epoch": iso(elements.epoch),
        "source": elements.source,
    }


def element_detail(elements: ElementSet, groups: list[str]) -> dict[str, Any]:
    """Everything the satellite detail view shows about one element set."""
    return {
        **element_summary(elements),
        "groups": groups,
        "orbit": orbit_summary(elements.omm),
        "tle": tle_lines(elements.omm),
        "omm": elements.omm,
    }


def custom_summary(custom: CustomElements) -> dict[str, Any]:
    """List entry for user-supplied elements."""
    elements = custom.element_set()
    return {
        "id": custom.id,
        "name": custom.name,
        "norad_id": elements.norad_id,
        "epoch": iso(elements.epoch),
        "input_format": custom.input_format,
        "category": classify(custom.omm),
        "created_at": custom.created_at,
    }
