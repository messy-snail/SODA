export default {
  name: '이름',
  latitude: '위도 (°)',
  longitude: '경도 (°)',
  altitude: '고도 (m)',
  minElevation: '최소 고도각 (°)',
  maskSection: '방위각 마스크 (선택)',
  maskHint:
    '지형에 가린 방향을 방위각과 최소 고도각 쌍으로 입력 · 사이 값은 선형 보간하고 360°에서 이어짐 · 비우면 모든 방향에 위 최소 고도각 사용',
  azimuth: '방위각 (°)',
  removeMaskPoint: '마스크 점 삭제',
  addMaskPoint: '마스크 점 추가',
  create: '지상국 저장',
  update: '지상국 수정',
  search: '지상국 검색 (이름 · 기관 · 국가)',
  catalogHint:
    '좌표는 공개 문서에서 가져왔고 출처는 {path}에 있음 · 최소 고도각은 기관 공표값이 아닌 망별 관례이므로, 추가한 뒤 지상국마다 수정 필요',
  presetSummary: '{lat}°, {lon}° · 최소 고도각 {elevation}°',
}
