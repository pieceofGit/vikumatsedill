# Data Needed – Road Construction Estimator

Focus of the prototype: **road construction** (new roads and rebuilds:
earthworks, pavement layers, culverts, drainage, surfacing).

Road jobs are usually tendered as a **bill of quantities (BoQ)**: the client
gives the items and quantities, and the contractor fills in a unit price per
item. So the AI's main job is: *for each BoQ item, build a unit price from
method, equipment, labour, materials and haul*, then check the quantities and
spot what is missing or risky.

Data falls into four groups:

| Group | Where it comes from | When it's needed |
|-------|--------------------|------------------|
| A. Job data | The tender package from the client | Every estimate (input) |
| B. Company data | Your fleet, payroll, suppliers | Once, then kept up to date |
| C. Production data | Handbooks + your own records | Once, calibrated over time |
| D. Test data | Past jobs + public tender results | To test the prototype |

Templates for B and D are in [`templates/`](templates/).
Public Icelandic sources (past tenders, indexes, prices, terrain, weather) are
listed in [DATA-SOURCES-ICELAND.md](DATA-SOURCES-ICELAND.md).

---

## A. Job data (from the tender package)

The AI reads this for each estimate. For the prototype it's enough that it
reads the BoQ and the key numbers from the description. Reading drawings
comes later.

| Data | Why it matters |
|------|----------------|
| **Bill of quantities** (item no., description, unit, quantity) | The structure of the price |
| Technical specification (e.g. Vegagerðin's general spec + special conditions) | Layer thickness, material grading, compaction requirements, testing |
| Road length, road class/width, cross-section | Layer areas and volumes |
| **Cut and fill per station / mass haul diagram** | Haul distances, which is the biggest cost driver in earthworks |
| Pavement structure: fill, subbase, base, surfacing (surface dressing or asphalt) | Material volumes, crushing, surfacing method |
| Culverts and drainage: number, diameter, length | Pipe cost, installation time |
| Soft ground (peat/bog) to remove and replace | Often underestimated; extra excavation and fill |
| Rock in cuts: estimated volume, need for blasting | Blasting subcontractor, slower production |
| **Borrow pits named by the client**: location, approved materials | Haul distance, crushing need, royalties |
| Disposal areas for unsuitable material | Haul distance |
| Traffic: is the existing road kept open during work? | Traffic management, slower work |
| Contract period, milestones, penalties | Number of crews and machines, season |
| Location, distance from your base | Mobilisation, accommodation, per diem |
| Extras: guardrails, signs, road markings, fences, grids | Usually subcontracted |

## B. Company data (fill in once, keep up to date)

### B1. Fleet – `templates/fleet.csv`
One row per machine. For road work the important classes are:
excavators, dozers, articulated dump trucks, tipper trucks, graders, rollers
(smooth drum and padfoot), wheel loaders, crushing/screening plant, water
truck, binder distributor and chip spreader (for surface dressing), lowbed.

Per machine: size and capacity, year, purchase price and expected resale
value, life hours, annual hours, **fuel use per hour**, maintenance and
tyre/track cost per hour, GPS machine control (yes/no), where it is and
when it's free.

> If purchase prices aren't known, the hourly internal rate you use in
> calculations today is a good start.

### B2. Rates – `templates/rates.csv`
- **Labour:** loaded hourly cost per role (operator, truck driver, foreman,
  labourer, surveyor), overtime rules, per diem / accommodation for remote jobs.
- **Fuel:** diesel price, updated monthly.
- **Rental:** day/week/month rates per machine class from 2–3 rental companies.
- **Transport:** lowbed cost per km or per move.
- **Materials:** royalties per m³ from borrow pits, bitumen/emulsion, chippings,
  culvert pipes (by diameter), geotextile, asphalt (delivered, per tonne).
- **Subcontractors:** quotes or price lists for blasting, asphalt paving, road
  markings, guardrails, signs, testing lab, surveying.
- **Company:** overhead %, target profit %, insurance, bank guarantee cost.

### B3. Material sources – `templates/material_sources.csv`
Your own and known borrow pits: location, material type and quality, usable
volume, need for crushing/blasting, royalty, permit status. Haul distance to the
road is the single biggest driver of earthworks cost, so this matters.

## C. Production data (output per hour per activity)

This is what turns machine hours into unit prices. Start from handbook values
and correct them with your own records.

| Activity | Unit | Depends on |
|----------|------|-----------|
| Excavate and load in cut (soil / rock) | m³/h | machine size, material |
| Haul with dump trucks | m³/h per truck | **distance**, gradient, road condition |
| Spread and compact fill | m³/h | layer thickness, roller type, number of passes |
| Remove peat / soft ground | m³/h | depth, water |
| Crush and screen | tonnes/h | plant, rock type, product grading |
| Lay and compact subbase / base | m²/h or m³/h | grader, roller, thickness |
| Fine grading to tolerance | m²/h | GPS or not |
| Surface dressing (single/double) | m²/day | crew, binder distributor, weather |
| Culvert installation | m/day or units/day | diameter, depth |
| Ditching and slope trimming | m/h | profile |

Plus:
- **Swell/shrink factors** per material (soil, gravel, blasted rock).
- **Working season:** which months each activity can run (surface dressing and
  asphalt need dry, warm weather), and the usual number of days lost to weather.

> Your best source here is **daily logs / timesheets** from past road jobs:
> machine hours and quantities per day. Even a few jobs give a strong
> calibration.

## D. Test data

### D1. Your past road jobs – `templates/past_jobs.csv` + `templates/past_job_items.csv`
For each job, as much as you have of:
1. The tender package (BoQ, description, drawings)
2. **Your bid**, with unit prices per item
3. **The actual cost**, ideally per item, otherwise per main section
   (earthworks, base layers, surfacing, culverts, mobilisation)
4. Machine hours and labour hours actually used
5. Actual quantities vs. tendered quantities
6. Planned vs. actual duration, and what went wrong

Aim for **5–10 road jobs**. Jobs you *lost* are useful too, if you know the
winning bid.

### D2. Public tender results
Vegagerðin (the Icelandic Road Administration) and municipalities publish
tender results: **every bidder's total and the client's own cost estimate**.
That gives a free test set of real road jobs:
- Give the AI the published tender description and BoQ.
- Compare its price with the lowest bid, the average bid, and the client's
  estimate.
- Target: inside the range of the bids, and close to the average bid.

This lets testing start before your own historical data is collected.

---

## Minimum to start (week 1)

If collecting everything is too much, this is enough for a first test:

1. Fleet list with fuel use and the internal hourly rate per machine
2. Labour cost per hour, diesel price, rental prices for missing machines
3. Royalty and crushing cost per m³ for 2–3 typical borrow pits
4. **3 past road jobs** with BoQ, your unit prices, and the actual total cost
5. **5 public tenders** from Vegagerðin with all bids and the cost estimate

Everything else can be added after the first test run shows where the
errors are.
