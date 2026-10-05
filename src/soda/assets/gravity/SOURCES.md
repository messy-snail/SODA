# 번들 중력장 계수 출처

`egm96_20x20.txt`는 HPOP 전파기(`src/soda/orbit/hpop/gravity.py`)가 읽는 지구 중력장
계수다. 저장소에 함께 배포하고, 실행 중에는 내려받지 않는다.

| 파일 | 내용 | 출처 | 라이선스 근거 | 받은 날짜 |
| --- | --- | --- | --- | --- |
| `egm96_20x20.txt` | EGM96 완전 정규화 계수 `C̄nm`·`S̄nm`, 2~20차 228행(tide-free). `GM = 3.986004415e14 m³/s²`, `R = 6378136.3 m` | [ICGEM `EGM96.gfc`](https://icgem.gfz-potsdam.de/getmodel/gfc/971b0a3b49a497910aad23cd85e066d4cd9af0aeafe7ce6301a696bed8570be3/EGM96.gfc) (모델 목록: <https://icgem.gfz-potsdam.de/tom_longtime>) | NASA GSFC와 NIMA가 만든 미국 정부 저작물로 퍼블릭 도메인이다. 인용: Lemoine et al., *The Development of the Joint NASA GSFC and NIMA Geopotential Model EGM96*, NASA/TP-1998-206861 | 2026-10-01 |

## 다시 만드는 방법

원본 `EGM96.gfc`에서 `gfc`로 시작하는 행 중 차수가 2~20인 행만 골라 `n m C S` 네 열로
적는다. 값은 원본 문자열 그대로 옮기고 반올림하지 않는다. 차수를 늘리면
`hpop/constants.py`의 `MAX_GRAVITY_DEGREE`와 프런트 `orbit/propagatorOptions.ts`도 함께 고친다.

`tests/test_hpop_forces.py`가 `C̄20`, `C̄22`, `S̄22`, `C̄30` 값과 행 수를 확인한다.
