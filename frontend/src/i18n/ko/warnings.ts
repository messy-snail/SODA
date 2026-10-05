export default {
  elementsFarFromEpoch:
    '궤도요소 epoch에서 최대 {days}일 떨어진 구간 · 궤도 오차가 수 km 이상일 수 있음',
  sgp4Failures: 'SGP4가 {count}개 샘플 계산 실패 (재진입·감쇠 가능)',
  hpopFailures: 'HPOP가 {count}개 샘플 계산 실패 (재진입 가능)',
  hpopAssumedSpacecraft: '위성 질량·면적을 몰라 추정값으로 항력·복사압 계산',
  ephemerisOutsideSpan: '{count}개 샘플이 ephemeris 파일 구간 밖',
  historyNeedsSpaceTrack:
    '시작 시각이 최신 궤도요소 epoch보다 3일 이상 과거 · Space-Track 계정을 설정하면 해당 시점의 궤도요소 사용',
  historyNotFound: 'Space-Track에서 해당 시점 궤도요소를 찾지 못해 최신 요소 사용',
  eclipseUnavailable: '태양 위치 천체력(de421.bsp)이 없어 식(eclipse) 구간 계산 생략',
  powerCoarseStep: '전파 간격이 {max_s}초보다 커서 촬영·교신 중 발전량이 부정확',
}
