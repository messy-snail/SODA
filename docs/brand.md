# 브랜드 에셋

SODA 로고 키트는 `frontend/public/brand/`에 있다. 자체 제작물이라 `THIRD_PARTY_NOTICES.md`에 올리지 않는다.
글자와 태그라인은 아웃라인 패스여서 런타임 폰트, 외부 이미지, 스크립트에 의존하지 않는다.

## 파일과 쓰이는 자리

| 파일 | 쓰이는 곳 | 권장 최소 크기 |
| --- | --- | --- |
| `primary-{light,dark}.svg` | `frontend/index.html`의 부팅 스플래시 | 폭 360px |
| `wordmark-{light,dark}.svg` | `components/SodaAppBar.vue`의 앱바 (높이 48px) | 폭 180px |
| `favicon-{light,dark}.svg` | 브라우저 탭 파비콘, `globe/basemaps.ts`의 지구본 크레딧 마크(16px) | 16~48px |
| `favicon-32.png` | SVG 파비콘을 못 읽는 브라우저용 폴백 | – |
| `apple-touch-icon.png` | iOS 홈 화면 아이콘(180px, 불투명 흰 배경) | – |
| `globe-icon.svg` | **현재 미사용.** `apple-touch-icon.png` 재생성 소스 | 48px 이상 |
| `straw-a-{light,dark}.svg` | **현재 미사용.** 빨대 A 단독 마크 | 높이 40px |

`light`는 밝은 배경용(잉크 `#08244B`), `dark`는 어두운 배경용(잉크 `#F1F7FF`)이다.
`globe-icon.svg`는 양쪽 배경에서 모두 쓸 수 있다. 모든 SVG는 투명 배경이다.

## 지켜야 할 것

- **테마**: 앱 테마는 SODA Dark 하나라 화면에는 `-dark` 변형을 쓴다. 부팅 스플래시는 `primary-dark.svg`만
  둔다. Vue가 그리는 자리는 여전히 `theme.preset.dark`로 `:src`를 계산하므로 라이트 변형도 키트에 남겨 둔다.
  파비콘은 브라우저 탭 색을 따르므로 `prefers-color-scheme`으로 라이트·다크를 고른다.
- **SVG를 인라인하지 않는다.** 모든 SVG가 `id="ocean"` 그라디언트를 공유해서, 한 문서에 둘 이상 인라인하면
  정의가 충돌한다. `<img>`나 `background-image`로만 쓴다.
- **`<img>`에 SVG 고유 크기를 `width`/`height` 속성으로 적는다.** 종횡비만 예약하고 실제 크기는 CSS가 정한다.

## 파생 PNG 재생성

`rsvg-convert`가 없으면 ImageMagick이 SVG를 내부 MSVG 렌더러로 폴백하면서 `radialGradient`(바다 그라디언트)를
깨뜨린다. **SVG를 직접 래스터화하지 말고** 원본 키트의 PNG 프리뷰를 입력으로 쓴다.

```bash
magick <키트>/previews/globe-icon.png -resize 148x148 \
  -background white -gravity center -extent 180x180 -alpha remove -alpha off -strip \
  frontend/public/brand/apple-touch-icon.png
magick identify -format "%wx%h alpha=%A\n" frontend/public/brand/apple-touch-icon.png
# → 180x180 alpha=Undefined
```

iOS는 투명 영역을 검게 깔기도 하므로 `apple-touch-icon.png`은 불투명이어야 한다.

`README.md` 헤더가 쓰는 `docs/images/soda-primary-{light,dark}.png`는 키트의 `previews/primary-*.png`를
그대로 복사한 것이다. GitHub은 camo 프록시를 거치면서 SVG 렌더를 보장하지 않으므로 여기서는 투명 PNG를 쓰고
`<picture>` + `prefers-color-scheme`로 스왑한다.
