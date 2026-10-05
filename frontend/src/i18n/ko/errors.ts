export default {
  // Raised by the frontend itself.
  requestFailed: '요청 실패 (HTTP {status})',
  networkUnreachable: 'SODA 서버에 연결할 수 없음',

  // Routing and startup
  apiNotFound: 'API 없음',
  frontendNotBuilt: '프런트엔드 빌드 필요 (frontend: pnpm build)',
  invalidRequest: '요청 값 확인 필요',

  // Element sets
  elementsNotFound: 'NORAD {norad_id} 궤도요소 없음',
  unsupportedGroup: '지원하지 않는 그룹: {group}',
  ephemerisUnavailable: '태양 위치 천체력(de421.bsp) 불러오기 실패',

  // Ground stations
  stationNotFound: '지상국 없음',
  stationNameTaken: '같은 이름의 지상국이 이미 있음',
  sensorPresetNotFound: '센서 프리셋 없음',
  sensorPresetNameTaken: '같은 이름의 센서 프리셋이 이미 있음',
  customElementsInvalid: '궤도요소 형식 오류 · TLE 2~3줄 또는 OMM JSON 필요',
  customElementNotFound: '사용자 궤도요소 없음',
  customElementNameTaken: '같은 이름의 사용자 궤도요소가 이미 있음',
  elementFileTooLarge: '궤도요소 파일은 {max_mb} MB 이하만 가져오기 가능',
  elementFileUnreadable: '파일에서 궤도요소를 읽을 수 없음 · TLE 또는 OMM 파일 필요',
  elementFileWrongKind: '{kind} 파일은 궤도요소가 아님 · TLE 또는 OMM 파일 필요',
  elementFileTooManyRecords: '궤도요소가 최대 {max}건 초과 · 파일을 나눠야 함',
  stateVectorInvalid:
    '상태벡터 오류 · 좌표계·위치·속도 확인 필요 (고도 100 km 이상, 지구에 묶인 궤도)',
  stateNotFound: '상태벡터 없음',
  stateNameTaken: '같은 이름의 상태벡터가 이미 있음',
  sourceNeedsElements: '상태벡터·ephemeris로는 계산 불가 · 궤도요소(TLE·OMM)가 있는 위성 필요',
  oemInvalid: 'OEM 파일을 읽을 수 없음 · CCSDS OEM(KVN·XML), 지구 중심, 묶인 궤도 필요',
  oemFrameUnsupported: 'OEM 좌표계 {frame} 미지원 · EME2000·GCRF·ICRF·ITRF·TEME 가능',
  oemTimeSystemUnsupported: 'OEM 시간계 {time_system} 미지원 · UTC만 가능',
  oemTooLarge: 'OEM 파일은 {max_mb} MB 이하만 가져오기 가능',
  oemTooManySamples: 'OEM 샘플이 최대 {max}개 초과',
  ephemerisNotFound: 'ephemeris 없음',
  ephemerisNameTaken: '같은 이름의 ephemeris가 이미 있음',
  ephemerisNoOverlap: '전파 구간이 ephemeris 파일의 구간({start} ~ {end})과 겹치지 않음',
  satelliteRefInvalid: 'norad_id, custom_id, state_id, ephemeris_id 중 하나만 지정 필요',

  // Propagation
  endBeforeStart: '종료 시각은 시작 시각보다 늦어야 함',
  spanTooLong: '전파 기간은 최대 {days}일',
  stepTooSmall: '스텝은 {min_s}초 이상이어야 함',
  tooManySamples: '샘플 수가 최대 {max}개 초과 · 스텝을 늘려야 함',
  sensorWidthAmbiguous: '관측폭과 FOV 중 하나만 지정 필요',
  propagatorNotAllowed: '이 궤도 출처는 {propagator} 전파기로 계산할 수 없음',
  hpopSpanTooLong: 'HPOP 전파 기간은 최대 {days}일',
  hpopEpochTooFar: 'HPOP 전파 구간은 epoch에서 {days}일 이내여야 함',

  // Passes
  passWindowTooLong: '패스 예측 기간은 최대 {days}일',
  noStationSelected: '지상국을 하나 이상 선택 필요',
  tooManyStations: '지상국은 한 번에 최대 {max}곳까지 계산 가능',

  // Imaging opportunities
  accessWindowTooLong: '촬영 기회 계산 기간은 최대 {days}일',
  noTargetSelected: '촬영 대상을 하나 이상 지정 필요',
  tooManyTargets: '촬영 대상은 한 번에 최대 {max}개',
  coverageGridTooLarge: '커버리지 격자는 최대 {max}칸',
  coverageTooHeavy: '커버리지 계산량 초과 · 영역이나 기간을 줄이거나 격자를 {max_cells}칸 이하로',

  // Power budget
  powerIntervalsTooMany: '촬영·교신 구간은 최대 {max}개 · 지금 {count}개',
  powerStartOutsideRun: '시작 SOC의 기준 시각이 전파 구간 밖',
  batteryCurveInvalid: '개방전압 곡선이나 셀 전압 한계를 쓸 수 없음',

  // Contact plans
  passBudgetExceeded: '위성 수 × 기간이 최대 {max}일 초과 · 위성이나 기간을 줄여야 함',
  noSatelliteSelected: '위성을 하나 이상 지정 필요',
  tooManySatellites: '위성은 한 번에 최대 {max}개',

  // Simulated TC/TM link
  tmtcBadCommand: '명령 형식 오류',

  // Horizon masks
  maskTooFewPoints: '방위각 마스크는 점이 {min}개 이상 필요',
  maskTooManyPoints: '방위각 마스크 점은 최대 {max}개',
  maskBadPoint: '방위각 마스크 점은 (방위각, 최소 고도각) 쌍이어야 함',
  maskAzimuthRange: '마스크 방위각은 0° 이상 360° 미만이어야 함',
  maskElevationRange: '마스크 최소 고도각은 0°에서 {max}° 사이여야 함',
  maskDuplicateAzimuth: '마스크 방위각 중복',

  // Logos
  logoNotFound: '로고 없음',
  logoBadName: '로고 이름은 default, 기관 이름, NORAD 번호 중 하나여야 함',
  logoBusy: '로고 파일 사용 중 · 잠시 후 다시 시도 필요',
  logoBuiltinLocked: '기본 제공 로고는 삭제 불가',
  logoTooLarge: '로고 파일은 {max_mb} MB 이하만 업로드 가능',
  logoNotPng: 'PNG 이미지 아님',
  logoHeaderUnreadable: 'PNG 헤더를 읽을 수 없음 · 파일 손상 가능성 있음',
  logoTooWide: '로고는 가로·세로 {max_px} px 이하만 사용 가능',

  // Settings
  databaseUrlInvalid: '지원하지 않는 데이터베이스 주소 · sqlite:///<경로> 형식으로 입력 필요',
  databaseProbeFailed: '이 경로의 데이터베이스 사용 불가 ({detail})',
  databaseUrlFromEnv: 'SODA_DATABASE_URL 환경변수가 설정돼 있어 여기서 변경 불가',
  databaseTableUnknown: '볼 수 없는 테이블: {table}',

  // 3D models
  modelNotFound: '모델 없음',
  modelBadName: '모델 이름은 default 또는 NORAD 번호여야 함',
  modelBusy: '모델 파일 사용 중 · 잠시 후 다시 시도 필요',
  modelTooLarge: '모델 파일은 {max_mb} MB 이하만 업로드 가능',
  glbNotGlb: '.glb(glTF 바이너리) 파일 아님',
  glbVersion: 'glTF 2.0 모델만 지원',
  glbLengthMismatch: 'GLB 헤더의 길이가 파일 크기와 다름 · 파일 손상 가능성 있음',
  glbJsonChunk: 'GLB의 JSON 청크를 읽을 수 없음',
  glbExternalUri:
    '외부 파일을 참조하는 모델은 사용 불가 · 텍스처와 버퍼를 포함한 .glb로 내보내야 함',

  // User imagery
  imageryNotFound: '영상 없음',
  imageryBusy: '영상 파일 사용 중 · 잠시 후 다시 시도 필요',
  imageryTooLarge: '영상 파일은 {max_mb} MB 이하만 업로드 가능',
  imageryTooMany: '영상은 최대 {max}개까지 등록 가능',
  imageryQueueFull: '가져오는 중인 영상이 많음 · 동시에 {max}개까지 대기 가능',
  imageryCatalogAreaTooLarge: '검색 범위는 {max_deg}° 이하여야 함 · 더 확대한 뒤 검색',
  imageryCatalogUnavailable: '영상 카탈로그에 연결할 수 없음 · 잠시 후 다시 시도',
  imageryCatalogItemUnknown: '카탈로그에서 찾을 수 없는 항목',
  imageryDownloadFailed: '영상 파일을 내려받지 못함 · 잠시 후 다시 시도',
  imageryDownloadNotAllowed: '허용되지 않은 주소의 영상은 가져올 수 없음',
  imagerySidecarInvalid: 'inbox의 .json 설명 파일 확인 필요 · corners_deg는 경도·위도 8개 값',
  imageryMbtilesInvalid: 'MBTiles 파일을 읽을 수 없음 · tiles 테이블 확인 필요',
  imageryMbtilesNotRaster: '래스터 타일(PNG·JPEG·WebP)이 든 MBTiles만 사용 가능',
  imageryImageUnreadable: 'PNG 또는 JPEG 이미지를 읽을 수 없음',
  imageryCornersInvalid:
    '네 모서리 좌표 확인 필요 · 좌상, 우상, 우하, 좌하 순서의 경도·위도 8개 값',
  imageryTooManyPixels: '영상은 {max_mp} 메가픽셀 이하만 변환 가능',
  imageryGeotiffUnreadable: 'GeoTIFF를 읽을 수 없음 · 밴드·자료형 확인 필요',
  imageryNotGeoreferenced: '좌표 정보가 없는 TIFF · 좌표계와 변환이 들어 있는 GeoTIFF 필요',
  imageryProductInvalid:
    '영상 제품을 읽을 수 없음 · {detail} 확인 필요 · METADATA.DIM과 영상 파일이 든 장면 하나짜리 zip이나 폴더 필요',
  imagerySampleLocked: '샘플 영상은 수정·삭제 불가',
  imageryWarpUnavailable: '영상 변환 라이브러리(rasterio)를 불러올 수 없음 · MBTiles 업로드는 가능',
  imageryImportFailed: '영상 변환 실패 · 서버 로그 확인 필요',
}
