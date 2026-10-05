/**
 * Label settings that keep small globe text sharp.
 *
 * Cesium rasterises each label at its font size and draws the outline around that bitmap,
 * so a 12 px Hangul label with a 3 px halo smears. Drawing at twice the size and showing it
 * at half scale gives the glyphs twice the pixels; the outline doubles to look the same.
 */
export const LABEL_SUPERSAMPLE = 2

export function crispLabel(sizePx: number, weight = 600, outlinePx = 3) {
  return {
    font: `${weight} ${sizePx * LABEL_SUPERSAMPLE}px "Pretendard Variable", sans-serif`,
    scale: 1 / LABEL_SUPERSAMPLE,
    outlineWidth: outlinePx * LABEL_SUPERSAMPLE,
  }
}
