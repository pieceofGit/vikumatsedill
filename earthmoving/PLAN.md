# Earthmoving Cost Estimator – Prototype Test Plan

Goal: prove (or disprove) that an AI assistant can take an earthmoving job
description and produce a **contractor-grade cost estimate** – one an
experienced estimator would sign off on – using the company's real equipment,
real rates, and a buy/rent/subcontract analysis for anything missing.

The plan is split into: what the estimate must contain (§1), how the prototype
is built (§2), the data it needs (§3), how investments are evaluated (§4), how
we test it (§5), the timeline (§6), risks (§7), and open questions (§8).

---

## 1. What a "contractor-grade" estimate contains

The AI's output is judged against the same structure a human estimator uses.
Every estimate must include these sections, each with quantity × unit rate =
amount, and a stated assumption for every number that wasn't given.

| # | Section | Contents |
|---|---------|----------|
| 1 | Scope & assumptions | What's included/excluded, site conditions, soil type, working hours, season |
| 2 | Quantities (take-off) | Cut, fill, topsoil strip, rock, import/export volumes. Bank (in-situ) vs loose vs compacted m³, with swell/shrink factors |
| 3 | Method & fleet | Which machines do which task, production rate per machine, number of trucks to balance the loader |
| 4 | Equipment cost | Hours per machine × hourly rate (owning + operating for own fleet; rental rate + fuel for hired) |
| 5 | Labour | Operators, labourers, foreman, surveyor – hours × loaded wage (incl. taxes, pension, overtime) |
| 6 | Materials | Gravel, fill, geotextile, pipes, etc. – delivered price per m³/tonne |
| 7 | Trucking & disposal | Haul distance, truck cycles, tipping/disposal fees |
| 8 | Mobilisation | Lowbed transport in/out per machine, site setup, site facilities |
| 9 | Subcontractors | Blasting, surveying, testing, etc. |
| 10 | Indirects | Site overhead, insurance, permits, company overhead % |
| 11 | Risk | Contingency (explicit, tied to named risks), weather allowance |
| 12 | Margin & tax | Profit %, VAT shown separately |
| 13 | Schedule | Duration in days derived from the bottleneck machine's production |
| 14 | Investment notes | Where buying/renting a machine would change the price, with numbers (§4) |

### Core formulas the engine must implement (not the LLM)

```
Volume conversions
  loose  = bank × (1 + swell%)
  compacted = bank × shrink_factor

Machine production (m³ bank / hour)
  = bucket_m³ × fill_factor × (3600 / cycle_time_s) × job_efficiency (e.g. 50/60) ÷ (1 + swell%)

Trucks needed to keep loader busy
  = truck_cycle_time / loading_time_per_truck   (round up)
  truck_cycle = load + haul(dist/speed_loaded) + dump + return(dist/speed_empty)

Duration (days) = quantity / (bottleneck production × productive hours per day)

Owning cost / hour   = (price − residual) / life_hours + (interest + insurance + tax) × avg_investment / annual_hours
Operating cost / hour = fuel_L_per_h × fuel_price + maintenance + tyres/tracks + wear parts (GET)
Own-fleet rate / hour = owning + operating   (operator billed separately as labour)
```

---

## 2. Prototype architecture

**Principle: the LLM reasons and explains; deterministic code does the arithmetic.**
LLMs are good at reading a messy job description, choosing a method, and
spotting missing items. They are unreliable at multiplying 40 line items. So
every number in the final estimate must come from a tool call.

```
User job description (text, drawings, volumes, site address)
        │
        ▼
┌──────────────────────────┐
│ LLM agent (Claude)       │  1. Extract scope + quantities, list assumptions
│                          │  2. Ask clarifying questions if critical data missing
│                          │  3. Pick method & fleet
│                          │  4. Call tools for every number
│                          │  5. Review own output against checklist (§1)
└──────────┬───────────────┘
           │ tool calls
           ▼
┌──────────────────────────────────────────────────────────┐
│ Tools (plain code, unit-tested)                          │
│  get_fleet()            → own machines, availability     │
│  get_rates(kind)        → labour, fuel, materials, rental│
│  calc_production(...)   → m³/h, cycle times, trucks      │
│  calc_equipment_cost(..)→ owning + operating per hour    │
│  build_estimate(items)  → totals, overhead, margin, VAT  │
│  compare_investment(..) → buy vs rent vs subcontract     │
└──────────────────────────────────────────────────────────┘
           │
           ▼
Estimate (JSON) → rendered as spreadsheet/PDF + assumptions list + questions
```

Build steps:

1. **Data files** (JSON/CSV) for fleet, rates and past jobs – §3.
2. **Calculation library** with unit tests for every formula above.
3. **Agent** using Claude with tool use; system prompt contains the
   estimate checklist (§1) and the company's estimating rules
   (e.g. "always include lowbed mobilisation", "rock is priced separately").
4. **Output schema** – fixed JSON structure so estimates can be diffed
   automatically against reference estimates.
5. **Simple UI** – a single page: paste job description → see estimate,
   assumptions, and questions. (Spreadsheet export is enough for testing.)

---

## 3. Data the prototype needs

> Road construction is the first focus – see [DATA-ROAD.md](DATA-ROAD.md) for
> the detailed data list and [`templates/`](templates/) for CSV templates.

Collect these before building – the quality of the estimate is capped by
the quality of this data.

**Fleet register** (one row per machine)
```json
{
  "id": "EX-03",
  "type": "excavator",
  "model": "CAT 336",
  "weight_t": 36,
  "bucket_m3": 2.1,
  "purchase_price": 0,
  "purchase_year": 2019,
  "est_residual": 0,
  "life_hours": 12000,
  "hours_used": 0,
  "annual_hours": 1400,
  "fuel_L_per_h": 22,
  "maintenance_per_h": 0,
  "available_from": "2026-11-01"
}
```

**Rate sheets**
- Labour: loaded hourly cost per role, overtime multipliers.
- Fuel price (diesel), updated monthly.
- Materials: delivered price per m³/tonne by supplier and distance.
- Rental: day/week/month rates for machine classes from 2–3 rental companies.
- Disposal/tipping fees by site.
- Lowbed transport per km / per move.
- Company overhead %, target margin %, VAT %.

**Production references**
- Manufacturer handbook values (e.g. Caterpillar Performance Handbook) for
  cycle times, fill factors, swell/shrink by soil type.
- **Your own historical data** – this is the most valuable part: 10–20 past
  jobs with the original estimate *and* the actual final cost / hours.

---

## 4. Investment analysis (buy vs rent vs subcontract)

When the job needs a machine the fleet doesn't have (or doesn't have free),
the agent must compare options, not just pick rental.

For each candidate machine:

| Option | Cost on this job | Cost beyond this job |
|--------|------------------|----------------------|
| Rent | rental rate × duration + fuel + transport | none |
| Subcontract (machine + operator) | quoted hourly/unit rate | none |
| Buy (new/used) | owning + operating cost per hour × job hours | remaining value; needs future utilisation |
| Lease | lease payment × months + operating | per lease terms |

The tool computes:
- **Break-even utilisation**: annual hours at which owning becomes cheaper
  than renting = annual fixed owning cost ÷ (rental rate/h − operating cost/h).
- **NPV over 5 years** for buy vs rent, given an expected annual-hours figure
  (from the pipeline of upcoming jobs, or a user estimate) and the company's
  interest rate.
- **Recommendation** with the key sensitivity: "buying pays off if the machine
  works more than ~X h/year; you've averaged Y h/year for this class."

The agent must flag investments as a *note*, not bake them into the job price,
unless the user asks.

---

## 5. Test plan

### 5.1 Test levels

| Level | What | Pass criterion |
|-------|------|----------------|
| L1 – Unit | Every formula/tool function with hand-calculated cases | 100% pass, exact to rounding |
| L2 – Extraction | Agent reads job description → scope, quantities, assumptions | All quantities stated in input captured; no invented quantities without an "assumed" flag |
| L3 – Golden jobs | Full estimate vs reference estimate by a senior estimator | See metrics §5.3 |
| L4 – Backtest | Estimate past jobs, compare to **actual final cost** | See metrics §5.3 |
| L5 – Shadow live | Run on new tenders in parallel with the human estimator for 4–6 weeks | Estimator rates it useful; no unseen critical errors |

### 5.2 Test set ("golden jobs")

Build ~15–20 cases covering the range of work. Each case = input text
(as a client would send it) + reference estimate + (for past jobs) actual cost.

| # | Case | Tests |
|---|------|-------|
| 1 | House foundation dig, 600 m³ clay, export 10 km | Basic take-off, swell, truck count, disposal |
| 2 | Road subgrade 1 km, cut/fill balance on site | Mass haul, compaction, grader/roller selection |
| 3 | Trench for 300 m pipe, 2 m deep, backfill with imported gravel | Trench geometry, bedding material, shoring |
| 4 | Parking lot: strip topsoil, import 2,000 m³ fill, compact in layers | Shrink factor, layer count, roller hours |
| 5 | Job with rock (blasting needed) | Recognises subcontract, prices separately |
| 6 | Job far from base (150 km) | Mobilisation dominates, accommodation/per diem |
| 7 | Winter job | Frost, reduced productivity, weather contingency |
| 8 | Job needing a machine you don't own | Triggers buy/rent/subcontract comparison |
| 9 | Fleet fully booked in the period | Detects availability conflict, proposes rental |
| 10 | Vague request ("level my plot, ~1,500 m²") | Asks the right questions instead of guessing silently |
| 11 | Contradictory input (volumes don't match dimensions) | Detects and flags the conflict |
| 12 | Very large job (50,000 m³) | Fleet scaling, multiple loading points, schedule |
| 13–20 | Real past jobs with known actual cost | Backtest accuracy |

### 5.3 Metrics

| Metric | Target for prototype |
|--------|----------------------|
| Total price vs reference estimate | within ±10% on ≥ 80% of golden jobs |
| Total price vs actual final cost (backtest) | no worse than the human estimate's error on the same job |
| Quantity take-off error | within ±5% where quantities are derivable |
| Line-item completeness (checklist §1) | ≥ 95% of required items present; **zero** missing mobilisation/disposal/labour |
| Duration estimate vs actual | within ±20% |
| Arithmetic errors | 0 (all numbers come from tools – verify with recomputation) |
| Unflagged assumptions | 0 – every non-given number listed as an assumption |
| Clarifying questions on vague jobs | asks about the 3 most price-sensitive unknowns |
| Estimator review score (1–5) | average ≥ 4 on "would I send this to a client with minor edits" |
| Time to estimate | < 10 min including review (vs current baseline – measure it) |

### 5.4 Review procedure

1. Senior estimator writes reference estimates for golden jobs **before**
   seeing the AI output (avoid anchoring).
2. Run the agent 3× per job to check consistency (spread between runs
   should be < 5%).
3. Automatic diff of JSON estimate vs reference: per-section deltas.
4. Estimator scores each estimate with a short rubric:
   - Correct method/fleet choice? (y/n + comment)
   - Missing items?
   - Wrong rates or productivities?
   - Would you send it? (1–5)
5. Log every error into a category (extraction / method / rate / missing item /
   math / investment logic). Fix the top category, re-run the whole set
   (regression), repeat.

### 5.5 Sensitivity checks

For each golden job, vary one input at a time and check the estimate moves
the right way and by a sensible amount:
- haul distance +50% → more trucks / longer duration
- fuel price +20% → equipment cost rises by the fuel share only
- soil clay → rock → production drops, blasting appears
- fleet machine unavailable → rental appears, price changes

---

## 6. Timeline (≈ 8 weeks, one developer + part-time estimator)

| Week | Deliverable |
|------|-------------|
| 1 | Collect fleet register, rate sheets, 15–20 past jobs with actuals. Measure current time-per-estimate |
| 2 | Calculation library + unit tests (L1). Output JSON schema |
| 3 | Agent v1 with tools; runs on 3 easy golden jobs end-to-end |
| 4 | Estimator writes reference estimates; full golden-set run (L2, L3); error log |
| 5 | Fix top error categories; add investment comparison tool; re-run |
| 6 | Backtest on past jobs vs actuals (L4); sensitivity checks |
| 7–8 | Shadow mode on live tenders (L5); go/no-go review |

**Go / no-go criteria** at end of week 8: meets §5.3 targets on the golden
set, backtest error no worse than human, estimator would use it daily.

---

## 7. Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| LLM invents numbers | All numbers via tools; post-check recomputes totals; unflagged assumptions = test failure |
| Rate data goes stale | Rates in one file with "last updated" date; agent warns if > 60 days old |
| Productivity rules don't match your crews | Calibrate fill factors / efficiency from backtest actuals |
| Over-trust by users | Every estimate shows assumptions + confidence; human signs off before sending |
| Few historical jobs with actuals | Start with what exists; record actuals on every new job from now on |
| Quantity take-off from drawings is hard | Prototype accepts volumes/dimensions as text; drawing/CAD import is a later phase |

---

## 8. Open questions to settle before week 1

1. Which kinds of jobs matter most (house sites, roads, utilities, quarry)?
2. How many machines in the fleet, and do you have cost data per machine?
3. How many past jobs have both the estimate and the actual final cost?
4. Who is the reference estimator, and how much of their time is available?
5. Currency/market: ISK and Icelandic rates (VSK 24%, local rental firms)?
6. Output format clients expect: spreadsheet, PDF quote, or tender form?
7. Should the prototype read drawings/survey files, or is text input enough
   for the first test?
