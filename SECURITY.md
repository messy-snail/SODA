# Security policy

SODA is a single-user tool. The server binds to `127.0.0.1`, has no authentication
and is not meant to be exposed to a network. Within that model it still parses
files you upload (orbit elements, GeoTIFF, MBTiles, scene archives, `.glb`) and
downloads imagery from a fixed list of public catalogues, so a mistake there can
matter. Please report such problems privately.

## Reporting a vulnerability

Use GitHub's private reporting:
[Report a vulnerability](https://github.com/messy-snail/SODA/security/advisories/new).
Please do not open a public issue for it. Reports in English or Korean are both
fine.

Include the commit you tested, your operating system, and the steps to
reproduce. Leave real Space-Track credentials and Cesium ion tokens out.

You can expect a first reply within a week.

## In scope

- An uploaded or inbox file that makes the server read or write outside
  `data/`, or run code.
- The imagery catalogue downloader reaching a host outside its allow list, or
  following a client-supplied URL.
- Space-Track credentials or a Cesium ion token written to logs, API responses
  or the database export.
- A web page in the same browser being able to drive the local API in a way
  that damages data.

## Out of scope

- Anything that requires binding the server to a public interface or putting it
  behind a proxy. That setup is not supported.
- Problems in CelesTrak, Space-Track, Esri, Cesium ion, GDAL or other upstream
  projects; please report those upstream.

## Supported versions

Only the latest commit on `main` receives security fixes.
