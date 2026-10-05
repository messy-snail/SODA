# Ground station coordinate sources

Every preset in `catalog/` is listed here with the page its coordinate came from.
`presets.test.ts` fails if an id is missing from the table, so the two stay together.

## What these numbers are, and are not

- Coordinates are **site references**, not surveyed antenna phase centres. No civil
  operator publishes per-antenna geodetic coordinates for its whole network, so a site
  reference is the most precise figure that can be cited. Entries whose coordinate covers
  a wider facility than one antenna carry a `note` saying so.
- `alt_m` is 0 where no elevation is published. At a few hundred metres the effect on an
  AOS time is under a second, so 0 is honest rather than a guessed figure.
- **`min_elev_deg` is a convention, not a published figure.** Operators rarely publish a
  minimum elevation per antenna, and none publish an azimuth mask. The values here are the
  usual figure for that kind of network - 10 deg for deep space complexes, 5 deg for LEO and
  polar sites - and are meant to be edited in the app for real work.
- Most coordinates come from Wikidata property P625, which is machine-readable and cites
  its own sources on each entity page. A few come from the English Wikipedia article where
  Wikidata has no coordinate.
- A station whose coordinate could not be traced to a citable page was left out rather
  than guessed. That is why some networks that clearly have more sites - KSAT, SSC, and the
  commercial networks in particular - are represented only in part.

## Stations (43)

| id                       | Name                                                         | Network | Country | Lat       | Lon       | Source                                                  | Retrieved  |
| ------------------------ | ------------------------------------------------------------ | ------- | ------- | --------- | --------- | ------------------------------------------------------- | ---------- |
| `cnes-aussaguel`         | Issus-Aussaguel (이쉬스오사게 (툴루즈))                      | CNES    | FR      | 43.4289   | 1.4978    | <https://www.wikidata.org/wiki/Q3155726>                | 2026-09-19 |
| `cnes-galliot`           | Galliot (Kourou) (갈리오 (쿠루))                             | CNES    | GF      | 5.0986    | -52.6397  | <https://www.wikidata.org/wiki/Q35993927>               | 2026-09-19 |
| `cnsa-espacio-lejano`    | Espacio Lejano (에스파시오 레하노)                           | CNSA    | AR      | -38.1914  | -70.1495  | <https://www.wikidata.org/wiki/Q20014921>               | 2026-09-19 |
| `cnsa-jiamusi`           | Jiamusi Deep Space Station (자무쓰 심우주국)                 | CNSA    | CN      | 46.4936   | 130.7711  | <https://www.wikidata.org/wiki/Q141442726>              | 2026-09-19 |
| `conae-cordoba`          | Córdoba (코르도바)                                           | CONAE   | AR      | -31.5238  | -64.464   | <https://www.wikidata.org/wiki/Q5845110>                | 2026-09-19 |
| `conae-tierra-del-fuego` | Tierra del Fuego (티에라델푸에고)                            | CONAE   | AR      | -54.5103  | -67.115   | <https://www.wikidata.org/wiki/Q42373251>               | 2026-09-19 |
| `dsn-canberra`           | Canberra (DSN) (캔버라 (DSN))                                | DSN     | AU      | -35.40139 | 148.98167 | <https://www.wikidata.org/wiki/Q1032865>                | 2026-09-19 |
| `dsn-goldstone`          | Goldstone (DSN) (골드스톤 (DSN))                             | DSN     | US      | 35.42667  | -116.89   | <https://www.wikidata.org/wiki/Q618630>                 | 2026-09-25 |
| `dsn-madrid`             | Madrid (DSN) (마드리드 (DSN))                                | DSN     | ES      | 40.43139  | -4.24806  | <https://www.wikidata.org/wiki/Q618721>                 | 2026-09-19 |
| `estrack-cebreros`       | Cebreros (세브레로스)                                        | ESTRACK | ES      | 40.4528   | -4.3676   | <https://www.wikidata.org/wiki/Q2889659>                | 2026-09-19 |
| `estrack-kiruna`         | Kiruna (키루나)                                              | ESTRACK | SE      | 67.8572   | 20.9644   | <https://www.wikidata.org/wiki/Q4349991>                | 2026-09-19 |
| `estrack-kourou`         | Kourou (쿠루)                                                | ESTRACK | GF      | 5.2514    | -52.8047  | <https://www.wikidata.org/wiki/Q18126941>               | 2026-09-19 |
| `estrack-malargue`       | Malargüe (말라르궤)                                          | ESTRACK | AR      | -35.776   | -69.3982  | <https://www.wikidata.org/wiki/Q6741341>                | 2026-09-19 |
| `estrack-new-norcia`     | New Norcia (뉴노르시아)                                      | ESTRACK | AU      | -31.0482  | 116.191   | <https://www.wikidata.org/wiki/Q4302461>                | 2026-09-19 |
| `estrack-perth`          | Perth (퍼스)                                                 | ESTRACK | AU      | -31.8025  | 115.885   | <https://www.wikidata.org/wiki/Q4303156>                | 2026-09-19 |
| `estrack-redu`           | Redu (레뒤)                                                  | ESTRACK | BE      | 50.0019   | 5.1467    | <https://www.wikidata.org/wiki/Q3497409>                | 2026-09-19 |
| `estrack-santa-maria`    | Santa Maria (산타마리아)                                     | ESTRACK | PT      | 36.9972   | -25.1357  | <https://www.wikidata.org/wiki/Q18354889>               | 2026-09-19 |
| `estrack-villafranca`    | Villafranca (비야프랑카)                                     | ESTRACK | ES      | 40.4426   | -3.9516   | <https://www.wikidata.org/wiki/Q18167242>               | 2026-09-19 |
| `inta-maspalomas`        | Maspalomas (마스팔로마스)                                    | INTA    | ES      | 27.7634   | -15.6335  | <https://www.wikidata.org/wiki/Q4302441>                | 2026-09-19 |
| `isro-byalalu`           | Indian Deep Space Network (인도 심우주망 (뱌랄루))           | ISRO    | IN      | 12.9016   | 77.3686   | <https://www.wikidata.org/wiki/Q6020227>                | 2026-09-19 |
| `isro-hassan`            | Master Control Facility Hassan (하산 주관제소)               | ISRO    | IN      | 13.0717   | 76.0994   | <https://www.wikidata.org/wiki/Q3520782>                | 2026-09-19 |
| `isro-istrac`            | ISTRAC Bengaluru (ISTRAC 벵갈루루)                           | ISRO    | IN      | 13.036    | 77.5111   | <https://www.wikidata.org/wiki/Q6021612>                | 2026-09-19 |
| `isro-lucknow`           | Lucknow (럭나우)                                             | ISRO    | IN      | 26.9123   | 80.9561   | <https://www.wikidata.org/wiki/Q127294667>              | 2026-09-19 |
| `jaxa-hatoyama`          | Earth Observation Center (지구관측센터 (하토야마))           | JAXA    | JP      | 36.0031   | 139.3492  | <https://www.wikidata.org/wiki/Q5327099>                | 2026-09-19 |
| `jaxa-masuda`            | Masuda (마스다)                                              | JAXA    | JP      | 30.5559   | 131.0161  | <https://www.wikidata.org/wiki/Q11429311>               | 2026-09-19 |
| `jaxa-ogasawara`         | Ogasawara (오가사와라)                                       | JAXA    | JP      | 27.0791   | 142.2158  | <https://www.wikidata.org/wiki/Q11463405>               | 2026-09-19 |
| `jaxa-okinawa`           | Okinawa (오키나와)                                           | JAXA    | JP      | 26.5005   | 127.9035  | <https://www.wikidata.org/wiki/Q11552678>               | 2026-09-19 |
| `jaxa-usuda`             | Usuda Deep Space Center (우스다 심우주국)                    | JAXA    | JP      | 36.1331   | 138.362   | <https://www.wikidata.org/wiki/Q7902244>                | 2026-09-19 |
| `kari-daejeon`           | KARI Headquarters (Daejeon) (한국항공우주연구원 본원 (대전)) | KARI    | KR      | 36.3694   | 127.364   | <https://www.wikidata.org/wiki/Q494948>                 | 2026-09-19 |
| `kari-jangbogo`          | Jang Bogo Station (장보고 과학기지)                          | KOPRI   | AQ      | -74.6167  | 164.2     | <https://www.wikidata.org/wiki/Q245875>                 | 2026-09-19 |
| `kari-naro`              | Naro Space Center (나로우주센터)                             | KARI    | KR      | 34.4319   | 127.5351  | <https://www.wikidata.org/wiki/Q495281>                 | 2026-09-19 |
| `kari-sejong`            | King Sejong Station (세종 과학기지)                          | KOPRI   | AQ      | -62.2232  | -58.7865  | <https://www.wikidata.org/wiki/Q246364>                 | 2026-09-19 |
| `ksat-inuvik`            | Inuvik (이누빅)                                              | KSAT    | CA      | 68.3175   | -133.5339 | <https://www.wikidata.org/wiki/Q1671644>                | 2026-09-19 |
| `ksat-nyalesund`         | Ny-Ålesund (Kongsfjord) (니올레순 (콩스피오르))              | KSAT    | NO      | 78.93     | 11.855    | <https://www.wikidata.org/wiki/Q6429241>                | 2026-09-19 |
| `ksat-svalbard`          | Svalbard (SvalSat) (스발바르 (SvalSat))                      | KSAT    | NO      | 78.2298   | 15.4078   | <https://www.wikidata.org/wiki/Q1796135>                | 2026-09-19 |
| `ksat-troll`             | Troll (TrollSat) (트롤 (TrollSat))                           | KSAT    | AQ      | -72.0167  | 2.5333    | <https://www.wikidata.org/wiki/Q7845173>                | 2026-09-19 |
| `ksat-tromso`            | Tromsø (트롬쇠)                                              | KSAT    | NO      | 69.6618   | 18.9417   | <https://www.wikidata.org/wiki/Q7845399>                | 2026-09-19 |
| `nsn-mcmurdo`            | McMurdo (맥머도)                                             | NSN     | AQ      | -77.84632 | 166.66824 | <https://en.wikipedia.org/wiki/McMurdo_Station>         | 2026-09-19 |
| `nsn-wallops`            | Wallops (월롭스)                                             | NSN     | US      | 37.93333  | -75.46778 | <https://en.wikipedia.org/wiki/Wallops_Flight_Facility> | 2026-09-19 |
| `nsn-white-sands`        | White Sands (화이트샌즈)                                     | NSN     | US      | 32.507    | -106.611  | <https://www.wikidata.org/wiki/Q618540>                 | 2026-09-19 |
| `sansa-hartebeesthoek`   | Hartebeesthoek (하르테비스훅)                                | SANSA   | ZA      | -25.8875  | 27.7084   | <https://www.wikidata.org/wiki/Q114684888>              | 2026-09-19 |
| `sonz-awarua`            | Awarua (아와루아)                                            | SONZ    | NZ      | -46.5129  | 168.376   | <https://www.wikidata.org/wiki/Q4829919>                | 2026-09-19 |
| `ssc-esrange`            | Esrange (에스레인지)                                         | SSC     | SE      | 67.8917   | 21.0814   | <https://www.wikidata.org/wiki/Q1368518>                | 2026-09-19 |

## Licensing

Geographic coordinates are facts and carry no copyright. Wikidata content is released
under CC0. The source column is kept for traceability, not because attribution is required.
