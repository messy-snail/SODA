"""Physical constants and request limits of the numerical propagator."""

from datetime import timedelta

#: EGM96 gravitational parameter and reference radius, the pair its coefficients belong to.
GM_EARTH = 3.986004415e14  # m^3/s^2
R_EARTH = 6378136.3  # m
GM_SUN = 1.32712440018e20  # m^3/s^2
GM_MOON = 4.9028000661e12  # m^3/s^2
#: Earth rotation rate, for the velocity of the co-rotating atmosphere.
OMEGA_EARTH = 7.2921158553e-5  # rad/s
#: WGS84 flattening, for the height the density table is entered with.
FLATTENING = 1 / 298.257223563
AU_M = 149_597_870_700.0
#: Solar radiation pressure at 1 AU.
SOLAR_PRESSURE = 4.56e-6  # N/m^2

#: Below this height the trajectory is treated as re-entered and integration stops.
REENTRY_ALT_M = 100_000.0

#: Longest window, and farthest the window may start or end from the state epoch. The
#: integration always runs from the epoch, so both bound how long a request can take.
HPOP_MAX_SPAN = timedelta(days=7)
HPOP_MAX_EPOCH_GAP = timedelta(days=7)
MAX_GRAVITY_DEGREE = 20
DEFAULT_GRAVITY_DEGREE = 8

#: Relative and absolute tolerances of the integrator (position in m, velocity in m/s).
RTOL = 1e-9
ATOL_M = 1e-3
ATOL_M_S = 1e-6
#: Longest step, so that an eclipse entry or exit is never stepped over.
MAX_STEP_S = 300.0

#: Spacecraft assumed when neither the request nor the source says otherwise.
DEFAULT_MASS_KG = 500.0
DEFAULT_AREA_M2 = 2.0
DEFAULT_CD = 2.2
DEFAULT_CR = 1.3
#: ``Cd * A / m`` in m^2/kg for a BSTAR of one inverse Earth radius (``2 / rho0``).
BSTAR_TO_CD_AREA_PER_MASS = 12.741621
