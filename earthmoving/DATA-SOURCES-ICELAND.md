# Public Icelandic Data Sources – Road Construction Estimator

Status: **found via web search only – not yet opened/verified.** The research
environment's network policy blocked direct access to `.is` sites, so every URL
and number below came from search-result snippets. Each needs one check
before it is used in the model. Values are as of October 2026.

Legend: ✅ = value appeared in several search results · ⚠️ = single
snippet / uncertain · ❓ = from general knowledge, not found in search

---

## 1. Prior projects (test cases and price calibration)

### 1.1 Vegagerðin tender results – *best test-case source*
- **Framkvæmdafréttir** (Vegagerðin's newsletter, PDF). Every issue has
  tables of tender results: each bidder, bid in ISK, % of the estimate, and
  **"Áætlaður verktakakostnaður"** (the engineer's estimate). History back to
  at least 2003. ✅
  - Old issues: `vegagerdin.is/vefur2.nsf/Files/frNNN-…pdf`
    (e.g. fr404-15-2005, fr557-01-2011, fr615-18-2013)
  - Mar 2023: https://www.vegagerdin.is/vefur2.nsf/Files/fr724-2-2023/$file/VEG_Framkvaemdafrettir%20-%2003%20Mars%20-%202023_VEF.pdf
  - Aug 2022: https://wp-beta.vegagerdin.is/wp-content/uploads/2024/08/veg_framkvaemdafrettir_agust_2022_vef.pdf
  - Dec 2024: https://wp-beta.vegagerdin.is/wp-content/uploads/2024/12/veg_frkfr-2024-5-desember-vefutgafa_nr2.pdf
  - Oct 2025: https://www.vegagerdin.is/media/2025/10/veg_frkfr-2025-4-okt_vefur-1-1.pdf
  - Scanned issues also on timarit.is
  - Tender notices in the same newsletter often list **main quantities**
    (excavation, fill, pavement m², culverts) – a partial bill of quantities.
- **"Opnun tilboða"** on vegagerdin.is – latest bid openings. ⚠️ exact URL not confirmed.
- Planned tenders (future pipeline): https://www.vegagerdin.is/framkvaemdir/utbod/fyrirhugud-utbod/

### 1.2 Example tenders (starter test set) – `templates/tenders_public.csv`

| Project | Year | Estimate (ISK) | Lowest bid (ISK) | Lowest / estimate |
|---|---|---|---|---|
| Vesturlandsvegur, Kjalarnes widening, phase 2 | 2026 | 5,180,542,567 | 4,680,697,303 | 0.90 |
| Vestfjarðavegur, Gufudalssveit (4.6 km + 210 m bridge) | 2026 | 2,431,870,289 | 3,888,451,476 | 1.60 |
| Einholtsvegur 358, Bláskógabyggð (rebuild) | 2026 | ~467,700,000 | 486,141,889 | 1.04 |
| Arnarnesvegur phase 3 (road + bridge) | 2023 | ~6,200,000,000 | ~5,400,000,000 | 0.87 |
| Laxárdalsvegur (rebuild) | 2022 | 329,500,000 | ~328,800,000 | 1.00 |
| Dynjandisheiði, Vestfjarðavegur | ~2021–22 | 1,762,000,000 | 1,482,000,000 | 0.84 |
| Vesturlandsvegur, Mosfellsbær | 2020 | 706,000,000 | 490,000,000 | 0.69 |
| Fossvogsbrú land fills | 2024 | 1,282,627,290 | 1,292,618,241 | 1.01 |

Sources are news items (mbl.is, visir.is) and Framkvæmdafréttir – see the CSV. ⚠️

**Lesson for testing:** the lowest bid ranges from 0.69× to 1.60× the
engineer's estimate. Even the client's estimate is not "the truth". So the
test target should be: *the AI's price falls inside the range of bids, close
to the median bid* – not "matches the estimate".

Caveats: an opening is not an award. In 2022 all bids were rejected 7 times
for being too far over the estimate (althingi.is/altext/153/s/2186.html).
Keep "bid" and "contracted" separate.

### 1.3 Other tender results
- **Reykjavíkurborg "Samanburðarskrár"**: PDF per tender with every bidder,
  price at opening and after review, % of the estimate. 2018–2026.
  Urban streets and utilities (gatnagerð og lagnir). ✅
  Pattern: `reykjavik.is/sites/default/files/skrifstofur_radhuss/innkaupadeild/Samanburdarskrar/{year}/{no}_{name}.pdf`
  - Example: 14833 Bústaðavegur 151–153 (estimate 736.6 m ISK)
- **Garðabær** publishes full tender books with bid forms (contain the bill of
  quantities). ⚠️
- **Tendsign.is** – Vegagerðin's e-tendering system; bid books with
  quantities live here, probably behind registration. ⚠️
- **TED (EU)** – Vegagerðin's EEA tenders appear, but values often "not available". Low value.
- **Landsvirkjun** (landsvirkjun.is/innkaup/utbod) – tenders and results. ❓

### 1.4 Actual / final costs
- **Ríkisendurskoðun** follow-up on transport projects, contract vs. final cost
  (typical overrun ratios):
  https://rafhladan.is/bitstream/handle/10802/11016/itrekud_eftirfylgni_samgonguframkvaemdir.pdf ⚠️
- **FSRE "skilamat"** close-out reports: estimate vs. final cost (mostly
  buildings, but a good model of actual-cost data). ⚠️
- **opnirreikningar.is** – state payments per supplier per month. Not coded
  per project, so only a rough proxy. ⚠️
- **Alþingi written answers** often give project cost estimates
  (e.g. Bláfjallavegur rebuild 2.5–3 bn ISK, althingi.is/altext/156/s/0433.html). ⚠️

### 1.5 Environmental impact assessments (EIAs) – *quantities for test cases*
EIA reports (matsskýrslur) for road projects list cut/fill and material
volumes and borrow pits per project. Combined with the tender result for the
same road, they give a test case with **both quantities and price**.

| Project | What's in it |
|---|---|
| Dynjandisheiði phase 3 (Vestfjarðavegur 60) | ~640,000 m³ material need; named pits. https://www.ust.is/library/sida/Nattura/Leyfi%20til%20framkv%C3%A6mda%20Dynjandishei%C3%B0i-3%20%C3%A1fangi.pdf |
| Axarvegur (939) | 2011 EIA + 2022 request for +198,400 m³ more material → **estimate vs. actual overrun case**. https://www.vegagerdin.is/Vefur2.nsf/Files/Axarvegur_Mau_2010.11_fummatsskyrsla/$file/Axarvegur_Frummatssk%C3%BDrsla.pdf |
| Hringvegur um Hornafjörð | 2009 EIA, ch. 8 on material need; later +20,000 m³ extra extraction. https://www.vegagerdin.is/vefur2.nsf/Files/Hringvegur_um_Hornafjord_Matsskyrsla_090605/$file/Hringvegur_um_Hornafj%C3%B6r%C3%B0_Matssk%C3%BDrsla_090605.pdf |
| Vestfjarðavegur 60, Bjarkalundur–Skálanes | 2020 EIA + geology/materials appendix. https://www.vegagerdin.is/media/2026/06/matsskyrsla-vestfjardavegur60_mars_2020.pdf |
| Vestfjarðavegur Eyri–Vattarnes (22.7 km) | https://www.vegagerdin.is/vefur2.nsf/Files/Eyri-Vattarnesmatsskyrsla/$file/eyri_vattarnes_matsskyrsla.pdf |

Current EIA cases: Skipulagsgátt (skipulagsgatt.is). Older: skipulag.is/media/attachments/Umhverfismat/<id>/

---

## 2. Economic data (prices and indexes)

### 2.1 Statistics Iceland (Hagstofa) – PxWeb API ✅
- API: `https://px.hagstofa.is/pxis/api/v1/is/<path>/<TABLE>.px`
  GET = metadata, POST with a query = data (JSON / CSV / json-stat).
- **Building cost index** (vísitala byggingarkostnaðar), monthly, Dec 2021 = 100:
  - **VIS13303 – by input: domestic materials, imported materials, labour,
    machinery/transport/energy** → use this to escalate each cost group separately
  - VIS13000 (index), VIS13302 (by trade)
  - Latest: Aug 2026 = 129.5. Next release 23 Oct 2026.
- **CPI**: VIS01004 (indexation CPI). Inflation ~5.6–5.9% (Aug–Oct 2026).
- **Wage index / wages by occupation** (plant and machine operators, ISCO 8)
  – under "Laun"; table IDs not yet confirmed.
- No dedicated road construction index. Vegagerðin had its own
  (2009 report: https://www.vegagerdin.is/Vefur2.nsf/Files/Visitala_vegagerdarkostnadar/$file/Visitala_vegagerdarkostnadar-okt2009.pdf).
  Contracts are usually indexed to the building cost index – reportedly
  challenged in Supreme Court case 7/2025 (Vegagerðin v. Ístak) as not
  reflecting road-works costs. ⚠️ Matters for how the model escalates prices.

### 2.2 Fuel ⚠️ (big changes in 2026 – verify)
- **Oil levy (olíugjald) abolished 1 Jan 2026** and replaced by a per-km charge
  (kílómetragjald) for vehicles. This changes diesel cost per litre and the
  old "dyed diesel" advantage for work machines.
  https://www.skatturinn.is/atvinnurekstur/skattar-og-gjold/oliugjald/
- Carbon tax on diesel 2026: 28.30 kr/l.
- Per-km charge for trucks ≥ 10 t: weight-based scale.
  https://www.skatturinn.is/atvinnurekstur/skattar-og-gjold/kilometragjald-a-vorubifreidar/
  → **Haul trucks on public roads now pay per km** – add to trucking costs.
- VAT on fuel was temporarily 11% (May–Aug 2026), back to 24% from 1 Sep 2026.
- Pump prices: gasvaktin.is (per station history), N1 / Olís / Orkan /
  Atlantsolía sites. Conflicting snippets (~270–325 kr/l) → fetch directly.

### 2.3 Labour
- SGS/Efling – SA agreement 2024–2028; pay tables from 1 Jan 2026:
  https://www.efling.is/sa-launatoflur (machine operator / truck driver grade
  still to extract). Tradespeople: Samiðn / VM. SA wage register:
  https://sa.is/vinnumarkadsvefur/kjarasamningar/kaupgjaldsskra-sa/
- Employer on-costs on top of wages:

| Item | Rate |
|---|---|
| Payroll tax (tryggingagjald) 2026 | 6.35% ✅ |
| Employer pension | 11.5% ✅ |
| Holiday pay (orlof) | ≥ 10.17% ❓ |
| Sick fund | ≥ 1% ⚠️ |
| VIRK + holiday home + education funds | ~0.65% ❓ |

- Market hourly rate example (gigur.is 2026): excavator + operator
  9,750 kr/h + VAT; operator only 8,500 kr/h + VAT. ⚠️

### 2.4 Interest, FX, tax
- Central Bank policy rate **8.00%** (held 7 Oct 2026; next decision 18 Nov). ✅
  → use for the cost of capital in buy-vs-rent analysis.
- EUR/ISK ~144 (May 2026) – machines are priced in EUR. Daily rates: ECB SDMX
  API (includes ISK) or Seðlabanki. ⚠️
- VAT 24% on construction work. ✅
- Import of construction machines (HS 8429): probably 0% duty and no excise
  duty since 2015 ❓ – confirm in Skatturinn's tariff (tollskrá).

### 2.5 Equipment prices
- Rental prices (mini excavators): BYKO 28,000–49,000 kr/day, 100,000–175,000
  kr/week (https://byko.is/leiguvara/smagrafa-2700kg-358437). ⚠️
  No public rental lists found for large road machines → **ask rental firms for quotes**.
- Dealers (Klettur/CAT, Kraftvélar/Komatsu, Brimborg/Volvo CE, Vélfang, Hekla):
  quotes on request only.
- Used machines: Mascus (no free API).

### 2.6 Materials
- Steypustöðin base course, per tonne incl. VAT: 0/22 Hólabrú 2,348 kr/t;
  0/45 Hólabrú 1,832 kr/t; 0–19 Vatnsskarð 1,940 kr/t. ⚠️
- **ÍAV quarry price list 2026** (Stapafell / Lambafell), e.g. base course 0–19
  at 3,079 kr/m³ incl. VAT:
  https://api.iav.is/wp-content/uploads/2026/01/Verdskra-fyrir-namur-IAV-2026.pdf ⚠️
- Asphalt: Reykjavík reference unit prices for repairs, 5 cm asphalt ~11,572 kr/m²
  excl. VAT:
  https://reykjavik.is/sites/default/files/USK/Afnotaleyfi/vidmidunareiningaverd_vegna_vidgerda_a_yfirbordi_borgarlands.pdf ⚠️
- Bitumen, asphalt per tonne, culvert pipes: no public lists → quotes.

---

## 3. Site and technical data

| Source | What | Use |
|---|---|---|
| **ÍslandsDEM** (LMÍ / Náttúrufræðistofnun) – 10/20 m GeoTIFF, 2 m version exists. https://gatt.natt.is/geonetwork/srv/api/records/9534cc67-1293-4677-a185-2de87fcb5670 | Terrain heights | **Compute cut/fill along a road line** for early quantities. Licence to check (LMÍ open data is CC BY 4.0). |
| **ArcticDEM** 2 m (Google Earth Engine / AWS) | Terrain heights | Free alternative to ÍslandsDEM |
| **Vegagerðin gagnaveita** – WFS/WMS `gagnaveita.vegagerdin.is/geoserver` (JSON/CSV/shapefile) | Traffic counts, road network ⚠️ | Traffic → road type/cross-section, traffic management |
| Traffic reports "Umferð á þjóðvegum" (PDF) | Average daily traffic per section | Same |
| **IS 50V** (LMÍ) | Roads, rivers, contours, land cover | Context, haul routes |
| Bedrock map 1:600k + 1:100k (WFS `gis.natt.is/geoserver/wfs`) | Geology | Rock vs. soil in cuts |
| Habitat maps (vistgerðir) 1:25k | Wetlands / bog | **Soft ground to dig out and replace** |
| **Veður: api.vedur.is** (JSON, OpenAPI) + monthly climate tables | Observations, history | Workable days, frost, season length |
| **Veghönnunarreglur** (Vegagerðin design rules) – e.g. 02 cross-section: https://www.vegagerdin.is/vefur2.nsf/Files/VhRg02_THversnid/$file/VhRg02_Thversnid_2011.pdf | Lane/shoulder width per road type | **Road type → volume per metre** |
| **Alverk** (Vegagerðin general specification) | Item numbering used in bills of quantities | Map tender items → cost items. Not found online → ask Vegagerðin |
| **Samgönguáætlun 2026–2040** (passed 12 Jun 2026; roads 2026–30: ~172.8 bn ISK) https://www.stjornarradid.is/verkefni/samgongur/samgonguaaetlun/samgonguaaetlun-2026-2040/ | Upcoming projects | **Future work pipeline → buy-vs-rent decisions** |

Note: no public register of Vegagerðin's material pits was found; pit lists
with volumes are in each EIA's appendix on extraction (efnistaka).

---

## 4. Suggested order of work

1. **Test set:** parse Framkvæmdafréttir 2015–2026 → table of road tenders with
   every bid + estimate. Pick 10 with an EIA (quantities) → full test cases.
2. **Price base:** Hagstofa VIS13303 (escalation), labour on-costs, fuel price,
   ÍAV/Steypustöðin material prices, rental quotes.
3. **Quantity tools:** cross-section from Veghönnunarreglur + ÍslandsDEM →
   cut/fill along an alignment; check against EIA volumes.
4. **Season:** api.vedur.is → workable days per region and month.
5. **Investment:** Samgönguáætlun + planned tenders → expected demand per
   machine class over 5 years.

Missing and only obtainable by asking: unit prices per item (bid books from
Tendsign or Vegagerðin), Alverk spec, rental prices for large machines,
bitumen / pipe prices.
