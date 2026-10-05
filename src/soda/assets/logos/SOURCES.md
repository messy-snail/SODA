# 번들 로고 출처

`src/soda/assets/logos/<slug>.png`는 저장소에 함께 배포되는 기관 로고다. 사용자가 같은
이름으로 로고를 올리면(`data/logos/<slug>.png`) 그 파일이 번들 로고를 가리고, 지우면
다시 번들 로고가 보인다.

슬러그와 매칭 규칙은 `frontend/src/utils/operators.ts`의 `OPERATOR_RULES`에 있다.
여기에 파일을 추가할 때는 아래 표에 출처와 사용 근거를 함께 적는다.

## 규칙

- **PNG만** 넣는다. 2048 px·2 MB 이하여야 하고, 정사각형에 가까울수록 구·큐브 표면에
  잘 붙는다(업로드 경로는 512 px로 정규화한다).
- 파일 이름은 소문자 슬러그다. 대문자를 쓰면 대소문자를 구분하지 않는 파일시스템에서
  충돌한다.
- 로고는 각 기관의 상표다. 식별 목적으로만 쓰고, 기관이 SODA를 보증하는 것처럼
  보이게 쓰지 않는다.
- **번들 로고는 이 저장소의 MIT 라이선스 대상이 아니다.** 각 기관의 소유이고, 권리자가
  요청하면 삭제한다. 같은 폴더의 `LICENSE`가 그 조건을 적은 파일이다.
- 기관이 직접 공개한 공식 자산만 넣는다. 제3자가 올린 사본이나 접근 제한을 우회해 받은
  파일은 넣지 않는다.
- 여기에 없는 기관은 사용자가 직접 `data/logos`에 올린다.

## 목록

받은 날짜는 따로 적은 것을 빼면 모두 **2026-09-18**이다. 원본이 SVG·JPEG여도 긴 변
512 px PNG(8-bit)로 변환해 저장했다. 일부는 워드마크에서 심볼마크만 잘라냈다.
아래 [심볼마크 크롭](#심볼마크-크롭)을 본다.

### Wikimedia Commons

라이선스 열은 Commons 파일 페이지의 표기다(**2026-10-03** Commons API의
`LicenseShortName`으로 18개 전부 다시 확인). `Public domain`은 대부분 `{{PD-textlogo}}`다. **저작권이 없다는 뜻이지 상표권이 없다는
뜻이 아니다.**

| 슬러그 | 기관 | 출처 파일 | 라이선스 |
| --- | --- | --- | --- |
| `galileo` | Galileo (EUSPA/ESA) | [File:Galileo logo.svg](https://commons.wikimedia.org/wiki/File:Galileo_logo.svg) | Public domain |
| `gps` | GPS (US Space Force) | [File:NAVSTAR GPS logo.png](https://commons.wikimedia.org/wiki/File:NAVSTAR_GPS_logo.png) | Public domain |
| `cosmos` | Roscosmos | [File:2022-roscosmos-logo-main-eng.png](https://commons.wikimedia.org/wiki/File:2022-roscosmos-logo-main-eng.png) | Public domain |
| `isro` | ISRO | [File:Indian Space Research Organisation Logo.svg](https://commons.wikimedia.org/wiki/File:Indian_Space_Research_Organisation_Logo.svg) | Public domain |
| `si` | 쎄트렉아이 (Satrec Initiative) | [File:Satrec Initiative CI Logo.svg](https://commons.wikimedia.org/wiki/File:Satrec_Initiative_CI_Logo.svg) | Public domain |
| `kaist` | KAIST | [File:KAIST logo.svg](https://commons.wikimedia.org/wiki/File:KAIST_logo.svg) | Public domain |
| `snu` | 서울대학교 | [File:서울대학교.svg](https://commons.wikimedia.org/wiki/File:%EC%84%9C%EC%9A%B8%EB%8C%80%ED%95%99%EA%B5%90.svg) | Public domain |
| `starlink` | Starlink (SpaceX) | [File:Starlink Logo 2024 (cropped).svg](https://commons.wikimedia.org/wiki/File:Starlink_Logo_2024_(cropped).svg) | Public domain |
| `oneweb` | OneWeb (Eutelsat) | [File:OneWeb Logo.png](https://commons.wikimedia.org/wiki/File:OneWeb_Logo.png) | Public domain |
| `kuiper` | Amazon Leo | [File:Amazon Leo logo.svg](https://commons.wikimedia.org/wiki/File:Amazon_Leo_logo.svg) | Public domain |
| `spire` | Spire Global | [File:Spire Logo highres.png](https://commons.wikimedia.org/wiki/File:Spire_Logo_highres.png) | Public domain |
| `iceye` | ICEYE | [File:Iceye logo black.png](https://commons.wikimedia.org/wiki/File:Iceye_logo_black.png) | Public domain |
| `ses` | SES S.A. | [File:SES S.A. logo.svg](https://commons.wikimedia.org/wiki/File:SES_S.A._logo.svg) | Public domain |
| `intelsat` | Intelsat | [File:Intelsat logo (pre-2001).svg](https://commons.wikimedia.org/wiki/File:Intelsat_logo_(pre-2001).svg) | Public domain |
| `orbcomm` | ORBCOMM | [File:Orbcomm logo.svg](https://commons.wikimedia.org/wiki/File:Orbcomm_logo.svg) | Public domain |
| `globalstar` | Globalstar | [File:Globalstar logo.svg](https://commons.wikimedia.org/wiki/File:Globalstar_logo.svg) | Public domain |
| `sitro` | Sitronics Group | [File:SITRONICS group eng logo horisontal.png](https://commons.wikimedia.org/wiki/File:SITRONICS_group_eng_logo_horisontal.png) | **CC BY-SA 4.0**, 저작자 Vshcherbatyuk |
| `chosun` | 조선대학교 | [File:Chosun-University-Symbol.jpg](https://commons.wikimedia.org/wiki/File:Chosun-University-Symbol.jpg) | **CC BY-SA 3.0**, 저작자 조선대학교 |

`sitro`와 `chosun`은 **귀속 표기 의무**가 있다. 파일을 지우거나 교체할 때
`THIRD_PARTY_NOTICES.md`의 해당 항목도 같이 고친다.

### 기관 공식 자산

각 기관이 자기 사이트나 브랜드 키트로 공개한 자산이다. 재배포 라이선스는 명시돼 있지
않으므로 식별 목적으로만 쓰고, MIT 대상에서 제외하며, 권리자가 요청하면 삭제한다.

| 슬러그 | 기관 | 출처 | 비고 |
| --- | --- | --- | --- |
| `telepix` | TELEPIX | 공식 브랜드 배포 자산 `telepix-logo-external-use` (Brand Guidelines V1.1.1, 2026-01) | `Logomark/png/bk_logomark_badge@.png`. 가이드라인의 **LIGHT MODE 로고마크 배지**(검정 배지 + 흰 마크)이고 1011 px 정사각. 사용 허락을 받은 것이 아니다. MIT 대상이 아니고 TELEPIX의 소유다 |
| `kari` | 한국항공우주연구원 | [CI 페이지](https://www.kari.re.kr/kor/contents/92) | 공식 CI 배포본의 `심볼마크_기본` (1008×728 JPEG), **받은 날짜 2026-09-24**. 사용 허락을 받은 것이 아니다. MIT 대상이 아니고 KARI의 소유다. 원본을 바꾸지 않는다: 가공은 비율을 유지한 축소(512×369)와 PNG 변환뿐이고, 흰 배경과 여백은 원본 그대로다(2026-10-04 다시 만듦) |
| `kasi` | 한국천문연구원 | [CI 페이지](https://www.kasi.re.kr/kor/pageView/32) | 엠블럼 130 px 원본. HEAD가 403이라 GET으로 받아야 함 |
| `naraspace` | 나라스페이스 | [naraspace.com](https://www.naraspace.com/) | `icon4.png` 512 px |
| `ktsat` | KT SAT | [ktsat.com](https://www.ktsat.com/kor/main.do) | `logo_black.png` 75 px 원본. `logo.png`는 "SAT"가 흰색이라 쓰면 안 됨 |
| `kairospace` | 카이로스페이스 | [kairo.space](https://www.kairo.space/) | 헤더 워드마크. 공식 심볼은 순백이라 흰 배경에서 안 보임 |
| `planet` | Planet Labs | [planet.com](https://www.planet.com/) | `apple-touch-icon.png` 180 px |
| `iridium` | Iridium Communications | [iridium.com](https://www.iridium.com/) | PWA 아이콘. **금색 중간톤이라 흰 배경 대비가 가장 약하다** |
| `eutelsat` | Eutelsat | [eutelsat.com](https://www.eutelsat.com/) | 공식 SVG 심볼 |
| `glonass` | GLONASS (Roscosmos IAC) | [glonass-iac.ru](https://www.glonass-iac.ru/) | 정보분석센터 로고 300 px |
| `beidou` | BeiDou (CNSA) | [beidou.gov.cn](http://www.beidou.gov.cn/) | 공식 홈페이지 로고 |
| `cgstl` | Chang Guang Satellite (长光卫星) | [jl1.cn](https://www.jl1.cn/) | Jilin-1 서비스 아이콘 100 px. 법인 로고는 순백이라 사용 불가 |

### 번들하지 않는 기관

공식 자산을 기관에서 직접 구하지 못해 번들하지 않는다. `OPERATOR_RULES`에 규칙은 있으므로
UI에 빈 슬롯으로 보이고, 사용자가 자기 권한으로 받은 파일을 올리면 그 기관 위성에 붙는다.

| 슬러그 | 기관 | 이유 |
| --- | --- | --- |
| `contec` | 컨텍 | 자사 홈페이지 로고는 순백이라 쓸 수 없고, 다른 사본은 제3자 서비스에만 있다 |
| `gonets` | Gonets (Гонец) | 공식 사이트에 접속할 수 없어 기관에서 직접 받을 수 없다 |
| `geespace` | Geespace (时空道宇) | 공식 사이트가 일반 요청을 막는다 |

### 미수집

다시 찾아 헤매지 않도록 이유를 남긴다.

| 슬러그 | 기관 | 이유 |
| --- | --- | --- |
| `qianfan` | Qianfan (SSST) | 로고가 공개돼 있지 않다. 공식 사이트 접근 불가 |
| `yaogan` | Yaogan | 기관이 아니라 중국 정부 위성 시리즈 명칭이라 로고가 없다 |
| `guowang` | Guowang (China SatNet) | Commons에 없고 공식 사이트도 접근 불가. zh-wiki 사본은 fair-use라 번들 불가 |

이 슬러그들은 `OPERATOR_RULES`에 규칙이 남아 있으므로 UI에 빈 슬롯으로 보인다.
로고가 없는 동안 해당 위성은 `default` 로고를 쓴다.

### 심볼마크 크롭

아래 파일은 원본 워드마크에서 **심볼마크 부분만 잘라냈다**. 출처와 라이선스는 위 표
그대로이고 바뀐 것은 잘린 범위뿐이다. `sitro`(CC BY-SA 4.0)와 `chosun`(CC BY-SA 3.0)은
귀속 표기 의무가 있어 손대지 않았으므로 `THIRD_PARTY_NOTICES.md`의 귀속 항목은 그대로다.

| 슬러그 | 크롭 전 | 크롭 후 | 남긴 부분 |
| --- | --- | --- | --- |
| `beidou` | 420×108 (3.89) | 469×512 (0.92) | 좌측 원형 엠블럼 |
| `oneweb` | 500×152 (3.29) | 508×512 (0.99) | 좌측 원형 심볼 |
| `spire` | 500×164 (3.05) | 512×486 (1.05) | 좌측 삼각 마크 |
| `ses` | 500×189 (2.65) | 498×512 (0.97) | 우측 삼각 + 호 |
| `intelsat` | 500×247 (2.02) | 512×473 (1.08) | 상단 정사각 마크 |

`kari`는 크롭하지 않는다. 공식 CI 심볼마크 원본을 그대로 쓴다(1.39).

### 형태 참고

로고는 512 px 정사각 텍스처 안에 종횡비를 유지한 채 들어간다. `contain` 레터박스라
**긴 변이 배율을 정하므로**, 가로로 긴 워드마크는 큐브 면에서 얇은 띠가 된다. 기본
마커는 48 px이고(`utils/markerStyle.ts`), 구는 로고 대각선이 지름의 0.8이라 텍스처
정사각 변이 화면에서 지름의 0.566배로 한 번 더 줄어든다. 5:1 워드마크는 기본 크기에서
세로 5~7 px까지 내려간다.

투명 여백만 트림하는 것은 도움이 안 된다. 긴 변이 그대로면 배율이 그대로다. 실제로
효과가 있는 방법은 **원본을 정사각에 가깝게 만드는 것**뿐이다.

아직 2:1 이상인 것:
`kairospace`(5.02) · `kuiper`(4.39) · `globalstar`(4.13) ·
`ktsat`(2.50) · `iceye`(2.50) · `orbcomm`(2.00).

이들은 파일 안에 분리할 수 있는 심볼이 없어서 자르면 식별이 불가능해진다. `kairospace`는
행성 글리프가 글자 사이에 겹쳐 있고, `globalstar`는 별만 남으면 무엇인지 알 수 없으며,
`iceye`·`kuiper`·`orbcomm`은 순수 워드마크다. 더 나은 심볼 자산을 구하면 교체한다.

저해상도라 확대하면 흐릿한 것: `ktsat`(75 px) · `cgstl`(100 px) · `kasi`(130 px) ·
`planet`·`iridium`(180 px). `ktsat`은 75×30이라
가로로 길면서 해상도도 가장 낮아 제일 먼저 교체할 대상이다.
