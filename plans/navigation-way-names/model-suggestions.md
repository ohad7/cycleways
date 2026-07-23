# Digest-Bound Navigation-Way Model Suggestions

**Date:** 2026-07-23  
**Status:** Review proposal only; not canonical data  
**Related design:** `plans/navigation-way-names/design.md`

## Binding and scope

This document is a model review of the current CycleWays network. It becomes
stale if any bound input changes.

The evidence-set digest is:

```text
sha256:d08188d8250a8a81a42ef266b9df64c9f9345c1d3ac481851f67596f939d1b27
```

It is the SHA-256 of the following ordered `path + NUL + sha256 + LF`
records:

| Evidence | SHA-256 |
| --- | --- |
| `data/map-source.geojson` | `d1cc9811ab68fd128955c197f1bed3497d28e7da77588376dbc40bdcd3378d04` |
| `data/navigation-ways.json` | `2129372c9b9d4790d0e649f44e7fed0fe4bf52f70d4713751415630191b0d20a` |
| `data/cw-base-overlay.json` | `2db09ffef7b4ec38e8f1cec41092f664a61ee0defaf9f41170b0c41367285dd2` |
| `data/network-junctions.json` | `e23ca87d82adc2c32ea6b3f75e505a55bd86dd18649299f4be60e81b81ed3e28` |
| `build/public-data/cw-base-index.json` | `8bd30442bb74fac71856262b98e3d20ed83bdccd1b6a3fad9ced7a1bccf78357` |
| `build/public-data/network-junctions.json` | `ce5d4ed328f923a070a532a06c643d1a60aa955f3b9902b7f556bb6a03a17dd8` |
| `build/public-data/base-routing-shards/manifest.json` | `f95117b13702e6f9fde2b5939b27d7969445b8fc8b0d0fbc82808123c8a771ac` |

Routing evidence:

- graph/routing-context digest:
  `5c3103e5484482574ae44243a5a2327504e430fc75bda23c3de2be04a5a3674b`;
- policy: `il-bicycle-v1`;
- policy digest:
  `9a8bbb7bdf928deb390f9446260665ac01ac56f208305e3ee2e664aa30bd0a2c`;
- active line segments reviewed: 291;
- existing classified segments preserved: 11;
- unreviewed segments covered below: 280.

Suggestion coverage:

| Proposed role | Segments | Group-level proposals |
| --- | ---: | ---: |
| Named way | 219 | 115 |
| Standalone named feature | 7 | 7 |
| Intentionally unnamed | 54 | 54 |
| **Total** | **280** | **176** |

## Review method and limits

The review used stable IDs, internal names, road type, source geometry,
accepted direction-scoped alignment endpoints, endpoint proximity, published
junction attachments, and existing classifications. Endpoint proximity was
used only as suggestion evidence; it is not a substitute for the design's
topology validator.

Confidence means:

- **H** — the internal names and current connected evidence strongly support
  the proposal; suitable for first-pass batch review;
- **M** — likely rider-recognizable, but the exact member boundary or facility
  semantics need map review;
- **L** — plausible interpretation only; review individually and prefer
  `unnamed` if the term is merely an internal location description.

Provisional IDs are not canonical. Separate IDs with the same display name are
intentional where the current network does not prove one connected member
component. `spokenName` values are pronunciation proposals, not linguistic
authority; test them on iOS and keep `null` when they do not help.

## Existing classifications retained

| Existing identity | Active member IDs |
| --- | --- |
| `standalone:10` — גן הצפון | 10 |
| `road-9974` — כביש 9974 | 62, 175 |
| `cycleway-99` — שביל אופניים 99 | 97, 326 |
| `kfar-yuval-fields` — שדות כפר יובל | 121 |
| `road-90` — כביש 90 | 159 |
| `tel-hai-trail` — שביל תל חי | 164 |
| `road-99` — כביש 99 | 174 |
| `agal-road` — כבישון עגל | 176 |
| `yuvalim-cycleway` — שביל אופניים יובלים | 352 |

## Named-way proposals

### Numbered and security roads

| Provisional way ID | Proposed member IDs | Display `name` | Proposed `spokenName` | Kind | C | Review note |
| --- | --- | --- | --- | --- | :---: | --- |
| `road-886` | 47 | כביש 886 | כביש שמונה מאות שמונים ושש | road | H | One explicit numbered-road segment. |
| `road-90-agmon` | 48 | כביש 90 | כביש תשעים | road | M | Separate mapped component; do not include dirt segment 49. |
| `road-90` | 172, 173 | כביש 90 | כביש תשעים | road | H | Extend existing member 159; current endpoints form its northern component. |
| `road-959-gonen` | 53 | כביש 959 | כביש תשע מאות חמישים ותשע | road | M | Same display as the next component; continuity is not proved. |
| `road-959-kela-alon` | 54 | כביש 959 | כביש תשע מאות חמישים ותשע | road | M | Keep separate unless topology validation connects it to 53. |
| `road-9888` | 55, 56, 304, 305 | כביש 9888 | כביש תשעת אלפים שמונה מאות שמונים ושמונה | road | H | Explicit connected numbered-road chain. |
| `road-99-upper` | 58, 60, 61, 210, 211, 212, 213, 214, 311, 312, 331 | כביש 99 | כביש תשעים ותשע | road | H | Connected upper component; keep distinct from existing member 174 and isolated 317. |
| `road-99-east` | 317 | כביש 99 | כביש תשעים ותשע | road | M | Isolated current component east of the main mapped chain. |
| `road-9977` | 63, 64 | כביש 9977 | כביש תשעת אלפים תשע מאות שבעים ושבע | road | H | Explicit connected pair. |
| `road-9115` | 133, 134 | כביש 9115 | כביש תשעת אלפים מאה וחמש עשרה | road | H | Explicit connected pair. |
| `road-8966` | 189 | כביש 8966 | כביש שמונת אלפים תשע מאות שישים ושש | road | H | One explicit numbered-road segment. |
| `road-9118` | 190, 191, 192 | כביש 9118 | כביש תשעת אלפים מאה ושמונה עשרה | road | H | Explicit connected chain. |
| `road-918-north` | 195, 217, 229, 230, 267, 268, 338 | כביש 918 | כביש תשע מאות ושמונה עשרה | road | H | Connected northern component. |
| `road-918-dardara` | 284 | כביש 918 | כביש תשע מאות ושמונה עשרה | road | M | Separate current component. |
| `road-918-jordan` | 289, 292, 293 | כביש 918 | כביש תשע מאות ושמונה עשרה | road | H | Connected Jordan component. |
| `road-9970` | 204 | כביש 9970 | כביש תשעת אלפים תשע מאות שבעים | road | H | Explicit numbered-road segment at the published Rajar junction. |
| `road-998` | 294 | כביש 998 | כביש תשע מאות תשעים ושמונה | road | M | Source calls this a connection; verify it is the numbered road itself. |
| `road-9895` | 321, 322 | כביש 9895 | כביש תשעת אלפים שמונה מאות תשעים וחמש | road | H | Explicit connected pair. |
| `road-899` | 371 | כביש 899 | כביש שמונה מאות תשעים ותשע | road | H | One explicit numbered-road segment. |
| `hermon-border-security-road` | 202, 203 | דרך הביטחון בגבול הר דב | — | road | M | Two sides of the same security-road context; verify junction continuity. |

### Cycleways and marked trails

| Provisional way ID | Proposed member IDs | Display `name` | Proposed `spokenName` | Kind | C | Review note |
| --- | --- | --- | --- | --- | :---: | --- |
| `cycleway-9779-north` | 89, 296, 297 | שביל אופניים 9779 | שביל אופניים תשעת אלפים שבע מאות שבעים ותשע | cycleway | H | Connected northern component. |
| `cycleway-9779-south` | 90, 92, 93 | שביל אופניים 9779 | שביל אופניים תשעת אלפים שבע מאות שבעים ותשע | cycleway | H | Connected southern component. |
| `cycleway-99` | 94, 96, 280, 281, 327 | שביל אופניים 99 | שביל אופניים תשעים ותשע | cycleway | H | Extend existing 97 and 326; segment 280 is a bridge carrying this facility. |
| `cycleway-99-dafna` | 336 | שביל אופניים 99 | שביל אופניים תשעים ותשע | cycleway | M | Separate mapped component; do not merge by visible name alone. |
| `village-sde-nehemia-cycleway` | 99 | שביל אופניים וילג שדה נחמיה | שביל אופניים וילג׳, שדה נחמיה | cycleway | M | Clean display removes pronunciation punctuation. |
| `hatzbani-cycleway` | 100, 101 | שביל אופניים חצבאני | — | cycleway | H | Repeated explicit facility name. |
| `dafna-cycleway` | 330, 364 | שביל אופניים דפנה | — | cycleway | M | Both attach at the Hurlat Tal junction; inspect overlap before acceptance. |
| `helicopter-memorial-cycleway` | 337 | שביל אופניים אנדרטת אסון המסוקים | — | cycleway | H | One explicit named cycleway. |
| `cycleway-918-dafna` | 339 | שביל אופניים 918 דפנה | שביל אופניים תשע מאות ושמונה עשרה דפנה | cycleway | H | Keep distinct from Road 918. |
| `jordan-street-cycleway` | 368 | שביל אופניים רחוב הירדן | — | cycleway | H | Keep distinct from street segment 369. |
| `israel-trail` | 250, 252, 254, 255 | שביל ישראל | — | trail | H | Explicit connected marked-trail chain. |
| `brown-trail-tel-naama` | 105 | שביל חום תל נעמה | — | trail | M | A color mark is only locally identifying; confirm this name is sufficient. |
| `palri-canal-trail` | 113 | שביל תעלת פלרי | — | trail | H | One explicit named trail. |
| `har-naftali-red-trail` | 187 | שביל אדום הרי נפתלי | — | trail | M | Confirm the red mark is locally unique. |
| `tel-kalil-trail` | 231, 232 | שביל תל קליל | — | trail | H | Explicit north/south pair. |
| `stadium-trail` | 365 | שביל האיצטדיון | — | path | M | Likely rider-recognizable local path. |

### Scenic, river, and natural corridors

| Provisional way ID | Proposed member IDs | Display `name` | Proposed `spokenName` | Kind | C | Review note |
| --- | --- | --- | --- | --- | :---: | --- |
| `agmon-hahula` | 2, 147, 149, 265, 266 | שבילי אגמון החולה | — | promenade | M | Connected facility, but possible loop/branch requires degree validation. |
| `banias-trail` | 4, 5, 6, 7 | שביל הבניאס | — | trail | L | Internal labels may describe several facilities; inspect individually. |
| `patrol-road` | 16, 18, 19, 206, 207, 225, 226 | דרך הפטרולים | דֶּרֶךְ הַפַּטְרוֹלִים | dirt-road | H | All repeated-name sections form the current connected candidate. |
| `hamenafta-road` | 15 | דרך המנפטה | — | dirt-road | H | Explicit proper road name. |
| `naftali-scenic-road` | 21, 22, 167, 274, 275 | דרך נוף הרי נפתלי | — | road | H | Explicit connected chain. |
| `historical-jordan` | 27 | הירדן ההיסטורי | — | trail | H | One explicit rider-facing corridor. |
| `ami-promenade` | 31 | טיילת עמי | — | promenade | H | One explicit promenade. |
| `mountain-jordan` | 33 | הירדן ההררי | — | trail | H | One explicit river corridor. |
| `jordan-east` | 34, 37, 38, 286, 349, 350 | דרך הירדן המזרחית | — | dirt-road | M | Main eastern corridor; segment 286 may need its own occurrence ID. |
| `jordan-east-south` | 35, 290 | דרך הירדן המזרחית | — | dirt-road | M | Separate southern component with the same display name. |
| `jordan-west` | 40, 41, 42, 43, 44, 46, 131, 346, 347 | דרך הירדן המערבית | — | dirt-road | M | Long current component; inspect branches and paved member 44. |
| `jordan-west-south` | 129, 130 | דרך הירדן המערבית | — | road | M | Separate southern road component. |
| `nahal-tal` | 74 | שביל נחל טל | — | path | M | Internal label may be location-only. |
| `nahal-machanayim` | 75, 137 | דרך נחל מחניים | — | dirt-road | H | Explicit connected pair. |
| `nahal-ayun` | 78, 79, 279 | שביל נחל עיון | — | trail | H | Explicit connected corridor. |
| `hatzbani-west-trail` | 110 | דרך החצבאני המערבית | — | dirt-road | M | Likely recognizable corridor; confirm it is more than an internal location label. |
| `nahal-hatzor` | 136, 163 | דרך נחל חצור | — | dirt-road | M | Likely one named corridor; verify the current connection. |
| `nabi-yusha-forest` | 151 | דרך יער נבי ישע | — | dirt-road | L | Internal label may only describe location. |
| `nahal-dishon` | 154, 155 | דרך נחל דישון | — | dirt-road | H | Explicit upper/lower pair. |
| `nahal-zemer` | 156 | דרך נחל זמר | — | dirt-road | M | One explicit geographic corridor. |
| `wadi-yanshuf` | 158 | ואדי ינשוף | וָאדִי יַנְשׁוּף | dirt-road | M | Audible form is provisional. |
| `nahal-ashaf` | 162, 272, 273 | דרך נחל אשף | — | dirt-road | M | Segment 272 is a connector that appears to carry the same corridor. |
| `maale-nahal-bedolah` | 180 | מעלה נחל בדולח | — | trail | H | Explicit climb name. |
| `nahal-rahum` | 205 | דרך נחל רחום | — | dirt-road | M | One explicit geographic corridor. |
| `oil-axis` | 209, 257, 259, 260 | ציר הנפט | צִיר הַנֶּפְט | road | H | Repeated explicit connected corridor. |
| `hidden-lake` | 223 | האגם הנעלם | — | trail | M | Confirm this is a route identity rather than only a destination. |
| `roman-road` | 224 | הדרך הרומית | — | dirt-road | H | Explicit historic-road identity. |
| `ein-sahar-grove` | 233 | דרך עין סהר | — | dirt-road | M | Separate from segment 236 until continuity is reviewed. |
| `nahal-kalil` | 234, 235 | דרך נחל קליל | — | dirt-road | H | Explicit east/west pair. |
| `ein-sahar-west` | 236 | דרך עין סהר | — | dirt-road | M | Same display, separate current component. |
| `nahal-dan` | 249 | שביל נחל דן | — | trail | M | Internal name says a narrow trail along the river. |
| `hirbat-omrit` | 261 | דרך חורבת עומרית | — | dirt-road | M | Confirm the ruin is the route identity, not only its destination. |
| `tel-azaziat` | 262 | דרך תל עזזיאת | — | dirt-road | M | Confirm the tel is the route identity. |
| `nahal-gershom` | 270, 271 | דרך נחל גרשום | — | dirt-road | H | Explicit connected pair. |
| `syrian-patrol-road` | 306 | דרך הפטרולים הסורית | — | dirt-road | H | Distinct proper name; do not merge with `patrol-road`. |
| `ein-el-disa-trail` | 307 | שביל עין אל דיסא | — | trail | H | Explicit named trail. |
| `tel-fakhr` | 308 | דרך תל פאחר | — | dirt-road | M | Confirm the site is the route identity. |
| `ein-fit` | 309 | דרך עין פית | עֵין פִית | dirt-road | M | Audible form is provisional. |
| `banias-springs` | 310 | דרך מעיינות הבניאס | — | path | M | Confirm this is a named traversable feature. |
| `nahal-saar` | 318, 319, 320 | שביל נחל סער | נַחַל סַעַר | trail | H | Explicit connected three-segment corridor. |
| `peleg-hadan` | 340 | דרך פלג הדן | — | dirt-road | M | One explicit geographic corridor. |
| `nahal-machbaram` | 344 | דרך נחל מכברם | — | dirt-road | M | One explicit geographic corridor. |
| `bikat-yahmur` | 354 | דרך בקעת יחמור | — | dirt-road | M | Confirm the valley is the route identity. |
| `ein-tao` | 370 | דרך עין תאו | עֵין תֵּאוֹ | dirt-road | M | Audible form is provisional. |

### Local roads, streets, fields, parks, and climbs

| Provisional way ID | Proposed member IDs | Display `name` | Proposed `spokenName` | Kind | C | Review note |
| --- | --- | --- | --- | --- | :---: | --- |
| `givat-haem` | 9 | דרך גבעת האם | גִּבְעַת הָאֵם | dirt-road | M | Likely recognizable locally; audible form is provisional. |
| `system-road-kiryat-shmona` | 69 | כביש המערכת קריית שמונה | — | dirt-road | M | Confirm this is one public guidance identity. |
| `nabi-yehuda-pipeline` | 72 | דרך נקודת הצינור נבי יהודה | — | road | L | Descriptive internal label; individual review required. |
| `beit-hillel-fields` | 117, 157 | שדות בית הלל | — | dirt-road | M | Mirrors the existing field-area naming pattern; verify continuity. |
| `amir-fields` | 123, 124, 125 | שדות עמיר | — | dirt-road | M | Three local field sections; inspect branching. |
| `founders-street-yesod` | 128 | רחוב המייסדים יסוד המעלה | — | road | H | Explicit street name. |
| `beit-hillel-perimeter` | 139, 301 | דרך גדר המערכת בית הלל | — | road | M | Repeated perimeter context with variant internal spelling. |
| `metula-orchard-pass` | 165, 177 | דרך מטעי מטולה | — | dirt-road | L | Likely descriptive rather than an established proper name. |
| `metula-scenic-road` | 168 | דרך נוף מטולה | — | road | H | Explicit scenic-road name. |
| `mitzpe-adi-road` | 169, 170 | דרך נוף מצפה עדי | — | road | H | Explicit south/north pair. |
| `har-hatzfiya` | 171 | דרך הר הצפייה | — | road | M | Confirm whether this and segment 179 are one facility. |
| `maale-dado` | 178 | מעלה דדו | — | road | H | Explicit climb name. |
| `maale-hatzfiya` | 179 | מעלה הצפייה | — | road | H | Explicit climb name. |
| `har-naftali-single-bypass` | 182 | עוקף סינגל הרי נפתלי | — | trail | L | Could be a descriptive connector rather than a named way. |
| `hachetzav-street` | 184 | רחוב החצב | — | road | H | Explicit street name. |
| `hanasi-street` | 185 | רחוב הנשיא | — | road | H | Explicit street name. |
| `ein-zahav-veradim-street` | 186 | רחוב עין זהב והוורדים | — | road | L | May span two streets; split after map review if needed. |
| `tel-avel-beit-maakha` | 188 | דרך תל אבל בית מעכה | — | dirt-road | M | Confirm the archaeological site is the route identity. |
| `area-100-alma-cave` | 193 | דרך מערת עלמה | — | dirt-road | L | Remove the internal “שטח 100” wording from rider copy. |
| `tel-turmus` | 196 | דרך תל תורמוס | — | dirt-road | M | Confirm the tel is the route identity. |
| `kfar-szold-center` | 221 | דרך מרכז כפר סאלד | — | road | M | Local road; confirm public recognizability. |
| `kfar-szold-perimeter` | 222 | הדרך ההיקפית כפר סאלד | — | road | M | Explicit perimeter-road semantics. |
| `shear-yashuv-perimeter` | 239, 240, 241 | הדרך ההיקפית שאר ישוב | — | road | H | Explicit north/east/west perimeter group. |
| `sovev-dafna` | 243, 246, 247, 335 | סובב דפנה | — | dirt-road | H | Segment 335 appears to continue the named perimeter. |
| `rose-street` | 263, 264 | רחוב הוורדים | — | road | H | Explicit connected street pair. |
| `geological-park-road` | 276, 277 | דרך הפארק הגאולוגי קריית שמונה | — | road | M | One climb plus park section; verify shared identity. |
| `givat-shahumit` | 298, 299 | דרך גבעת שחומית | — | road | M | Segment 299 is an access section carrying the candidate identity. |
| `dolav-street` | 302, 303 | רחוב הדולב | — | road | H | Explicit connected street pair. |
| `founders-trail-dafna` | 334 | שביל המייסדים דפנה | — | path | H | Explicit local trail name. |
| `ahuzat-hayarden` | 342 | דרך אחוזת הירדן | — | dirt-road | L | May name a destination rather than the road. |
| `kfar-szold-fields` | 323, 324 | שביל שדות כפר סאלד | — | dirt-road | M | Explicit repeated field-trail name. |
| `sde-eliezer-system-road` | 356 | כביש המערכת שדה אליעזר | — | dirt-road | M | Confirm public recognizability. |
| `henrietta-szold-street` | 361 | רחוב הנרייטה סאלד | רְחוֹב הֶנְרִיֶיטָה סֹאלְד | road | H | Audible spelling must be verified on iOS. |
| `gold-park` | 367 | פארק הזהב | — | promenade | M | Confirm the segment is a park route, not only park-adjacent. |
| `jordan-street` | 369 | רחוב הירדן | — | road | H | Keep distinct from cycleway segment 368. |

## Standalone named-feature proposals

| Segment ID | Internal name | Display `name` | Proposed `spokenName` | Kind | C | Review note |
| ---: | --- | --- | --- | --- | :---: | --- |
| 12 | גשר חולתה | גשר חולתה | גֶּשֶׁר חוּלָתָה | bridge | H | Named bridge between route corridors. |
| 13 | גשר חיל ההנדסה ירדן | גשר חיל ההנדסה בירדן | גֶּשֶׁר חֵיל הַהַנְדָּסָה, בַּיַּרְדֵּן | bridge | M | Display wording needs curator confirmation. |
| 14 | גשר עינות ירדן | גשר עינות ירדן | גֶּשֶׁר עֵינוֹת יַרְדֵּן | bridge | H | Reference standalone-bridge case from the design. |
| 25 | האי בנחל הבניאס | האי בנחל הבניאס | — | other | M | Recognizable bounded feature; verify that the complete segment is the island passage. |
| 26 | הגשר על הבניאס | גשר הבניאס | גֶּשֶׁר הַבַּנְיָאס | bridge | H | Named bounded bridge feature. |
| 245 | גשר על נהר הדן | גשר נהר הדן | גֶּשֶׁר נְהַר הַדָּן | bridge | H | Named bounded bridge feature. |
| 348 | מעבר הולכי רגל גשר להבות | גשר להבות | גֶּשֶׁר לְהָבוֹת | bridge | M | Confirm whether riders recognize the bridge by this name. |

## Intentionally unnamed proposals

These names appear descriptive, access-oriented, or internal rather than
stable rider-facing proper names. The editor should still show the internal
name during review, but production guidance should use only the proposed kind
fallback.

| Segment ID | Internal name | Kind | C | Reason |
| ---: | --- | --- | :---: | --- |
| 3 | בית עלמין שאר ישוב | connector | H | Access to a destination, not the road's name. |
| 8 | בריכות דגים צומת גומא | connector | M | Endpoint description rather than a proper way. |
| 24 | דרך עפר חצבאני קיאקים כפר בלום | dirt-road | H | Multi-place internal description. |
| 29 | חניון האקליפטוס | connector | M | Parking access; bridge/road name is not established. |
| 49 | כביש 90 שמורת החולה | dirt-road | H | Dirt facility alongside Road 90; unsafe to call it the road. |
| 65 | כביש גישה אגמון החולה | connector | H | Explicit access road. |
| 67 | כביש גישה ציר הנפט | connector | H | Explicit access road. |
| 68 | כביש גישה תל דן | connector | H | Explicit access road. |
| 83 | עוקף שמורת החולה אינדי פארק | dirt-road | H | Descriptive bypass. |
| 102 | שביל גישה דג על הדן | connector | H | Explicit access path. |
| 109 | שביל עפר בניאס שדות שאר ישוב | dirt-road | H | Multi-place internal description. |
| 114 | שדה נחמיה שער כניסה | connector | H | Gate/entry section. |
| 116 | שדות אגמון ושמורת החולה | dirt-road | M | Broad area description; no stable proper way name. |
| 118 | שדות גונן | dirt-road | M | Broad area description. |
| 119 | שדות דישון | dirt-road | M | Broad area description. |
| 120 | שדות הגושרים | path | M | Broad area description on a paved path. |
| 122 | שדות נאות מרדכי מערב | dirt-road | M | Broad area description. |
| 126 | שדות קיבוץ שדה נחמיה | path | M | Broad area description on a paved path. |
| 132 | כביש 90 שדה אליעזר | dirt-road | H | Dirt facility near Road 90, not the roadway. |
| 135 | מטעים יסוד המעלה | path | M | Orchard-area description. |
| 140 | קמפינג דג על הדן | connector | H | Destination access. |
| 144 | קרית שמונה תעשייה דרומי | road | M | Industrial-area internal description. |
| 152 | כביש 90 שמורת נחל עינן מערב | dirt-road | H | Dirt facility near Road 90, not the roadway. |
| 181 | מצפה דדו מטולה אתר בבניה | path | H | Temporary/construction description must not ship as a name. |
| 197 | כביש גישה נבי יהודה מזרח | connector | H | Explicit access road. |
| 198 | כביש גישה נבי יהודה מערב | connector | H | Explicit access road. |
| 200 | שביל חיבור שמיר ציר הנפט | connector | H | Explicit connection. |
| 201 | שביל גישה גדר גבול הר דב | connector | H | Explicit access path. |
| 216 | שביל שדות כפר סאלד כביש 918 | dirt-road | H | Multi-place internal description. |
| 220 | כפר סאלד כביש גישה | connector | H | Explicit access road. |
| 227 | עלייה מדרך רומית לפטרולים דרום | connector | H | Connection between two named ways. |
| 228 | עלייה מדרך רומית לפטרולים צפון | connector | H | Connection between two named ways. |
| 237 | שביל חקלאי ליד תל קליל | dirt-road | H | Generic agricultural path. |
| 238 | עלייה קטנה לשאר ישוב | connector | H | Descriptive short connection. |
| 244 | שדות דפנה צפון | path | M | Broad area description on a paved path. |
| 248 | שביל גישה למחלק | connector | H | Explicit access path. |
| 256 | שדות קיבוץ דן | dirt-road | M | Broad area description. |
| 269 | צומת יסוד שביל חיבור | connector | H | Explicit junction connection. |
| 278 | שער כניסה שדות בית הלל | connector | H | Gate/entry section. |
| 282 | כביש גישה שדה נחמיה | connector | H | Explicit access road. |
| 283 | כניסה שדה נחמיה חניה | connector | H | Entry/parking section. |
| 288 | כניסה פארק התעלות | connector | H | Explicit entrance road. |
| 295 | שער כניסה שאר ישוב | connector | H | Gate/entry section. |
| 313 | מטעים עין קניא | dirt-road | M | Orchard-area description despite paved source styling. |
| 314 | מטעים עין קניא כביש 99 | dirt-road | H | Parallel orchard facility; do not call it Road 99. |
| 315 | מטעים עין קניא חיבור | connector | H | Explicit connection. |
| 316 | עין קניא מטעים דרומיים | dirt-road | M | Orchard-area description despite paved source styling. |
| 325 | מעבר מתחת כביש 918 | connector | H | Underpass connection, not a named way. |
| 333 | כניסה לקיבוץ דפנה | connector | H | Explicit entrance road. |
| 343 | צומת איילת השחר | connector | H | Junction context, not a way identity. |
| 345 | איילת השחר שדות צפוניים | dirt-road | M | Broad area description. |
| 351 | שביל גישה גשר להבות | connector | H | Access to standalone bridge 348. |
| 358 | רחוב פנימי שדה אליעזר | road | H | Explicitly generic internal street. |
| 359 | כביש גישה שדה אליעזר | connector | H | Explicit access road. |

## Highest-value first review

Review these batches first:

1. `patrol-road`;
2. `cycleway-99` additions and the decision that bridge segment 280 carries
   the cycleway rather than becoming standalone;
3. `road-99-upper`, existing `road-99`, and `road-99-east` as three current
   topology components with one display name;
4. `road-90` additions plus the explicit unnamed dirt facilities 49, 132, and
   152;
5. standalone bridges 12, 13, 14, 26, 245, and 348;
6. Road 918's three current components;
7. the Jordan east/west corridor proposals;
8. the high-confidence numbered roads, cycleways, streets, and marked trails;
9. medium/low natural and local names; and
10. the unnamed queue.

The first iOS audible-name check should include:

- `כביש 99` → `כביש תשעים ותשע`;
- `דרך הפטרולים` → `דֶּרֶךְ הַפַּטְרוֹלִים`;
- `ציר הנפט` → `צִיר הַנֶּפְט`;
- `גשר עינות ירדן` → `גֶּשֶׁר עֵינוֹת יַרְדֵּן`;
- `ואדי ינשוף` → `וָאדִי יַנְשׁוּף`; and
- `רחוב הנרייטה סאלד` →
  `רְחוֹב הֶנְרִיֶיטָה סֹאלְד`.

## Acceptance rule

Nothing in this document changes `data/map-source.geojson` or
`data/navigation-ways.json`. Each row must be accepted, edited, split,
reclassified, or deferred in the editor. Before using the proposal, recompute
the seven file digests and the evidence-set digest. Any mismatch makes the
complete document stale; reviewed canonical classifications remain valid, but
unaccepted suggestions must be regenerated.
