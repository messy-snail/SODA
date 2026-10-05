# Contributing to SODA

Thanks for helping out. Issues and pull requests are welcome in English or
Korean (한국어로 작성해도 됩니다).

## Bugs, ideas and security reports

- **Bug** - open a
  [bug report](https://github.com/messy-snail/SODA/issues/new?template=bug_report.yml).
  For a wrong number, include the satellite, the time span and the value you
  expected with its source.
- **Idea** - open a
  [feature request](https://github.com/messy-snail/SODA/issues/new?template=feature_request.yml)
  that describes what you are trying to do.
- **Security problem** - please do not open a public issue; follow
  [SECURITY.md](SECURITY.md).

## Development setup

You need Python 3.12+, [uv](https://docs.astral.sh/uv/) and Node.js 22+. pnpm is
run through `npx`, so it does not have to be installed.

```bash
git clone https://github.com/messy-snail/SODA
cd SODA
uv sync
npx --yes pnpm@10.34.5 --dir frontend install --frozen-lockfile

uv run soda serve --reload                      # API on http://127.0.0.1:1992
npx --yes pnpm@10.34.5 --dir frontend dev       # UI on http://127.0.0.1:5173
```

## Before you open a pull request

```bash
uv run ruff check src tests
uv run ruff format --check src tests
uv run pytest -q
npx --yes pnpm@10.34.5 --dir frontend typecheck
npx --yes pnpm@10.34.5 --dir frontend lint
npx --yes pnpm@10.34.5 --dir frontend test
npx --yes pnpm@10.34.5 --dir frontend build
```

If you changed the screen or the globe, also run the browser smoke test against
a running server and look at the screenshots in `.cache/screenshots/`. See
[docs/development.md](docs/development.md). The README clips are recorded from the app
(`frontend/demos/`); if your change makes one of them wrong, say so in the pull
request and the maintainer will record it again.

## Rules that are easy to miss

[AGENTS.md](AGENTS.md) is the full list (written in Korean; it applies to people
and coding agents alike). The ones that matter most to a first contribution:

- **Never call CelesTrak from tests, scripts or the frontend.** All requests go
  through `GPService`, which keeps the one-request-per-two-hours rule. Tests use
  `httpx.MockTransport`.
- **All times are UTC**, and field names carry their unit (`*_km`, `*_deg`,
  `*_s`).
- **UI text exists in Korean and English.** Add both under
  `frontend/src/i18n/{ko,en}/`.
- **Third-party data needs a recorded source.** Logos, ground-station
  coordinates, sample imagery and bundled data each have a `SOURCES.md`; an
  entry with no redistributable licence is left out rather than guessed.
- **Changing an API** means updating the endpoint, its contract test,
  `frontend/src/api/types.ts` and the table in `docs/architecture.md` together.

## Commits

Write commit messages as [Conventional Commits](https://www.conventionalcommits.org/),
for example `fix(orbit): clamp the swath edge at the horizon`. Scopes in use:
`gp`, `orbit`, `api`, `frontend`, `globe`, `theme`, `docs`, `build`, `test`.
English or Korean subjects are both fine.

By contributing you agree that your contribution is licensed under the
[MIT License](LICENSE).
