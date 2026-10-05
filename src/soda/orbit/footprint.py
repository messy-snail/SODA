"""Ground visibility circles on a spherical Earth.

The radius formula and destination-point construction follow OrbitView
``src/lib/GroundTrack.ts`` (MIT, OrbitView Contributors).
"""

import numpy as np

EARTH_RADIUS_KM = 6371.0


def footprint_radii_km(altitude_km: float, min_elevation_deg: np.ndarray | float) -> np.ndarray:
    """Ground distances to where the satellite sits at each ``min_elevation_deg``."""
    elevation = np.radians(np.asarray(min_elevation_deg, dtype=float))
    ratio = EARTH_RADIUS_KM * np.cos(elevation) / (EARTH_RADIUS_KM + altitude_km)
    return EARTH_RADIUS_KM * (np.arccos(ratio) - elevation)


def footprint_radius_km(altitude_km: float, min_elevation_deg: float) -> float:
    """Ground distance from a subpoint to where the satellite sits at ``min_elevation_deg``."""
    return float(footprint_radii_km(altitude_km, min_elevation_deg))


def ring_bearings_deg(points: int = 128) -> np.ndarray:
    """Azimuths of the vertices ``ring_lonlat`` produces, so callers can size a radius array."""
    return np.degrees(np.linspace(0, 2 * np.pi, points + 1))


def ring_lonlat(
    lat_deg: float, lon_deg: float, radius_km: np.ndarray | float, points: int = 128
) -> list:
    """Closed ring of ``[lon, lat]`` pairs around a center.

    ``radius_km`` is either one distance or one per vertex of ``ring_bearings_deg(points)``,
    which is how a horizon mask turns into a lobed visibility outline.
    """
    lat1, lon1 = np.radians(lat_deg), np.radians(lon_deg)
    angular = np.asarray(radius_km, dtype=float) / EARTH_RADIUS_KM
    bearing = np.linspace(0, 2 * np.pi, points + 1)
    lat2 = np.arcsin(
        np.sin(lat1) * np.cos(angular) + np.cos(lat1) * np.sin(angular) * np.cos(bearing)
    )
    lon2 = lon1 + np.arctan2(
        np.sin(bearing) * np.sin(angular) * np.cos(lat1),
        np.cos(angular) - np.sin(lat1) * np.sin(lat2),
    )
    lon2 = (np.degrees(lon2) + 540) % 360 - 180
    return np.column_stack((lon2, np.degrees(lat2))).round(5).tolist()


def circle_lonlat(lat_deg: float, lon_deg: float, radius_km: float, points: int = 128) -> list:
    """Closed ring of ``[lon, lat]`` pairs at ``radius_km`` around a center."""
    return ring_lonlat(lat_deg, lon_deg, radius_km, points)
