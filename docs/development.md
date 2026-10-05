# 개발 안내

## 규칙

- **Python**: uv만 사용한다. `uv add` / `uv add --dev`로 의존성을 바꾸고 `uv.lock`을 커밋한다.
- **프런트엔드**: `npx pnpm@10.34.5 --dir frontend ...`로 실행한다. 잠금 파일은 `frontend/pnpm-lock.yaml`이다.
- **포맷**
  - Ruff: line 100, `B,E,F,I,SIM,UP`
  - Prettier: 세미콜론 없음, 작은따옴표, 100자
  - ESLint: typescript-eslint + vue essential
- **커밋**: Conventional Commits에 한국어 제목을 쓴다. 예: `feat(swath): 주간 필터 추가`
- **git에 넣지 않는 것**: `data/`(SQLite, 천체력), `settings.local.toml`, 빌드 결과(`src/soda/static/dist`)

## CelesTrak 요청 예산

개발 중에도 CelesTrak 서버에 부담을 주지 않도록 한다.

- 테스트는 `httpx.MockTransport`로 네트워크 없이 실행한다(`tests/test_celestrak.py`, `tests/test_api*.py`).
- 요청 이력은 `data/soda.db`의 `fetch_log`에 남는다. DB를 지워도 CelesTrak은 같은 IP의 재다운로드를 2시간 동안 403으로 막는다. 이때 SODA는 이 응답을 오류가 아닌 `not_modified`로 기록한다.
- 새 그룹을 자동 갱신 대상에 넣을 때는 `gp/celestrak.py`의 `ALLOWED_GROUPS`에 있는지 확인한다.

## 테스트 구성

| 파일 | 확인 내용 |
| --- | --- |
| `tests/test_propagator.py` | OMM 경로가 python-sgp4 동봉 Vallado 검증 벡터(00005, 06251)와 1 m 이내로 일치하는지, 프레임 간 일관성, 한도·경고 |
| `tests/test_swath.py` | 작은 각의 폭이 `2h·tanθ`와 1% 이내인지, 관측폭↔FOV 왕복 변환, 지평선 제한, 극·날짜변경선 연속성, 세그먼트 분할 |
| `tests/test_footprint.py` | h=400 km에서 ε=0/10/30°일 때 반경 2201/1344/603 km |
| `tests/test_passes.py` | AOS/LOS 시점 고도각이 최소 고도각과 일치하는지, 진행 중인 패스 잘림 처리, 균일 마스크가 무마스크와 같은 결과인지, 마스크가 모든 경계 고도각을 정하는지, 노치가 패스를 둘로 가르는지, 지상국 수 한도 |
| `tests/test_horizon.py` | 방위각 랩어라운드 보간, 정점 검증, 탐색 하한 |
| `tests/test_errors.py` | 소스에 쓰인 모든 코드가 레지스트리에 있고 죽은 코드가 없는지(AST 스캔), `ApiError` detail 형태 |
| `tests/test_celestrak.py` | 2시간 규칙(재시작 포함), 403 not-updated, 지수 백오프, CATNR 온디맨드 조회 |
| `tests/test_spacetrack.py` | 요청 제한, 로그인 폼 인코딩, 세션 만료 시 재로그인 |
| `tests/test_api.py` | 상태·카탈로그·전파·swath 엔드포인트, ETag, 검증 오류(코드 단언) |
| `tests/test_api_stations.py` | 지상국 CRUD, 다중 지상국 패스 계약, 마스크 검증과 가시권 형상 |
| `tests/test_api_uploads.py` | 로고·3D 모델 업로드·삭제(천체력 불필요) |
| `tests/test_api_settings.py` | 데이터베이스 설정 조회·연결 테스트·저장 |
| `tests/test_api_sensor_presets.py` | 사용자 센서 프리셋 CRUD·이름 중복·범위 검증 |
| `tests/test_logos.py` | PNG 시그니처·IHDR·크기 검증, 로고 이름 규칙(기관 슬러그 포함), 번들 로고 폴백과 오버라이드, 원자적 저장과 삭제 |
| `tests/test_imagery_tiling.py` | Web Mercator 왕복, 타일 범위, 해상도→줌 계산, 네 모서리 검증(범위·날짜변경선·나비 모양·퇴화), GCP 격자 |
| `tests/test_imagery_mbtiles.py` | MBTiles 검증(SQLite 아님·tiles 없음·줌 범위·벡터 타일 거부), TMS 행 뒤집기, 읽기 전용 연결이 쓰기를 거부하는지, `tiles` 뷰 지원, 라이브러리 목록·수정·삭제·정리 |
| `tests/test_imagery_warp.py` | rasterio 변환. 네 색 사분면 이미지가 맞는 모서리에 오는지, footprint 밖이 투명한지, JPEG·WebP 타일 구분, GeoTIFF(경위도·UTM 16비트·nodata), 픽셀 한도. rasterio를 import하는 테스트는 이 파일과 `test_imagery_inbox.py`·`test_imagery_catalog.py`다 |
| `tests/test_api_imagery.py` | 영상 업로드·목록·타일·수정·삭제, 빈 타일의 투명 응답, 크기·개수 한도, 라이선스 저장, 변환 작업의 성공·실패, 시작 시 정리, 앱 import가 rasterio를 불러오지 않는지 |
| `tests/test_imagery_dimap.py` | SPOT 장면 `METADATA.DIM` 읽기. 꼭짓점 순서를 섞어도 같은 모서리, 표시 밴드, DOCTYPE·경로가 든 파일 이름·볼록하지 않은 모서리 거절. 문서는 conftest의 `make_dim`으로 만든다 |
| `tests/test_imagery_inbox.py` | 감시 폴더. 안정되기 전에는 건드리지 않는지, 성공 → `done/`, 실패 → `failed/`, 사이드카가 있어야 하는 이미지, 한도 초과 시 대기, 심볼릭 링크·숨김 파일 무시, 이름 충돌, 재시작 복구. 시계를 주입하고 `scan_once()`를 직접 부른다 |
| `tests/test_imagery_catalog.py` | 카탈로그 검색·가져오기. 가짜 Maxar 버킷과 OpenAerialMap을 `httpx.MockTransport`로 세운다. 허용 호스트 판정, 첫 검색의 요청 수와 캐시된 검색의 요청 0건, TTL, bbox 목록 형식 차이, id 검증, 리다이렉트 거부, 크기 초과, 허용되지 않은 주소, 끝까지 가져오기 |
| `tests/test_models3d.py` | GLB 헤더·JSON 청크 검증, 외부 파일 참조 거부, 모델 이름 규칙(기관 슬러그는 거부), 원자적 저장과 설정 파일 |
| `tests/test_element_files.py` | 궤도요소 파일: OMM JSON·XML·KVN·CSV가 같은 레코드로 읽히는지, 2줄·3줄 TLE 혼합, 못 쓰는 레코드만 건너뛰는지, SGP4-XP·시간계·day-of-year epoch 검사, XML DOCTYPE 거절, 건수 한도, 저장 이름 정하기(`plan_import`) |
| `tests/test_hpop_forces.py` | EGM96 계수 값, 점질량·J2 가속도의 닫힌 식, 4·20차 가속도가 따로 쓴 정규화 퍼텐셜의 기울기와 일치하는지, Harris-Priester 표 노드·팽대부, 항력 방향, 원통 그림자, 3체 조석 |
| `tests/test_hpop_propagate.py` | 2체 에너지·각운동량 보존, J2 승교점 이동률(해석식 2% 이내), 앞·뒤 arc 연결, ISS 1일 HPOP과 SGP4 차이(10 km 이내), 제원 출처 우선순위, 재진입, 구간 한도, 궤적 캐시 |
| `tests/test_api_hpop.py` | `/propagate`·`/swath`의 `propagator`·`hpop` 계약, `force_model` 응답, 한도 코드, 천체력 없이 도는 중력 전용 HPOP, swath의 캐시 재사용 |
| `tests/test_opm.py` · `tests/test_api_custom_states.py` | OPM KVN·XML 파싱, ITRF·TEME → GCRS, 상태 검사, 접촉 궤도 요약, 상태벡터 CRUD와 HPOP 전파, 궤도요소가 필요한 엔드포인트의 거절 |
| `tests/test_oem.py` · `tests/test_api_custom_ephemerides.py` | Lagrange 보간, SGP4 궤도 → OEM → 보간 왕복(1 m 이내), 세그먼트·구간 밖 처리, 프레임·시간계 거절, 업로드·전파·DB 보기(BLOB 대신 크기) |
| `frontend/src/**/*.test.ts` | 시간 분해·로컬 오프셋, 궤도·swath 기하 보조 함수, 위성 점·모양 스타일 검증, 위성 이름→기관 매핑 규칙, 로고·모델 선택 규칙, 큐브·구 메시 방향과 텍스처 좌표, GLB 패킹, `index.html` 부팅 스플래시·스크립트와 테마 프리셋·언어 동기화 |
| `frontend/src/i18n/messages.test.ts` | ko/en 키 일치, 영어 카탈로그에 한글 0건, 보간 파라미터 일치, `src/soda/errors.py`의 코드 전량 번역 |
| `frontend/src/i18n/noHardcodedText.test.ts` | 허용 목록 밖 소스에 한글 리터럴이 없는지 |
| `frontend/src/stations/presets.test.ts` | 프리셋 id·좌표 범위·출처 URL·확인 날짜, `SOURCES.md` 표 누락 |
| `frontend/src/utils/passTimeline.test.ts` | 타임라인 막대 배치(0~1 정규화, 창 밖 클램프, 잘림 표시) |
| `frontend/src/mission/coverage.test.ts` | 커버리지 격자 모양, 칸 번호, 위성 병합, 네 지표, 면적 가중 요약, 색 램프, CSV, `coverage.py` 한도 대조 |
| `frontend/src/utils/pool.test.ts` | 동시 실행 수 제한과 중단 |
| `frontend/src/orbit/passGeometry.test.ts` | 패스 상세 그래프의 기하(방위각·고도각, 직선 통과의 거리 변화율 해석해, 도플러 부호, 스카이 플롯 좌표, 마스크 보간) |
| `frontend/src/utils/levelChart.test.ts` | 긴 시계열을 구간별 최저·최고로 줄이기 |
| `frontend/src/theme/stationColors.test.ts` | 지상국 팔레트 순환과 인덱스 안정성 |
| `frontend/tests/smoke.spec.ts` | 실제 서버에서 SODA 크레딧 → 위성 상세 카드 폭 → ISS 전파 → 궤도 선 클릭 → swath(12 km) → 따라가기 → 큐브 표시 → 패스 계산 → 위성 표시·레이어 카드. 부팅 스플래시를 따로 찍고, 영어 로케일 화면에 한글이 남지 않는지 따로 확인한다 |

- `frontend/tests/imagery.spec.ts`는 테스트 안에서 만든 PNG와 `frontend/tests/fixtures/imagery/`의 작은 GeoTIFF(`scripts/build_e2e_imagery.py`로 만든다)를 실제 `data/imagery`에 등록했다가 지운다. 이름은 모두 `e2e-`로 시작한다. 세트로 이동하면 저절로 나타나는지(몇 km짜리 작은 세트 포함), 레이어 순서(기본 지도 < 영상 < 국경), 여러 파일 일괄 등록을 확인한다.
- `frontend/tests/imagery-catalog.spec.ts`는 SODA의 카탈로그 엔드포인트 응답을 `page.route`로 대신해, 실제 카탈로그에 나가지 않고 검색·선택·가져오기 요청 본문을 확인한다. 목록과 `/imagery/samples` 응답도 대신해 한 줄 행(센서 칩의 색, 해상도 칩), 펼친 세부(샘플은 수정·삭제 버튼 없음), 센서·해상도 필터와 개수 표시, 접힌 `영상 추가` 섹션과 그 안의 두 탭, 서브모듈이 없을 때의 안내 문구를 확인한다.
- 브라우저 스모크용 서버는 `imagery_samples = false`를 넣은 설정 파일로 띄운다(`SODA_SETTINGS`). `imagery.spec.ts`가 인천 부근에 다른 세트가 없다고 가정하는데, 샘플에 인천 영상이 있기 때문이다.
- 실제 샘플이 제대로 보이는지는 자동화하지 않는다. `scripts/build_imagery_samples.py`로 만든 뒤 샘플을 켠 서버에서 하나씩 확대해 눈으로 본다.
- 실제 카탈로그에서 영상을 받아 보는 확인은 자동화하지 않는다. 서버를 띄우고 영상 탭에서 한 번 해 본다.
- `frontend/tests/coverage.spec.ts`는 커버리지 도구에서 영역을 만들고 계산해 imagery 레이어가 하나 늘었다가 다른 도구로 가면 원래 수가 되는지, 영역만 나열되는지, 지표 전환·칸 클릭·CSV 내보내기·패널 넘침 없음을 확인한다.
- `frontend/tests/scale-bar.spec.ts`는 축척이 페이지 안에서 따로 잰 m/px과 2% 안에서 맞는지를 3D와 2D에서 확인한다.
- 실제 위성 영상이 해안선과 맞는지는 자동으로 확인하지 않는다. `scripts/fetch_spot_samples.py`로 quicklook을 등록해 눈으로 본다.
- 스모크 테스트는 로고를 올리지 않는다. 실제 `data/logos`에 쓰기 때문이다. 로고 텍스처는 API 계약 테스트, 메시 단위 테스트, 수동 확인으로 검증한다.
- 기본 제공 로고(`src/soda/assets/logos`)는 업로드 없이 보이므로, 기관 로고가 실제로 붙는지는 그 기관 위성을 전파해 눈으로 확인한다. 예: 위성 탐색의 `KOMPSAT-3A`를 전파하고 큐브로 바꾸면 `kari` 로고가 보여야 한다.
- 커버리지 분석 도구는 숨겨져 있다. 확인하려면 `frontend/.env.local`에 `VITE_SODA_COVERAGE=1`을 넣고 다시 빌드한다. `frontend/tests/coverage.spec.ts`는 같은 환경변수를 준 채 실행할 때만 돌고, 아니면 건너뛴다.
- 3D 모델(GLB) 도구는 숨겨져 있다. 확인하려면 `frontend/.env.local`에 `VITE_SODA_GLB_MODELS=1`을 넣고 다시 빌드한다.
- DE421 천체력이 없으면 태양·달 위치가 필요한 테스트(`test_passes.py`, `test_api.py`, `test_api_stations.py`, HPOP의 3체·항력·복사압 테스트 등)는 건너뛴다. 한 번 `uv run soda serve`로 swath를 요청하거나 테스트 전에 내려받아 둔다.
- Playwright 스모크 테스트는 기본으로 설치된 Edge(`msedge` 채널)를 쓴다.
  - 다른 브라우저는 `PLAYWRIGHT_CHANNEL`로 지정한다.
  - 다른 서버 주소는 `SODA_URL`로 지정한다.
- 테스트는 viewer를 `?e2e` 쿼리가 있을 때만 `window.__sodaViewer`로 노출한다. 궤도 선의 화면 좌표를 계산하는 데 쓴다.
- `?splash=hold`는 부팅 스플래시를 걷지 않고 남긴다. 정상 흐름에서는 지구본 첫 프레임에 사라지므로 스크린샷을 찍으려면 이 쿼리가 필요하다.
- `?lang=ko|en`은 그 요청에만 언어를 고정한다(`localStorage`에 쓰지 않는다). 스모크 테스트가 한국어 셀렉터를 쓰므로 `?lang=ko`로 고정하고, 영어 확인은 `?lang=en`으로 따로 연다. 수동 확인에도 그대로 쓸 수 있다.
- 지상국 프리셋을 고르거나 방위각 마스크를 손보는 화면을 확인할 때는 `data/soda.db`를 복사한 임시 데이터 디렉터리로 서버를 따로 띄운다. 스모크 테스트는 실제 DB에 지상국을 만들지 않는다.

## README 영상 다시 만들기

README의 GIF(`docs/media/*.gif`)는 실행 중인 앱을 Playwright로 조작해 녹화한다. 화면이
바뀌면 다시 만든다. 관리자가 직접 실행하고, 스모크 테스트와 CI에는 포함되지 않는다.

```bash
# 1. 빌드와 서버. 샘플 영상(`samples` 서브모듈)이 켜져 있어야 영상 장면을 찍을 수 있다.
npx --yes pnpm@10.34.5 --dir frontend build
uv run soda serve
# 2. 녹화: 장면마다 무손실 프레임을 .cache/demo-videos/<이름>/ 에 남긴다.
npx --yes pnpm@10.34.5 --dir frontend demo:record
# 3. GIF 변환(ffmpeg 필요): docs/media/<이름>.gif
uv run python scripts/build_readme_media.py
```

- 장면은 `frontend/demos/<이름>.demo.ts`이고 공용 헬퍼는 `frontend/demos/stage.ts`다. 설정은
  `frontend/playwright.demo.config.ts`(`SODA_URL`·`PLAYWRIGHT_CHANNEL`은 스모크와 같다).
  한 장면만 다시 찍으려면 `demo:record <이름>`, 변환도 `build_readme_media.py <이름>`.
- `scene.action()` 앞은 준비 과정이라 녹화하지 않는다. 그 뒤부터가 영상이다.
- 프레임은 Playwright 영상(VP8)이 아니라 DevTools screencast의 PNG로 받는다. 손실 압축의
  잡음이 있으면 정지 화면도 프레임마다 달라져 GIF가 수십 MB가 된다.
- 같은 이유로 녹화 중에는 별·해·달과 대기 조명 변화, 전체 위성 점을 끈다(`stage.ts`의
  `boot`). 카메라를 계속 움직이는 장면도 용량이 크게 는다.
- 대상 위성은 BLUEBON(62688)과 KOMPSAT-3A(40536)다. 로고는 번들 로고만 나오게 한다.
- 용량 예산은 `build_readme_media.py`의 `MAX_CLIP_BYTES`(개당 8 MiB)·`MAX_TOTAL_BYTES`
  (합계 40 MiB)이고 넘으면 실패한다.
- 영상 장면의 샘플은 CC BY 4.0인 것만 쓴다(Satellogic, Umbra). 바꾸면 README 캡션의
  출처도 같이 고친다.
- `imagery-add` 장면은 `uv run python scripts/build_demo_imagery.py`가 만든
  `.cache/demo-assets/busan-new-port.tif`(Satellogic 샘플의 타일을 이어 붙인 것, CC BY 4.0)를
  올린다. 같은 자리의 샘플과 겹치지 않게 `imagery_samples = false` 서버에서 찍고, 끝나면
  등록한 세트를 지운다. `imagery` 장면은 반대로 샘플을 켠 서버가 필요하다.
- `database` 장면은 DB 파일의 절대 경로가 화면에 찍힌다. 사용자 이름이 들어가지 않는
  경로(예: `/tmp/soda/data`)의 데이터 복사본으로 서버를 띄운다. 저장 버튼은 누르지 않는다.
- 날짜 입력칸(`datetime-local`)의 표기는 앱 언어가 아니라 녹화하는 PC의 브라우저 언어를
  따른다. 한국어 macOS에서 찍으면 그 칸만 한국어로 나온다.
- 실제 DB에 쓰는 장면(TC/TM 세션, 지상국)이 있으므로 `data/`를 복사한 임시 데이터
  디렉터리(`SODA_DATA_DIR`)와 `auto_refresh = false` 설정으로 띄운 서버에서 찍는다.
