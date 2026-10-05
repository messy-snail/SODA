"""The right-hand side of the equations of motion: gravity, third bodies, drag, and SRP.

Everything is in GCRS, metres and seconds, on Python floats (see ``gravity``).
"""

from dataclasses import dataclass
from math import sqrt

from . import atmosphere
from .constants import (
    AU_M,
    GM_EARTH,
    GM_MOON,
    GM_SUN,
    OMEGA_EARTH,
    R_EARTH,
    SOLAR_PRESSURE,
)
from .environment import Environment
from .gravity import GravityField

Vector = tuple[float, float, float]


@dataclass(frozen=True)
class Spacecraft:
    """What drag and radiation pressure need to know about the satellite."""

    mass_kg: float
    drag_area_m2: float
    cd: float
    srp_area_m2: float
    cr: float


def third_body(position: Vector, body: Vector, gm: float) -> Vector:
    """Acceleration from a body at geocentric ``body``, relative to the Earth's own."""
    x, y, z = position
    bx, by, bz = body
    dx, dy, dz = bx - x, by - y, bz - z
    near = gm / (dx * dx + dy * dy + dz * dz) ** 1.5
    far = gm / (bx * bx + by * by + bz * bz) ** 1.5
    return dx * near - bx * far, dy * near - by * far, dz * near - bz * far


def in_shadow(position: Vector, sun: Vector) -> bool:
    """Whether the satellite is inside the Earth's shadow, taken as a cylinder."""
    x, y, z = position
    sx, sy, sz = sun
    distance = sqrt(sx * sx + sy * sy + sz * sz)
    along = (x * sx + y * sy + z * sz) / distance
    if along >= 0.0:
        return False
    across_squared = x * x + y * y + z * z - along * along
    return across_squared < R_EARTH * R_EARTH


def drag(
    position: Vector, velocity: Vector, sun: Vector, craft: Spacecraft, exponent: float
) -> Vector:
    """Drag from an atmosphere that turns with the Earth."""
    x, y, z = position
    vx, vy, vz = velocity
    density = atmosphere.density(position, sun, exponent)
    if density == 0.0:
        return 0.0, 0.0, 0.0
    rx, ry, rz = vx + OMEGA_EARTH * y, vy - OMEGA_EARTH * x, vz
    speed = sqrt(rx * rx + ry * ry + rz * rz)
    factor = -0.5 * craft.cd * craft.drag_area_m2 / craft.mass_kg * density * speed
    return factor * rx, factor * ry, factor * rz


def radiation_pressure(position: Vector, sun: Vector, craft: Spacecraft) -> Vector:
    """Solar radiation pressure on a flat plate facing the Sun; zero in shadow."""
    if in_shadow(position, sun):
        return 0.0, 0.0, 0.0
    dx, dy, dz = position[0] - sun[0], position[1] - sun[1], position[2] - sun[2]
    distance = sqrt(dx * dx + dy * dy + dz * dz)
    factor = SOLAR_PRESSURE * craft.cr * craft.srp_area_m2 / craft.mass_kg
    factor *= AU_M * AU_M / distance**3
    return factor * dx, factor * dy, factor * dz


class ForceModel:
    """Callable ``f(tau, state) -> derivative`` for the integrator."""

    def __init__(
        self,
        gravity: GravityField,
        environment: Environment,
        craft: Spacecraft,
        *,
        third_body: bool,
        drag: bool,
        srp: bool,
        bulge_exponent: float,
    ) -> None:
        if (third_body or drag or srp) and not environment.has_bodies:
            raise ValueError("third body, drag and SRP need the Sun and Moon ephemeris")
        self.gravity = gravity
        self.environment = environment
        self.craft = craft
        self.third_body = third_body
        self.drag = drag
        self.srp = srp
        self.bulge_exponent = bulge_exponent

    def earth_gravity(self, tau: float, position: Vector) -> Vector:
        x, y, z = position
        if self.gravity.degree < 2:
            factor = -GM_EARTH / (x * x + y * y + z * z) ** 1.5
            return factor * x, factor * y, factor * z
        r = self.environment.rotation(tau)
        fx, fy, fz = self.gravity.acceleration(
            r[0] * x + r[1] * y + r[2] * z,
            r[3] * x + r[4] * y + r[5] * z,
            r[6] * x + r[7] * y + r[8] * z,
        )
        return (
            r[0] * fx + r[3] * fy + r[6] * fz,
            r[1] * fx + r[4] * fy + r[7] * fz,
            r[2] * fx + r[5] * fy + r[8] * fz,
        )

    def __call__(self, tau: float, state) -> list[float]:
        position = (float(state[0]), float(state[1]), float(state[2]))
        velocity = (float(state[3]), float(state[4]), float(state[5]))
        ax, ay, az = self.earth_gravity(tau, position)
        if self.third_body or self.drag or self.srp:
            sun = tuple(self.environment.sun(tau))
            if self.third_body:
                for body, gm in ((sun, GM_SUN), (tuple(self.environment.moon(tau)), GM_MOON)):
                    bx, by, bz = third_body(position, body, gm)
                    ax, ay, az = ax + bx, ay + by, az + bz
            if self.drag:
                dx, dy, dz = drag(position, velocity, sun, self.craft, self.bulge_exponent)
                ax, ay, az = ax + dx, ay + dy, az + dz
            if self.srp:
                px, py, pz = radiation_pressure(position, sun, self.craft)
                ax, ay, az = ax + px, ay + py, az + pz
        return [velocity[0], velocity[1], velocity[2], ax, ay, az]
