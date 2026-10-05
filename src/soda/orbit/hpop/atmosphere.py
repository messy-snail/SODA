"""Harris-Priester atmospheric density.

A static model: density depends on height and on the angle to the diurnal bulge, which
trails the Sun by 30 degrees in right ascension. It needs no space weather, which is why
SODA uses it. The table is for mean solar activity and covers 100 to 1000 km.

Source: Montenbruck & Gill, *Satellite Orbits*, 2000, section 3.5.2 and table 3.8. The
values were checked against the table in Orekit's ``HarrisPriester`` class.
"""

from bisect import bisect_right
from math import cos, exp, log, sin, sqrt

from .constants import FLATTENING, R_EARTH

#: ``(height km, minimum density, maximum density)`` in kg/m^3: antapex and apex of the bulge.
TABLE: tuple[tuple[float, float, float], ...] = (
    (100, 4.974e-07, 4.974e-07),
    (120, 2.490e-08, 2.490e-08),
    (130, 8.377e-09, 8.710e-09),
    (140, 3.899e-09, 4.059e-09),
    (150, 2.122e-09, 2.215e-09),
    (160, 1.263e-09, 1.344e-09),
    (170, 8.008e-10, 8.758e-10),
    (180, 5.283e-10, 6.010e-10),
    (190, 3.617e-10, 4.297e-10),
    (200, 2.557e-10, 3.162e-10),
    (210, 1.839e-10, 2.396e-10),
    (220, 1.341e-10, 1.853e-10),
    (230, 9.949e-11, 1.455e-10),
    (240, 7.488e-11, 1.157e-10),
    (250, 5.709e-11, 9.308e-11),
    (260, 4.403e-11, 7.555e-11),
    (270, 3.430e-11, 6.182e-11),
    (280, 2.697e-11, 5.095e-11),
    (290, 2.139e-11, 4.226e-11),
    (300, 1.708e-11, 3.526e-11),
    (320, 1.099e-11, 2.511e-11),
    (340, 7.214e-12, 1.819e-11),
    (360, 4.824e-12, 1.337e-11),
    (380, 3.274e-12, 9.955e-12),
    (400, 2.249e-12, 7.492e-12),
    (420, 1.558e-12, 5.684e-12),
    (440, 1.091e-12, 4.355e-12),
    (460, 7.701e-13, 3.362e-12),
    (480, 5.474e-13, 2.612e-12),
    (500, 3.916e-13, 2.042e-12),
    (520, 2.819e-13, 1.605e-12),
    (540, 2.042e-13, 1.267e-12),
    (560, 1.488e-13, 1.005e-12),
    (580, 1.092e-13, 7.997e-13),
    (600, 8.070e-14, 6.390e-13),
    (620, 6.012e-14, 5.123e-13),
    (640, 4.519e-14, 4.121e-13),
    (660, 3.430e-14, 3.325e-13),
    (680, 2.632e-14, 2.691e-13),
    (700, 2.043e-14, 2.185e-13),
    (720, 1.607e-14, 1.779e-13),
    (740, 1.281e-14, 1.452e-13),
    (760, 1.036e-14, 1.190e-13),
    (780, 8.496e-15, 9.776e-14),
    (800, 7.069e-15, 8.059e-14),
    (840, 4.680e-15, 5.741e-14),
    (880, 3.200e-15, 4.210e-14),
    (920, 2.210e-15, 3.130e-14),
    (960, 1.560e-15, 2.360e-14),
    (1000, 1.150e-15, 1.810e-14),
)
HEIGHTS_KM = tuple(row[0] for row in TABLE)
MIN_HEIGHT_KM, MAX_HEIGHT_KM = HEIGHTS_KM[0], HEIGHTS_KM[-1]
#: How far the bulge trails the Sun in right ascension.
BULGE_LAG_RAD = 0.5235987755982988  # 30 degrees


def bulge_exponent(inclination_rad: float) -> float:
    """Exponent of the day-night variation: 2 for an equatorial orbit, 6 for a polar one."""
    return 2.0 + 4.0 * sin(inclination_rad) ** 2


def height_km(x: float, y: float, z: float) -> float:
    """Height above the WGS84 ellipsoid to first order in the flattening.

    Good to a few tens of metres, far below the kilometres over which density changes.
    """
    r = sqrt(x * x + y * y + z * z)
    sin_lat = z / r
    return (r - R_EARTH * (1.0 - FLATTENING * sin_lat * sin_lat)) / 1000.0


def density(
    position_m: tuple[float, float, float],
    sun_m: tuple[float, float, float],
    exponent: float,
) -> float:
    """Density in kg/m^3 at an inertial position, given the Sun's inertial position.

    Above the table the density is taken as zero; below it the lowest row is used.
    """
    x, y, z = position_m
    height = height_km(x, y, z)
    if height >= MAX_HEIGHT_KM:
        return 0.0
    height = max(height, MIN_HEIGHT_KM)
    index = min(bisect_right(HEIGHTS_KM, height) - 1, len(TABLE) - 2)
    h0, min0, max0 = TABLE[index]
    h1, min1, max1 = TABLE[index + 1]
    # Exponential interpolation between the two rows, separately for each column.
    low = min0 * exp((h0 - height) * log(min0 / min1) / (h1 - h0))
    high = max0 * exp((h0 - height) * log(max0 / max1) / (h1 - h0))

    sx, sy, sz = sun_m
    sun_distance = sqrt(sx * sx + sy * sy + sz * sz)
    # Bulge apex: the Sun direction turned about the pole by the lag.
    cos_lag, sin_lag = cos(BULGE_LAG_RAD), sin(BULGE_LAG_RAD)
    ux = (sx * cos_lag - sy * sin_lag) / sun_distance
    uy = (sx * sin_lag + sy * cos_lag) / sun_distance
    uz = sz / sun_distance
    r = sqrt(x * x + y * y + z * z)
    cos_half_squared = 0.5 + 0.5 * (x * ux + y * uy + z * uz) / r
    return low + (high - low) * max(cos_half_squared, 0.0) ** (exponent / 2.0)
