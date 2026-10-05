# AGENTS.md

SODA 저장소에서 작업하는 모든 코딩 에이전트와 개발자가 따르는 공통 규칙이다.

- 사용법은 [README.md](README.md)를 본다.
- 구조와 계산 방법은 [docs/architecture.md](docs/architecture.md)를 본다.
- 테스트 구성은 [docs/development.md](docs/development.md)를 본다.
- 브랜드 에셋 사용 규칙은 [docs/brand.md](docs/brand.md)를 본다.
- 사용자 영상 사용법은 [docs/imagery.md](docs/imagery.md)를 본다. README는 영어(`README.md`)와 한국어(`README.ko.md`) 둘이고 함께 고친다.

규칙과 코드가 어긋나면 코드를 먼저 확인하고, 규칙을 바꿀 때는 이 파일도 같은 변경에서 고친다.

## 프로젝트 요약

- **목적**: 로컬 PC에서 개인이 쓰는 궤도 전파(SGP4, 수치 적분 HPOP)·swath·패스 분석 웹 도구. 인증은 없고 `127.0.0.1`에 바인딩한다.
- **백엔드** `src/soda/`: Python 3.12, uv, FastAPI, Skyfield/sgp4, NumPy, SciPy(HPOP 적분기), SQLite(stdlib `sqlite3`).
- **프런트엔드** `frontend/`: Vue 3 `<script setup>` + TypeScript strict, Vuetify 3, Pinia, CesiumJS, satellite.js(Web Worker), lucide-vue-next.
- **실행**: `uv run soda serve`가 API와 빌드된 SPA(`src/soda/static/dist`)를 포트 **1992**로 서빙한다. 포트는 `--port` > `SODA_PORT` > `settings.local.toml`의 `port` 순으로 정한다. 개발 중에는 Vite(5173)가 `/api`를 `SODA_PORT`(기본 1992)로 프록시한다.

## 명령

pnpm은 전역 설치를 가정하지 않는다. 항상 `npx --yes pnpm@10.34.5`로 실행한다.

| 목적 | 명령 |
| --- | --- |
| 의존성 설치 | `uv sync` · `npx --yes pnpm@10.34.5 --dir frontend install --frozen-lockfile` |
| 서버 실행 | `uv run soda serve` (개발: `--reload`) |
| 프런트 개발 서버 | `npx --yes pnpm@10.34.5 --dir frontend dev` |
| 프런트 빌드 | `npx --yes pnpm@10.34.5 --dir frontend build` → `src/soda/static/dist` |
| 백엔드 검증 | `uv run ruff check src tests` · `uv run ruff format --check src tests` · `uv run pytest -q` |
| 프런트 검증 | `npx --yes pnpm@10.34.5 --dir frontend typecheck` · `... lint` · `... test` |
| 브라우저 스모크 | 서버(1992)와 빌드가 준비된 상태에서 `npx --yes pnpm@10.34.5 --dir frontend test:browser` |
| GP 수동 갱신 | `uv run soda refresh` (2시간 규칙 적용) |

## 디렉터리와 확장 위치

| 하려는 일 | 수정할 곳 |
| --- | --- |
| GP 데이터 소스·캐시 | `src/soda/gp/` (`service.py`가 요청 예산의 유일한 관문). 저장소는 `store.py`(`Store` Protocol·`open_store`)가 경계이고 SQLite 구현은 `sqlite_store.py`와 그 mixin `sqlite_custom.py`(사용자 요소·상태벡터·ephemeris)에만 둔다. 사용자가 붙여 넣은 TLE·OMM은 `tle.py`(`parse_custom_elements`)가 읽고 `custom_elements` 테이블에 둔다. 파일로 가져오는 요소(TLE 목록, OMM JSON·XML·KVN·CSV, 여러 위성)는 `element_files.py`(`parse_element_file`·`plan_import`)가 읽고, CCSDS KVN·XML 공통 리더는 `ndm.py`다. 프런트는 `components/ElementFileImport.vue` |
| 궤도 계산 | `src/soda/orbit/` (순수 함수 + numpy, API 비의존) |
| 전파기 | 어떤 출처를 어떤 전파기로 계산하는지는 `orbit/propagation.py`(`ALLOWED`·`run`) 한 곳이 정한다. SGP4는 `orbit/propagator.py`, HPOP은 `orbit/hpop/`(`gravity.py` EGM96·`atmosphere.py` Harris-Priester·`environment.py` 지구 자세·해·달 표·`forces.py`·`integrate.py` DOP853·`propagate.py` 진입점과 캐시), OEM 보간은 `orbit/oem.py`·`interpolate.py`다. 어느 전파기든 GCRS 상태를 `propagator.ephemeris_from_gcrs`에 넘겨 같은 `Ephemeris`를 만든다. 새 전파기도 그렇게 붙인다. 전파기를 고르는 건 `/propagate`·`/swath`뿐이고 패스·촬영 기회·TC/TM은 SGP4로만 계산한다. 프런트는 `orbit/propagatorOptions.ts`(vitest 대상)·`components/PropagationCard.vue`·`HpopOptionsForm.vue`·`Sgp4OnlyNote.vue`. 전파 결과의 고도·베타각 그래프는 `components/RunSeriesDialog.vue`이고, 베타각 시계열은 백엔드 `orbit/sun.py`의 `beta_series_deg`가 `/propagate`에 실어 보낸다. 번들 중력장 계수는 `src/soda/assets/gravity/`(출처는 같은 폴더 `SOURCES.md`) |
| 상태벡터·ephemeris | 궤도요소가 아닌 출처다. 상태벡터(CCSDS OPM)는 `orbit/opm.py`가 읽고 `custom_states`에, ephemeris(CCSDS OEM)는 `orbit/oem.py`가 읽고 `custom_ephemerides`에 GCRS로 저장한다(레코드는 `gp/sources.py`, 좌표계 변환은 `orbit/frames.py`, 표시용 접촉 궤도는 `orbit/kepler.py`). API는 `api/custom_states.py`·`custom_ephemerides.py`. 프런트는 `utils/satelliteRef.ts`의 `kind`(`state:<id>`·`oem:<id>` 키, `hasElements`), `stores/customStates.ts`·`customEphemerides.ts`, `components/CustomStatesPanel.vue`·`CustomEphemeridesPanel.vue`, `orbit/stateVector.ts`(vitest 대상) |
| API 엔드포인트 | `src/soda/api/*.py`, 요청 모델은 `api/schemas.py` |
| API 타입·호출 | `frontend/src/api/types.ts`, `frontend/src/api/client.ts` |
| 상태 | `frontend/src/stores/*.ts` (Pinia setup store) |
| 지구본 레이어 | `frontend/src/globe/*.ts` + `components/GlobeViewer.vue`에서 등록 |
| 도구 패널 | `stores/ui.ts`의 `tools` + `App.vue` + `components/*Card.vue`. 패널은 바깥 스크롤 없이 카드 본문만 스크롤한다. 한 패널에 카드가 여럿이면 `DashboardCard`에 `section-id`를 줘 접게 하고, 카드 안 블록은 `CollapsibleSection`을 쓴다(접힘 상태는 `stores/ui.ts`의 `soda.layout`). 지구본은 창 전체에 깔리고 앱바·레일(`ToolRail.vue`)·사이드바(`ToolSidebar.vue`, 레일에 붙은 VSCode식 패널로 안의 카드는 섹션이 된다)는 그 위에 겹친 `.glass--frame`이다. 위성 탐색과 궤도 전파는 `satellite` 도구 하나다(레일 이름은 궤도, 카드 제목은 궤도 전파). `SatelliteToolCard.vue`가 위성 → 전파 → 결과 단계를 한 페이지씩 보여 준다(`ui.satelliteStep`). 다른 곳에서 특정 단계로 보낼 때는 `ui.openSatelliteStep`을 쓴다. 위성 단계에서 고른 위성은 `stores/satelliteBasket.ts`의 바구니(최대 8개, 키는 `utils/satelliteRef.ts`의 `satKey`)에 모이고, 전파 단계가 바구니 전체를 `runs.propagateMany`로 한 번에 전파한다. 패스 예측과 촬영 기회는 run의 전파 구간 안에서만 계산한다. 결과로 시계를 옮겨도 재생 범위 밖으로 나가지 않게 하기 위해서다. 위성 하나만 다루는 도구(저장량·전력·TC/TM)의 대상 위성은 `utils/satelliteRef.ts`의 `targetRun` 한 규칙으로 정한다(선택된 run, 그 도구가 못 쓰면 쓸 수 있는 첫 run. `orbit/useTargetRun.ts`). 패널에는 `RunSelect.vue`(궤도 색 점 + 이름)로 보여 주고, 거기서 바꾸면 앱 전체의 선택(`runs.select`)이 바뀐다. 촬영·패스 결과와는 run id가 아니라 `satKey`로 잇는다(`mission.resultOf`·`passes.indexOfSatellite`). 다시 전파해도 결과가 이어지게 하기 위해서다. 로고처럼 궤도 없이 위성 하나만 필요한 곳은 선택된 run, 없으면 `basket.focus`를 쓴다. 관측폭(swath)은 레일의 `swath` 도구이고, 오른쪽 패널은 없다. 하단 도크(패스 시간표·시계)는 기본이 `DockTray.vue`의 아이콘이다. 호버하면 `ui.dockPeek`로 위에 뜨고(`utils/hoverPeek.ts`), 핀을 누르면 `ui.timelinePinned`·`ui.clockPinned`로 고정된다. 셸 배치는 `styles/shell.css`의 `--frame-top`·`--rail-w`·`--sidebar-w`·`--dock-left`·`--dock-right`·`--right-edge`. 레이어·영상·장소·위성 표시는 `view` 도구 하나의 탭(`ViewToolCard.vue`, `ui.viewTab`)이고, 카드 안에 들어간 `DashboardCard`는 `cardEmbedding.ts`로 테두리 없는 섹션이 된다 |
| 설정 창·DB 보기·초기화 | `components/SettingsDialog.vue`(탭: 일반·데이터베이스·데이터 탐색). DB 행 보기와 백업은 백엔드 `api/database.py` + `gp/sqlite_browse.py`(볼 수 있는 테이블 화이트리스트), 프런트 `stores/database.ts`·`DatabaseBrowser.vue`·`DatabaseBackup.vue`. 브라우저 설정 초기화는 `utils/resetClientState.ts`(`soda.*` 키 삭제)이고, 새 저장 코드는 `persistenceSuspended()`일 때 쓰지 않아야 한다 |
| 축척 표시 | 계산은 `frontend/src/globe/scaleBar.ts`(1-2-5 단계, vitest 대상), 측정은 `globe/viewMetrics.ts`(화면 중앙의 두 점을 타원체에 내려 m/px을 구해 `ui.scaleBar`에 쓴다), 표시는 `components/ScaleBar.vue`(도크 아래 띠의 왼쪽 끝). 스위치는 `layers.prefs.showScaleBar` |
| 테마 | `frontend/src/theme/presets.ts`. 테마는 SODA Dark 하나뿐이고 바꾸는 UI는 없다. 배경색을 바꾸면 `frontend/index.html`의 스플래시 배경·`theme-color`도 함께 |
| 앱 로고·파비콘 | `frontend/public/brand/`의 SVG 키트(`{primary,wordmark,favicon,straw-a}-{light,dark}.svg`, `globe-icon.svg`)와 파생 PNG(`favicon-32.png`, `apple-touch-icon.png`). 참조는 `frontend/index.html`(파비콘·부팅 스플래시), `components/SodaAppBar.vue`(앱바 워드마크), `globe/basemaps.ts`(지구본 크레딧) 세 곳뿐이다. 크기·재생성·인라인 금지는 [docs/brand.md](docs/brand.md)를 본다 |
| 리퀴드 글래스 | 계산은 `frontend/src/glass/`(`tint.ts` 적응형 틴트·톤 전환, `refraction.ts` 가장자리 굴절 맵, vitest 대상), 실행은 `globe/liquidGlass.ts`(지구본 캔버스 샘플링, Chromium SVG 굴절), 모양은 `styles/glass.css`의 `.glass`·`.glass--clear`·`.glass--frame`·`.glass-chip`(굴절 렌즈의 모서리 반지름은 요소의 `border-radius`를 따른다), 설정은 `stores/appearance.ts`. 글래스 색(`glass-edge`·`glass-shadow`)은 프리셋에 둔다 |
| 센서 프리셋 | `frontend/src/sensors/presets.ts` |
| UI 문구·언어 | `frontend/src/i18n/`(`ko/`·`en/` 네임스페이스, `useLocale.ts`, `locale.ts`, `label.ts`), 선택 UI는 `components/LocaleMenu.vue` |
| 장소·나라 구분·핀 | `frontend/src/places/`(검색·카메라·틴트 타일·기본 이름 계산, vitest 대상), `stores/places.ts`·`placesPersistence.ts`, `globe/borderLayer.ts`·`tintProvider.ts`·`pinLayer.ts`·`pinImage.ts`·`labelStyle.ts`, `components/PlaceSearchCard.vue`·`PinsCard.vue`·`PinStylePicker.vue`·`HomeViewCard.vue`. 데이터는 `frontend/public/geo/*.json`이고 `scripts/build_geo_data.py`로만 다시 만든다(출처: `public/geo/SOURCES.md`) |
| 새로고침 복원 | `stores/sessionSnapshot.ts`(무엇을 저장하나), `globe/sessionRestore.ts`(언제 저장·복원하나). 복원할 상태를 늘리면 둘 다 고치고 `tests/session-restore.spec.ts`를 갱신한다 |
| 지상국 프리셋 | `frontend/src/stations/`(`catalog/*.ts` 데이터, `presets.ts` 헬퍼, `flags.ts` 국기, `SOURCES.md` 출처). 새 국가를 넣으면 `flags.ts`에 국기 import도 추가한다 |
| 지상국·패스 | 백엔드 `src/soda/orbit/passes.py`·`horizon.py`, `api/orbit.py`·`stations.py`, 프런트 `stores/passes.ts`, `components/PassPredictionCard.vue`·`PassRow.vue`·`PassDetailDialog.vue`(패스 상세 창: `SkyPlot.vue` 스카이 플롯과 고도각·거리·거리 변화율 곡선, 계산은 `orbit/passGeometry.ts`, vitest 대상. 패스 궤적으로 프런트에서만 계산한다)·`PassTimelineDock.vue`(하단 타임라인 도크)·`ContactChips.vue`(상단 교신 중 칩)·`StationPicker.vue`·`StationForm.vue`, `globe/stationLayer.ts`·`passLayer.ts`(패스 띠·AOS/LOS 핀·시선, 그리기 헬퍼는 `contactGraphics.ts`)·`passTrack.ts`. 패스 예측은 전파한 run 전부(최대 8개)를 한 번에 계산한다(`api/passes.py`). 같은 지상국에서 겹치면 `orbit/contacts.py`의 `schedule`이 우선순위(`passes.priority`, `PassSatelliteList.vue`)로 배정하고 진 패스는 `rejected`다. 위성이 여럿이면 색은 위성(궤도 색), 하나면 지상국 색이다(`utils/usePassColors.ts`). 창 예산은 `utils/passPlan.ts`(vitest 대상) |
| 촬영 계획·저장량·TC/TM | 레일 도구 셋이다. 카드 `ImagingToolCard.vue`·`StorageToolCard.vue`·`TmtcToolCard.vue`가 `ImagingPanel.vue`·`StoragePanel.vue`·`TmtcPanel.vue`를 감싼다. 촬영 계획 카드는 탭 둘이다(`ui.imagingTab`): `촬영 대상`(표적 목록과 계산 버튼)과 `촬영 기회`(계산 결과 목록). 계산이 끝나면 결과 탭으로 넘어가고, 다른 곳에서 특정 탭으로 보낼 때는 `ui.openImagingTab`을 쓴다. 촬영 계획은 백엔드 `orbit/access.py`(탐색)·`access_geometry.py`(롤·피치 기하, 자세 모델 `Pointing`)·`access_strip.py`(촬영 띠) + `api/access.py`, 프런트 `mission/targets.ts`(vitest 대상)·`mission/shots.ts`(모든 위성의 창을 한 목록으로, `shotKey`, vitest 대상)·`stores/mission.ts`(`soda.mission`)·`AccessPointingForm.vue`·`AoiTargetForm.vue`·`AccessResultList.vue`·`AccessWindowRow.vue`·`globe/aoiLayer.ts`(엔티티 id `aoi:<id>`)·`globe/accessLayer.ts`(촬영 띠 `access:<shot key>`, 궤적 구간 `access-track:<shot key>`, 위성별 시선 `access-sight:<위성 슬러그>`). 촬영 기회는 궤도요소가 있는 run 전부(최대 8개)를 계산한다. `/access`는 위성 하나만 받으므로 `mission.compute`가 위성마다 요청하고, 결과는 `mission.results`(위성별)와 `mission.shots`(시간순 한 목록)에 둔다. 위성이 여럿이면 띠와 행의 색은 위성(궤도 색), 하나면 표적 색이다. 지구본 클릭은 id를 자르지 않고 `mission.shotIndex`로 찾는다. 저장량·전력은 `mission.shots`에서 대상 위성의 것만 쓴다. 자세 한계와 최소 태양고도(`AccessPointingForm.vue`)는 카드 머리의 `촬영 옵션` 버튼(`ImagingOptionsButton.vue`)이 여는 팝오버에 있고, 패널 맨 위에는 지금 값이 칩으로 보인다(`PointingChips.vue`). 커버리지 분석은 레일 도구 `coverage`이고 지금은 숨겨져 있다(`features.ts`의 `COVERAGE`, `VITE_SODA_COVERAGE=1`일 때만 레일에 보인다. 백엔드 `/coverage`는 그대로 동작한다)(`CoverageToolCard.vue`가 `CoveragePanel.vue`를 감싼다). 촬영 계획이 표적을 언제 찍을 수 있나를 본다면, 커버리지 분석은 영역의 어디를 얼마나 자주 찍을 수 있나를 본다. 영역은 촬영 계획의 박스 표적을 같이 쓰고(`AoiTargetList.vue`의 `kind="box"`는 영역만 나열하고 영역 추가만 낸다), 촬영 옵션과 대상 위성 안내(`PlannedRunsNote.vue`)도 같이 쓴다. 지도는 그 도구가 열려 있을 때만 지구본에 있다(`coverage.shown`). 커버리지 분석은 박스 표적 하나를 격자로 나눠 칸마다 촬영 가능 횟수·최대/평균 재방문 간격·첫 촬영까지 시간을 지구본에 칠한다. 백엔드 `orbit/coverage.py`(칸 방향으로 벡터화한 탐색, 한도 `MAX_COVERAGE_*`) + `api/coverage.py`(`/coverage`, 위성 하나당 한 요청, 칸별 기회 시각만 돌려준다), 프런트 `mission/coverage.ts`(격자·위성 병합·지표·요약, vitest 대상)·`stores/coverage.ts`(저장하지 않는 결과, 대상 박스·위성 필터·고른 칸)·`CoveragePanel.vue`·`CoverageLegend.vue`·`globe/coverageProvider.ts`(칸마다 한 픽셀인 그림을 타일에 옮겨 그리는 imagery provider)·`globe/coverageLayer.ts`(결과를 보여 줄 때만 레이어를 넣는다. 고른 칸은 엔티티 `coverage-cell`). 지도 위 클릭은 `picking.ts`가 경위도로 칸을 찾는다(`coverage.selectAt`). 색 램프는 프리셋 `globe.coverage`. 정의와 한계는 [docs/architecture.md](docs/architecture.md)의 커버리지 절. 지구본 클릭으로 점·영역을 찍는 흐름은 `picking.ts`에서 `mission.placing`으로 분기한다. 표적 목록과 추가 수단은 `AoiTargetList.vue`다(표적별 사유 한 줄은 위성들의 진단을 `mergeDiagnoses`로 합쳐 낸다). 핀·장소 검색 결과와 촬영 대상은 서로 복사할 수 있다(`mission/fromPlaces.ts`, vitest 대상): 핀 행과 검색 결과의 `AddTargetButton.vue`가 점 표적(나라는 `Country.bbox` 박스)을 만들고, 촬영 패널의 `핀에서` 메뉴와 표적 행의 `핀으로 저장`이 반대 방향이다. 복사일 뿐 연결은 없고, 같은 자리에 이미 있으면(1e-5° 이내) 버튼이 켜진 채 그쪽 도구를 연다. 저장량은 백엔드 없이 촬영 결과와 패스 결과(배정된 패스)로 계산하는 영상 파일 단위 레코더다. `mission/recorder.ts`(`simulateRecorder`: 촬영 창 하나가 파일 하나, 재생 순서, 손실, 지연시간)·`mission/linkWindow.ts`(패스 궤적으로 구한 X밴드 최소 고도각 구간, 링크 확립 시간)·`mission/storage.ts`(설정·한도 `STORAGE_LIMITS`·지상국별 밴드와 속도)는 vitest 대상이고, `stores/storage.ts`(저장하지 않는 계산 스토어, 대상 위성은 `targetRun`)가 입력을 모은다. 화면은 `StorageToolCard.vue`(카드 머리에 가정 `InfoTip`과 설정 버튼)·`StorageSettingsForm.vue`·`StorageStationLinks.vue`(설정 팝오버 안, 지상국마다 끔·S·X와 속도)·`StoragePanel.vue`(통계·`LevelChart.vue`)·`StorageImageList.vue`·`StoragePassList.vue`(기본으로 접힌 `storage.images`·`storage.passes` 섹션)다. 영상 목록의 체크(`mission.excludedShots`)와 지상국 끔(`storage.noDownlinkStationIds`)은 전력 도구가 같이 쓴다. 규칙과 한계는 [docs/architecture.md](docs/architecture.md)의 저장량 절. TC/TM은 아래 행을 본다 |
| 전력(SOC·DOD) | 레일 도구 `power`. 백엔드 `orbit/power.py`(에너지 수지 적분, 한도 `MAX_POWER_INTERVALS`)·`battery.py`(등가회로 배터리: 개방전압 곡선·내부저항·CC-CV, 기본 곡선은 예시)·`power_geometry.py`(자세별 태양전지 입사각, 샘플 사이 보간) + `api/power.py`, 태양 방향·거리는 `orbit/sun.py`. 프런트 `mission/power.ts`(설정·요청 조립, vitest 대상)·`mission/battery.ts`(등가회로 설정·곡선 파서, vitest 대상)·`OcvCurveDialog.vue`(곡선 입력)·`stores/power.ts`(선택된 run, 없으면 첫 run)·`PowerToolCard.vue`(카드 머리에 계산 가정 `InfoTip`과 설정 버튼)·`PowerPanel.vue`(시작 상태·통계·차트)·`PowerSettingsForm.vue`(설정 버튼의 팝오버 안). 패널은 스크롤 없이 보여야 한다. 통계 칸의 틴트 등급은 `mission/power.ts`의 `powerStatLevels`가 정한다(DOD 한도 초과는 warning, 배터리 바닥은 error). 설정은 `mission.saved.power`(`soda.mission`)에 둔다. 시작 SOC는 `power.socAtMs` 시각의 값이고(기본은 run 시작, 저장하지 않는다) 계산은 그 시각부터 run 끝까지다. 차트는 저장량과 함께 쓰는 `LevelChart.vue`(`utils/levelChart.ts`)다. 촬영에서 뺀 창(`mission.excludedShots`)과 다운링크 지상국(`storage.noDownlinkStationIds`)은 저장량 도구와 공유한다. TC/TM 모의 위성의 `battery_pct`와는 별개다. 가정과 한계는 [docs/architecture.md](docs/architecture.md)의 전력 절 |
| TC/TM 모의 링크 | 백엔드 `src/soda/tmtc/`(`packets.py` CCSDS 패킷, `spacecraft.py` 모의 위성, `link.py` 교신 일정, `session.py` Cesium clock 기준 진행, `hub.py` 세션·WebSocket) + `api/tmtc.py`, 프런트 `stores/tmtc.ts`·`mission/tmtcLog.ts`(vitest 대상)·`TmtcPanel.vue`·`TmtcPacketLog.vue`. 패널 밖 표시는 `ContactChips.vue`의 TC/TM 칩(세션 동안 항상)과 `globe/tmtcLayer.ts`(시선 `tmtc-sight:<지상국 id>`, 진행 중이거나 다음 교신의 띠 `tmtc-pass:<지상국 id>:<aos_ms>`, 패킷 점 `tmtc-pulse:up|down`, 계산은 `linkPulse.ts`, vitest 대상)다. SODA 안에서만 동작하고 외부 관제 연동은 없다. 설명은 [docs/tmtc.md](docs/tmtc.md) |
| API 오류·경고 코드 | `src/soda/errors.py`(레지스트리), `src/soda/api/errors.py`(`ApiError`), 프런트 `api/messages.ts` + `i18n/{ko,en}/errors.ts`·`warnings.ts` |
| 기하·시간 보조 함수 | `frontend/src/globe/geometry.ts`, `frontend/src/utils/time.ts` (vitest 대상) |
| 위성 모양·로고 | 백엔드 `src/soda/logos.py` + `api/logos.py`(업로드는 `data/logos`, 번들은 `src/soda/assets/logos`), 프런트 `utils/markerStyle.ts`, `stores/logos.ts`, `globe/shapeMesh.ts`·`glb.ts`·`satelliteShape.ts`, `components/SatelliteMarkerCard.vue`·`LogoSlot.vue`·`OperatorLogoList.vue` |
| 위성 → 기관 매핑 | `frontend/src/utils/operators.ts`의 `OPERATOR_RULES`(vitest 대상). 번들 로고 파일은 `src/soda/assets/logos`, 출처는 같은 폴더의 `SOURCES.md` |
| 3D 위성 모델(숨김) | 백엔드 `src/soda/models3d.py` + `api/models3d.py`(파일은 `data/models`), 프런트 `stores/models.ts`, `globe/satelliteModel.ts`, `components/ModelsCard.vue`·`ModelSlot.vue`. UI는 `features.ts`의 `GLB_MODELS`(`VITE_SODA_GLB_MODELS=1`)일 때만 보인다 |
| 궤도요소 신뢰도(epoch 거리) | 등급 계산은 `frontend/src/orbit/epochTrust.ts`(vitest 대상, 3·7·14일), 기준 run·시계 연동은 `orbit/useEpochTrust.ts`. 표시는 `components/EpochTrustOverlay.vue`(지구본 틴트·배지), `StaleEpochDialog.vue`(전파 전 확인), `globe/orbitTrail.ts`(궤도선 구간 색), `TimelineBar.vue`·`PassTimelineDock.vue`(등급 띠). 색은 프리셋 `globe.trust`. 백엔드 경고는 `orbit/propagator.epoch_warnings` |
| 식(eclipse) 표시 | 구간 계산은 백엔드 `src/soda/orbit/eclipse.py`(`/propagate`의 `eclipse_s`). 프런트는 `orbit/eclipse.ts`(구간 읽기·시계 띠, vitest 대상), `orbit/useEclipse.ts`(기준 run), `orbit/sunDirection.ts`(표시용 태양 방향, vitest 대상), `globe/shadowCap.ts`(밤·그림자 캡 기하, vitest 대상), `globe/eclipseLayer.ts`(2D 지도 음영), `globe/orbitTrail.ts`(궤도선 어둡게), `TimelineBar.vue`(띠), `FrameLegend.vue`(칩). 색은 프리셋 `globe.eclipse`, 스위치는 `layers.prefs.showEclipse`(밤 음영은 `lighting`) |
| 사용자 영상(지구본에 올리는 위성 영상) | 백엔드 `src/soda/imagery/`(`mbtiles.py` 검증·읽기·쓰기, `tiling.py` 타일 계산, `warp.py` rasterio 변환, `cutting.py` 타일 자르기, `library.py` 저장, `jobs.py` 변환 작업(대기 한도·단계), `inbox.py` 감시 폴더, `products.py` inbox에 놓인 장면 제품(zip·폴더) 찾기, `dimap.py` SPOT 장면의 `METADATA.DIM` 읽기, `catalog/`(공개 카탈로그 검색·내려받기: `http.py` 허용 호스트와 크기 한도, `cache.py` 디스크 캐시, `maxar.py`, `oam.py`, `service.py`), `limits.py` 한도) + `api/imagery.py`·`api/imagery_catalog.py`. 파일은 `data/imagery/<id>.mbtiles`와 `<id>.json` 사이드카이고 DB 테이블은 없다. 샘플 영상은 이 저장소가 아니라 `samples` 서브모듈(`samples/imagery/<슬러그>.mbtiles`·`.json`, 목록 `samples/manifest.toml`, 출처 `samples/SOURCES.md`)에 있고, 서버는 그 폴더를 읽기 전용 두 번째 라이브러리로 읽는다(`library.py`의 `samples_root`, 설정 `settings.py`의 `imagery_samples_dir`, 끄는 스위치 `imagery_samples = false`). 샘플은 `scripts/build_imagery_samples.py`로만 만든다(`scripts/fetch_spot_samples.py`는 실행 중인 서버에 SPOT quicklook을 등록하는 클라이언트다). 세트의 센서 종류는 사이드카의 `sensor`(`optical`·`sar`, `library.py`의 `SENSORS`)이고, 해상도는 `gsd_m`(변환이 잰 값이나 출처가 밝힌 값, 없으면 최대 줌의 타일 해상도)이다. 프런트 `stores/imagery.ts`, `utils/imagery.ts`(vitest 대상), `globe/userImageryLayer.ts`·`imageryOrder.ts`(vitest 대상), `components/ImageryCard.vue`(끌어다 놓기. 접는 섹션 둘: 목록 `imagery.list`, 영상 추가 `imagery.add`(기본 접힘). 영상 추가 안에서 `내 파일`과 `공개 카탈로그`를 탭으로 고른다. 긴 설명은 문단으로 두지 않고 `InfoTip.vue`의 툴팁에 둔다)·`ImageryRow.vue`(접으면 이름·센서 칩·해상도 칩·이동 버튼 한 줄, 펼치면 세부와 수정·삭제)·`ImageryFilterBar.vue`(센서·해상도 필터, 계산은 `utils/imagery.ts`의 `filterImagery`·`GSD_STEPS`, 상태는 `stores/imagery.ts`의 `filter`)·`ImagerySensorChip.vue`(아이콘과 프리셋 색 `sensor-optical`·`sensor-sar`)·`ImagerySensorToggle.vue`·`ImageryImportForm.vue`·`ImageryBatchForm.vue`(여러 파일)·`ImageryCatalogSearch.vue`(카탈로그 검색, `stores/imageryCatalog.ts`)(`view` 도구의 `imagery` 탭). 샘플은 사이드카의 `label`(`{ko, en}`)로 두 언어 이름을 가진다. 위치로 이동은 `imageryViewPoint`(세트 크기의 2배 높이)를 쓴다. 세트마다 켜는 스위치는 없다. 카메라가 그 영상 위로 확대해 들어가면 저절로 나타나고(`utils/imagery.ts`의 `imageryFade`), 전체를 끄는 스위치는 `layers.prefs.showUserImagery`, 세트별 불투명도는 `layers.prefs.imagery`다 |
| README 영상 | 장면은 `frontend/demos/*.demo.ts`(헬퍼 `stage.ts`, 설정 `playwright.demo.config.ts`, 실행 `demo:record`), GIF 변환은 `scripts/build_readme_media.py` → `docs/media/*.gif`. 스모크·CI와 분리돼 있고 관리자가 직접 실행한다. 절차는 [docs/development.md](docs/development.md)의 README 영상 절 |
| 전체 위성 점 스타일 | `frontend/src/theme/categoryColors.ts`(vitest 대상), `stores/layers.ts`의 `cloudStyle` |

## 반드시 지킬 불변 조건

### 데이터 수집

1. **CelesTrak 요청 예산**
   - 모든 CelesTrak 요청은 `GPService`를 거친다.
   - 같은 키(`group:<name>`, `catnr:<id>`)는 2시간에 한 번만 요청하고, 에러가 나면 2분부터 지수 백오프한다. 이력은 `fetch_log`에 남는다.
   - 403 "has not updated"는 오류가 아니라 `not_modified`로 처리한다.
   - 프런트엔드와 테스트에서 CelesTrak을 직접 호출하지 않는다. 테스트는 `httpx.MockTransport`를 쓴다.
   - `data/soda.db`를 지우거나 예산 검사를 우회해서 재요청하지 않는다. HTTP 에러가 2시간에 50회를 넘으면 IP가 차단된다.
   - 자동 갱신 그룹은 `gp/celestrak.py`의 `ALLOWED_GROUPS` 안에서만 고른다.
2. **Space-Track은 선택 기능이다.**
   - 계정은 `settings.local.toml`이나 `SODA_SPACETRACK_*` 환경변수에만 둔다.
   - 분당 30회, 시간당 300회 제한(`SlidingWindowLimiter`)을 유지한다.
   - 받은 데이터를 재배포하지 않는다.
3. **궤도요소 표준은 OMM이다.**
   - 모든 입력은 `gp/models.normalize_omm`을 거친다.
   - TLE 입력은 `gp/tle.py`의 `tle_to_omm` 한 곳에서만 OMM으로 바꾸고 곧바로 `normalize_omm`을 거친다. 다른 TLE 파싱 경로를 만들지 않는다. 표시용 TLE는 `orbit/propagator.tle_lines`로 만든다.
   - 99999를 넘는 카탈로그 번호도 동작해야 한다. 339999까지는 Alpha-5로 표시하고, 그 이상은 SGP4에 satnum 0을 넘긴다.
   - 상태벡터(OPM)와 ephemeris(OEM)는 궤도요소가 아니다. OMM으로 바꾸지 않고 별도 종류로 저장하며(`custom_states`·`custom_ephemerides`, 항상 GCRS), 요청에서는 `state_id`·`ephemeris_id`로 가리킨다. 궤도요소가 필요한 엔드포인트(`/passes`·`/access`·`/tmtc/session`)는 이들을 422 `sourceNeedsElements`로 거절한다.
   - HPOP을 OMM에서 시작할 때 초기 상태는 `hpop/propagate.state_from_omm`(epoch의 SGP4 상태)에서만 얻는다. 궤도요소 오차를 그대로 이어받으므로 문구에서 SGP4보다 정확하다고 쓰지 않는다.

### 시간·좌표·계산

4. **시간은 모두 UTC다.**
   - API는 ISO 8601 `...Z`를 쓰고, naive datetime은 `as_utc`로 UTC로 간주한다.
   - UI 입력 라벨에 `(UTC)`를 명시한다. 보조 시각은 브라우저 로컬 타임존을 `UTC+9 04:18:32`처럼
     오프셋과 함께 보여준다(`utils/time.ts`의 `formatLocal`·`localZoneLabel`). KST를 고정하지 않는다.
   - `formatUtc`·`toUtcInput`·`fromUtcInput`은 로케일 중립을 유지한다. `Intl`로 시각을 찍지 않는다.
5. **단위는 필드명 접미사로 드러낸다.** `*_m`, `*_km`, `*_deg`, `*_s`, `*Ms`(프런트 epoch ms).
   - `fixed_m`은 ITRS(지구고정), `inertial_m`은 GCRS(관성)이다.
   - 좌표 배열은 평탄 배열이다: `[x0, y0, z0, x1, ...]`, 경계선은 `[lon0, lat0, lon1, ...]`.
6. **Swath 기하를 바꾸면 해석해 테스트를 먼저 맞춘다.**
   - 현재 정의: nadir는 geodetic normal의 반대 방향, 경계는 WGS84 타원체와의 교점, 지평선 너머는 클램프, 주간 판정은 subpoint 태양고도.
   - `tests/test_swath.py`의 기준(폭 ≈ 2h·tanθ, 관측폭↔FOV 왕복, 극·날짜변경선 연속성)이 계속 통과해야 한다.
7. **태양·달·패스 계산은 Skyfield와 DE421을 쓴다.** HPOP의 3체 중력·항력·복사압도 같은 천체력을 쓰고, 지구 자세는 출력 좌표와 같은 Skyfield `itrs`에서 얻는다. OrbitView의 `CoordinateConverter`(GMST 버그)나 `PassPrediction`(60초 스텝) 로직을 옮기지 않는다.
   - 예외: 2D 지도의 밤·그림자 음영은 프런트 `orbit/sunDirection.ts`의 저정밀 태양식으로 그린다(DE421 대비 0.02° 이내, `sunDirection.test.ts`가 DE421 값으로 검사). 표시 전용이다. 식(eclipse) 구간처럼 숫자로 내보내는 값은 백엔드에서 계산한다.
8. **한도를 바꾸면 세 곳을 함께 고친다.** 현재 한도는 전파 30일·10만 샘플, 패스 30일·지상국 8곳,
   방위각 마스크 72점, 촬영 기회 30일·표적 20개(위성 하나당이고, 프런트가 위성 8개까지 따로 요청한다), 패스 예측 위성 8개·위성×일 60·전환 시간 3600초,
   궤도요소 파일 2 MiB·500건, HPOP 기간 7일·epoch 거리 7일·중력장 20차, OPM 1 MiB, OEM 32 MiB·20만 샘플,
   사용자 영상 업로드 1024 MB·세트 200개·이미지 150 메가픽셀·GeoTIFF 1,600 메가픽셀·변환 줌 20·
   변환 타일 6만 장(넘으면 줌을 낮춘다)·MBTiles 줌 22·가져오기 대기 20개·inbox 파일 8 GiB,
   카탈로그 가져오기 한 번에 10개·검색 범위 20°·결과 50개, 전력 계산의 촬영·교신 구간 5000개·개방전압 곡선 32점,
   커버리지 격자 2,500칸·샘플×칸 3천만 쌍·기회 30만 건(뒤의 둘은 서버만 센다)이다.
   - 백엔드 상수: `orbit/propagator.py`, `orbit/passes.py`(`MAX_STATIONS`), `orbit/horizon.py`,
     `orbit/access.py`(`MAX_ACCESS_WINDOW`·`MAX_TARGETS`), `orbit/coverage.py`(`MAX_COVERAGE_CELLS`·`MAX_COVERAGE_PAIRS`·`MAX_COVERAGE_EVENTS`), `orbit/contacts.py`(`MAX_SATELLITES`·`MAX_SATELLITE_DAYS`·`MAX_TURNAROUND_S`),
     `gp/element_files.py`(`MAX_ELEMENT_FILE_BYTES`·`MAX_ELEMENT_FILE_RECORDS`),
     `orbit/hpop/constants.py`(`HPOP_MAX_SPAN`·`HPOP_MAX_EPOCH_GAP`·`MAX_GRAVITY_DEGREE`), `orbit/opm.py`(`MAX_OPM_BYTES`),
     `orbit/oem.py`(`MAX_OEM_BYTES`·`MAX_OEM_SAMPLES`), `imagery/limits.py`,
     `orbit/power.py`(`MAX_POWER_INTERVALS`, 구간 수는 서버만 센다), `orbit/battery.py`(`MAX_OCV_POINTS`),
     `api/schemas.py`의 `PowerModel`·`BatteryModel`(값 범위)
   - 프런트: `PropagationCard.vue`의 `MAX_SAMPLES`, `stores/passes.ts`의 `MAX_STATIONS`,
     `StationForm.vue`의 `MAX_MASK_POINTS`, `mission/targets.ts`의 `MAX_ACCESS_DAYS`·`MAX_TARGETS`, `mission/coverage.ts`의 `MAX_COVERAGE_CELLS`(`coverage.test.ts`가 `coverage.py`와 대조한다), `utils/passPlan.ts`의 `MAX_SATELLITES`·`MAX_SATELLITE_DAYS`·`MAX_TURNAROUND_S`,
     `ElementFileImport.vue`의 `MAX_ELEMENT_FILE_BYTES`(건수는 서버만 센다), `orbit/propagatorOptions.ts`의 HPOP 한도(`propagatorOptions.test.ts`가 백엔드 상수와 대조한다),
     `CustomEphemeridesPanel.vue`의 `MAX_OEM_BYTES`,
     `utils/imagery.ts`의 `MAX_IMAGERY_BYTES`·`MAX_CATALOG_IMPORT_ITEMS`·`MAX_CATALOG_SEARCH_SPAN_DEG`
     (`imagery.test.ts`가 `limits.py`와 대조한다. 나머지 영상 한도는 서버만 검사한다),
     `mission/power.ts`의 `POWER_LIMITS`(`power.test.ts`가 `PowerModel`과 대조한다),
     `mission/battery.ts`의 `BATTERY_LIMITS`·`MAX_OCV_POINTS`(`battery.test.ts`가 `BatteryModel`·`battery.py`와 대조한다)
   - 테스트

### 프런트엔드

9. **시뮬레이션 시각의 기준은 Cesium clock이다.**
   - 컴포넌트와 레이어는 `useClockStore`(`seek`, `setRange`, `setPlaying` 등)로만 시간을 바꾼다.
   - 위성 위치 계산에 `Date.now()`를 쓰지 않는다. 현재 시각은 clock에서 읽는다.
10. **Cesium 객체를 반응성 시스템에 넣지 않는다.**
    - Viewer와 primitive는 `markRaw`나 클로저 변수로 둔다.
    - 큰 API 응답 배열은 `shallowRef`와 `markRaw`를 쓴다.
11. **지구본 레이어는 정해진 형태를 따른다.**
    - `useXxxLayer(viewer)`는 `GlobeViewer.vue`의 `effectScope` 안에서 호출하고 `{ dispose() }`를 반환한다.
    - 스토어를 `watch`해서 다시 그린다.
    - 레이어끼리 직접 참조하지 않는다(예외: `picking.ts`가 orbit graphics를 참조).
    - imagery 오버레이는 `viewer.imageryLayers`에 직접 넣지 않고 `globe/imageryOrder.ts`의
      `addOrdered`로 넣는다. 기본 지도 < 사용자 영상 < 나라 틴트 < 커버리지 지도 < 지상국 가시권 < 2D 밤·그림자 음영 순서를
      지키기 위해서다.
    - 클릭 대상 primitive에는 식별 가능한 `id`를 준다. 예: `{ kind: 'orbit', runId }`.
12. **지도 타일은 토큰 없이 동작해야 한다.**
    - CARTO(키 필요)와 OSM 공개 타일(앱 요청 차단)은 쓰지 않는다.
    - 새 지도를 추가하면 credit을 표시한다.
    - API 키와 토큰은 코드나 URL에 넣지 않는다. Cesium ion 토큰은 선택 사항이며 `frontend/.env.local`에만 둔다.
    - ion을 거치는 지도는 `basemaps.ts`에서 `ion: true`로 표시한다. 그 지도가 켜져 있을 때만 Cesium ion 로고를 보이고, 나머지 경우에는 그 자리에 SODA 표기를 둔다. Esri 등 지도 출처("Data attribution")는 지우지 않는다.
13. **색은 `theme/presets.ts`에서만 정의한다.**
    - 컴포넌트 CSS는 `rgb(var(--v-theme-*))`를 쓰고, 지구본 색은 `theme.preset.globe.*`를 읽는다.
    - 예외: 사용자가 고른 위성 분류 색은 `layers.prefs.cloudStyle.colors`에 저장한다. 분류 색은 항상 `layers.categoryColors`(`resolveCategoryColors`)로 읽고, 기본값은 프리셋에서 온다.
    - 프리셋은 SODA Dark 하나다(`activePreset`). 색을 바꿀 때는 Vuetify `colors`와 `GlobeStyle`을 함께 맞춘다.
    - 궤도 색은 `globe.orbitPalette`에서 오고 `theme/runColors.ts`의 `orbitColorHex(run.colorIndex, …)`로만 읽는다.
    - 지상국 색은 `globe.stationPalette`에서 오고, 스토어에는 팔레트 인덱스(number)만 둔다.
      인덱스는 단조 카운터라 지상국을 해제해도 나머지 색이 밀리지 않는다(`theme/stationColors.ts`).
    - 예외: `index.html`의 부팅 스플래시는 Vue 마운트 전에 그려지므로 다크 배경색과 `data-theme="dark"`를 복제한다. `theme/bootTheme.test.ts`가 프리셋과 일치하는지 검사한다.
14. **UI는 spacelab-portal 카드 레시피를 따른다.**
    - 패널은 `DashboardCard`(아이콘 배지 + eyebrow + 제목)로 만든다.
    - elevation 0, 1px 테두리, radius 14를 쓰고, 공통 클래스는 `styles.css`에 둔다(`stat-grid`, `list-row`, `form-stack`, `empty-hint`).
    - 아이콘은 lucide-vue-next를 쓰고, 아이콘만 있는 버튼에는 `aria-label`을 단다.
    - 패널에 긴 스크롤을 만들지 않는다. 설정이 많으면 탭으로 나누지 말고 카드 머리(`DashboardCard`의 `#append`)의 버튼이 여는 팝오버(`v-menu`)에 둔다(예: `PowerToolCard.vue`).
    - 경고가 될 통계 값은 배너를 늘리지 말고 칸에 틴트를 준다(`styles.css`의 `.stat--warning`·`.stat--error`).
    - 가정·주의처럼 설명하는 문구는 본문에 나열하지 않는다. `InfoTip.vue`(정보 아이콘에 올리면 뜨는 툴팁)에 둔다.
    - 간격은 `styles.css`의 `--space-1`~`--space-5`(4px 단위) 토큰을 쓴다. `.form-stack` 행 간격은
      `--stack-gap`이고, 위 행에 붙는 캡션은 `calc(var(--space-1) - var(--stack-gap))`로 당긴다.
    - 모드 토글(관측폭/FOV 등)은 `v-btn-toggle class="segmented"`로 폭 전체를 채운다. 공통 속성은
      `main.ts`의 `VBtnToggle` 기본값에 있다.
15. **테스트 훅은 유지한다.** `window.__sodaViewer`는 `?e2e`가 있을 때만 노출하고, 스모크 테스트가 궤도 선 좌표를 찾는 데 쓴다. `?splash=hold`는 부팅 스플래시를 화면에 남겨 스크린샷을 찍게 한다.
    `?lang=ko|en`은 언어를 그 요청에만 고정하고 `localStorage`에 쓰지 않는다. 스모크 테스트가 이걸로
    언어를 고정해 셀렉터와 스크린샷을 안정시킨다.

16. **언어는 한국어와 영어 둘 다 지원한다.**
    - UI 문구는 `frontend/src/i18n/{ko,en}/`의 네임스페이스 파일에 두고 `t()`로 읽는다.
      `en/index.ts`는 `MessageSchema` 타입이라 키가 빠지면 `vue-tsc`가 잡는다.
    - **데이터 테이블에 붙은 이름은 예외다.** 기관명·배경지도·센서 프리셋·지상국 프리셋은
      테이블과 같은 자리에 `{ ko, en }` 레코드로 두고 `i18n/label.ts`의 `pick()`으로 읽는다.
      `theme/presets.ts`는 `bootTheme.test.ts`가 Vue 없이 import하므로 i18n을 import하면 안 된다.
    - 사용자가 직접 입력한 값(직접 추가한 지상국 이름 등)은 번역하지 않는다. 프리셋에서 만든
      지상국만 `preset_id`로 카탈로그 이름을 따라간다(`stations/presets.ts`의 `stationLabel`).
    - `i18n/messages.test.ts`와 `i18n/noHardcodedText.test.ts`가 영어 모드 한글 누출을 막는다.
      허용 목록 밖 소스에 한글 리터럴을 넣지 않는다.

### 출처

17. **OrbitView(MIT)에서 로직을 옮기면 출처를 남긴다.**
    - 파일 docstring이나 주석에 출처를 적고, `THIRD_PARTY_NOTICES.md` 표를 갱신한다.
    - OrbitView의 로고, `.glb` 모델, 스크린샷, vendored Cesium 빌드는 가져오지 않는다.
    - 3D 모델은 저장소에 번들하지 않는다. 사용자가 올린 파일만 `data/models`에 두고, 서버는 외부 파일을 참조하지 않는 glTF 2.0 `.glb`만 받는다.
18. **기관 로고는 번들할 수 있지만 출처를 남긴다.**
    - 번들 로고는 `src/soda/assets/logos/<슬러그>.png`에 두고, `src/soda/assets/logos/SOURCES.md` 표에 기관명·출처 URL·라이선스 근거·받은 날짜를 적는다. `THIRD_PARTY_NOTICES.md`도 같은 변경에서 갱신한다.
    - 로고는 각 기관의 상표다. 식별 목적으로만 쓰고, 기관이 SODA를 보증하는 것처럼 보이게 쓰지 않는다.
    - 번들 로고는 MIT 라이선스 대상이 아니다. 각 기관의 소유이고, 권리자가 요청하면 삭제한다. 이 조건은 `src/soda/assets/logos/LICENSE`에 두고, `THIRD_PARTY_NOTICES.md`와 README에서 가리킨다. 루트 `LICENSE`는 순수 MIT로 둔다.
    - Wikimedia Commons에서 라이선스가 확인되는 것과 기관이 직접 공개한 공식 자산만 넣는다. 제3자가 올린 사본이나 접근 제한을 우회해 받은 파일은 넣지 않는다.
    - 기관이 변경을 금지한 로고(예: KARI)는 비율을 유지한 축소와 형식 변환만 한다. 배경 제거·색 변경·크롭을 하지 않는다.
    - 사용자가 올린 파일은 `data/logos`에 두고 같은 이름의 번들 로고를 가린다. 지우면 번들 로고가 다시 보인다. 서버는 PNG만 받고, 브라우저가 다른 형식을 PNG로 변환해 올린다.
    - 파일 이름은 `default`, 소문자 기관 슬러그, NORAD 번호 셋 중 하나다. 슬러그를 대문자로 쓰지 않는다(대소문자를 구분하지 않는 파일시스템에서 충돌한다).
    - 위성 이름에서 기관 슬러그를 정하는 규칙은 `frontend/src/utils/operators.ts`의 `OPERATOR_RULES` 한 곳에 둔다. 이름이 흔하거나 위성이 한두 기뿐인 기관은 NORAD 번호로 고정한다.
19. **지상국 프리셋 좌표는 인용 가능한 출처가 있어야 한다.**
    - 프리셋은 `frontend/src/stations/catalog/*.ts`에 두고, 모든 항목을 출처 URL·확인 날짜와 함께
      `frontend/src/stations/SOURCES.md` 표에 적는다. `stations/presets.test.ts`가 빠진 항목을 잡는다.
    - 좌표는 시설 단위 기준점이지 안테나 위상중심이 아니다. 더 넓은 시설 기준이면 `note`에 적는다.
    - 출처를 못 찾은 지상국은 추측해서 넣지 않고 뺀다.
    - `min_elev_deg`는 기관 공표값이 아니라 망별 관례다. 방위각 마스크는 어느 기관도 공표하지 않으므로
      프리셋에 넣지 않고 사용자가 입력한다.
20. **영상은 이 저장소에 직접 넣지 않는다. 샘플은 `samples` 서브모듈에만 둔다.**
    - 사용자가 자기 권한으로 받은 영상을 직접 등록한다. 로그인·주문이 필요한 영상(예: KARI KOMPSAT,
      CNES SPOT 원본)을 대신 받아 오는 코드를 넣지 않는다.
    - 샘플은 로그인 없이 받을 수 있고 재배포 조건이 분명한 영상만 넣는다. 항목마다 `samples/SOURCES.md`
      표에 출처 주소·라이선스·표기·받은 날짜·가공 내용을 적고, 사이드카의 `license`·`attribution`에도
      같은 값을 둔다. 동일조건(SA)·비상업(NC) 조건은 그대로 따른다.
    - 서브모듈은 LFS 없는 일반 git 저장소다. 파일 하나는 95 MiB를 넘지 않게 한다(GitHub 한도 100 MiB).
      넘으면 해상도를 낮추지 않고 범위를 줄인다. `scripts/build_imagery_samples.py`가 이 한도를 검사한다.
    - 샘플은 `samples/manifest.toml`을 고친 뒤 스크립트로 다시 만든다. 손으로 만든 파일을 넣지 않는다.
      스크립트는 관리자가 직접 실행하며 서버와 테스트는 실행하지 않는다. 받는 곳은 스크립트의 `HOSTS`뿐이다.
    - 서버는 샘플 폴더에 쓰지 않는다. 샘플은 수정·삭제할 수 없고(422 `imagerySampleLocked`) 세트 수
      한도에 세지 않는다. 같은 id의 사용자 세트가 있으면 그것이 앞선다.
    - 테스트는 실제 샘플을 읽지 않는다. `Settings()`를 직접 만들면 샘플 폴더가 없고(`Settings.read`만
      서브모듈을 가리킨다), 브라우저 스모크는 `imagery_samples = false`로 띄운 서버에서 돌린다.
    - 세트의 `license`에는 출처가 밝힌 라이선스 이름을 그대로 둔다. 목록과 지구본 출처 표기에 함께
      보이고, `NC`가 들어 있으면 비상업 표시를 붙인다(`utils/imagery.ts`의 `isNonCommercial`).
    - 영상 카탈로그 요청은 `imagery/catalog/http.py`만 한다. https, `ALLOWED_HOSTS`에 있는 호스트,
      리다이렉트 없음, 크기 한도를 지킨다. 클라이언트가 준 URL은 받지 않는다. 항목 id만 받고 주소는
      서버가 카탈로그에서 다시 찾는다. GDAL에 URL을 주지 않는다(`/vsicurl` 금지).
    - 프런트엔드는 카탈로그를 직접 호출하지 않는다. 테스트는 `httpx.MockTransport`(백엔드)와
      `page.route`(브라우저)로 대신하고 실제 카탈로그에 나가지 않는다.
    - 새 카탈로그를 붙일 때는 로그인 없이 받을 수 있고 재배포 조건이 분명한 것만 넣는다.
    - 서버가 스스로 읽어 가져오는 폴더는 `data/imagery/inbox` 하나뿐이다. 거기 있던 사용자 파일은 지우지 않고
      `inbox/done`이나 `inbox/failed`로 옮긴다. 가져오는 동안의 자리는 `inbox/.processing`이다
      (`.work`는 시작할 때 지우므로 쓰지 않는다).
    - 장면 제품(SPOT DIMAP)은 inbox로만 받는다. 묶음은 통째로 풀지 않는다. `METADATA.DIM`과 그것이
      가리키는 영상 파일 둘만 이름으로 찾아 SODA가 정한 이름으로 꺼내고, 묶음 안의 경로를 쓰는 경로로
      쓰지 않는다. 영상 파일 이름은 `METADATA.DIM`과 같은 폴더의 파일 이름만 받는다. 새 제품 종류는
      실제 제품 파일로 형식을 확인한 뒤 `imagery/products.py`에 붙인다.
    - 장면 제품은 네 모서리로 편 것이지 정사보정이 아니다. 문구에서 정사영상이나 위치 정확도를
      약속하지 않는다. 라이선스는 제품에 없으므로 추측해 채우지 않는다.
    - 영상 레이어는 카메라가 그 영상 가까이 확대했을 때만 `imageryLayers`에 넣는다. 멀리서는 기본 지도만
      있어야 한다. 스모크 테스트가 `imageryLayers` 개수를 세기 때문이다.
    - 업로드한 파일은 신뢰하지 않는다. MBTiles는 읽기 전용으로 열어 정해진 SELECT만 실행하고,
      이미지·GeoTIFF는 시그니처를 확인한 뒤 드라이버를 지정해 연다. 서버는 파일시스템 경로를
      입력으로 받지 않는다.

## 코드 규칙

- **공통**
  - 기존 코드의 밀도와 관용구를 따른다. 파일은 약 500줄 이하를 유지한다.
  - 사용자에게 보이는 문구는 한국어를 먼저 쓰고 영어를 함께 채운다(불변 조건 16).
  - API 오류·경고는 `{code, message, params}`로 내보낸다. `code`는 `src/soda/errors.py`의
    `ERROR_CODES`·`WARNING_CODES`에 등록하고, 프런트 `errors.<code>`·`warnings.<code>` 키와 1:1로 맞춘다.
    `message`의 한국어는 curl·로그·번역 누락 시의 폴백이다.
  - 식별자, 주석, docstring은 영어로 쓴다.
- **Python**
  - 공개 함수에는 타입 힌트와 Google 스타일 docstring을 붙인다.
  - 진단 출력은 `logging`을 쓴다. `print`는 CLI 출력에만 쓴다.
  - bare `except`와 가변 기본 인자는 쓰지 않는다.
  - 무거운 numpy·Skyfield 계산은 API에서 `asyncio.to_thread`로 돌린다.
  - Ruff 설정: line 100, `B,E,F,I,SIM,UP`.
- **TypeScript/Vue**
  - `<script setup lang="ts">`와 Pinia setup store를 쓴다.
  - 백엔드 호출은 `api/client.ts`로만 한다.
  - 순수 계산은 테스트 가능한 모듈로 분리하고 vitest를 붙인다.
  - Prettier 설정: 세미콜론 없음, 작은따옴표, 100자.
- **의존성**
  - Python은 `uv add` / `uv add --dev`, 프런트는 pnpm으로 추가한다. 잠금 파일(`uv.lock`, `frontend/pnpm-lock.yaml`)을 함께 커밋한다.
  - 새 프레임워크나 무거운 패키지는 사용자와 먼저 합의한다.

## API를 바꿀 때 순서

1. `src/soda/api/*.py`와 `api/schemas.py`를 수정한다.
2. `tests/test_api*.py`에 계약 테스트를 추가하거나 수정한다. 공통 fixture(`client`, `bare_client`)는 `tests/conftest.py`에 있다.
3. `frontend/src/api/types.ts`와 `client.ts`를 동기화한다.
4. `docs/architecture.md`의 API 표를 갱신한다.

## 완료 전 검증

- **백엔드를 바꿨다면**: `ruff check`, `ruff format --check`, `pytest`를 돌린다.
- **프런트를 바꿨다면**: `typecheck`, `lint`, `test`, `build`를 돌린다.
- **화면이나 지구본을 바꿨다면**
  - 서버를 띄우고 `test:browser`를 돌린다.
  - `.cache/screenshots/`의 스크린샷을 직접 확인한다. 헤드리스에서도 WebGL(SwiftShader)이 동작한다.
- **보고**
  - 실행하지 않은 검증을 통과했다고 쓰지 않는다.
  - DE421이 없어 건너뛴 테스트가 있으면 그 사실을 적는다.

## Git

- **브랜치**: 기본 브랜치는 `main`이고 원격은 `origin` = `git@github.com:messy-snail/SODA.git`이다.
- **커밋 메시지**: Conventional Commits에 한국어 제목을 쓴다. 예: `feat(swath): 주간 필터 추가`, `fix(gp): 백오프 계산 수정`.
  - scope는 `gp`, `orbit`, `api`, `frontend`, `globe`, `theme`, `docs`, `build`, `test` 중에서 고른다.
- **커밋·push 시점**: 사용자가 요청할 때만 한다. force push와 히스토리 재작성은 명시적 요청 없이 하지 않는다.
- **커밋하지 않는 것**
  - `data/`, `settings.local.toml`, `frontend/.env.local`
  - `src/soda/static/dist/`, `node_modules/`, `.cache/`, `test-results/`
  - `CLAUDE.local.md`
