# Memory

Curated operational memory. Not a transcript archive, not a system of record.

## One fact, one file

Every rule, gotcha, and convention lives in **exactly one file**. Other files
link to it and never restate it. Duplicated facts drift — one copy gets fixed
and the other silently keeps the wrong answer while both are still being read.

Where a thing belongs:

| Knowledge | Home | Read when |
|---|---|---|
| Execution rules — format, template, rate, naming | `businesses/<id>/document-defaults.yaml` | Every run |
| Gaia/GWW product, supplier-cost, size-band, and uplift lookup | `businesses/gaia/product-data.md` | Every relevant quote, invoice, costing, or margin lookup |
| API behaviour and failure modes | `workflows/<name>/README.md` | Every run of that workflow |
| Durable unresolved constraints | `memory/known-issues.md` | First-time workflows |
| Why a choice was made | `memory/decisions.md` | On revisit |
| Verified learnings | `memory/lessons.md` | On revisit |

If a fact is needed in a second file, write a `single_source:` pointer to its
home — not a copy.

`memory/` explains and justifies. It is **not** read during routine execution;
the run-time files above are. A rule that only lives here will not be followed.

## Writing entries

- Date every entry.
- Write findings at the confidence they were earned at. One observation is an
  observation, not a settled fact. Say "unverified" where it applies.
- Update an existing entry when a fact changes; preserve superseded decisions
  with a date rather than silently rewriting history.
- Never store credentials, personal data, customer lists, full messages, invoice
  data, or payment figures.

## Files

- `decisions.md` — lasting architectural and operating decisions
- `lessons.md` — reusable lessons verified through work
- `known-issues.md` — durable constraints; resolved items are deleted, not archived
- `preferences.md` — owner preferences
