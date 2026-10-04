# reference/

Material carried over from PriPriTrip v1 for knowledge, not code. Nothing in
the app imports from here. See [`docs/lessons_learned.md`](../docs/lessons_learned.md)
for the distilled version.

| Path | What it is |
|---|---|
| `honeymoon_full_field_guide.md` | The original honeymoon itinerary write-up (source material for a trip document). |
| `data/trip.json` | The honeymoon trip in the **v1** import format (`llm-translate`). Not valid against the new schema — stays are modelled as 30-minute check-in events (see lessons §4). |
| `data/verify_test_trip.json`, `data/verify_cases/` | v1 verification fixtures, one per issue code. |
| `data/*.xlsx`, `data/eva-air-japan.pdf` | v1 AI-import test inputs. |
| `legacy-docs/full_report.md` | Full technical report of v1 at its end state — best single overview. |
| `legacy-docs/review.md` | Second-pass codebase review (findings R1–R21). |
| `legacy-docs/timezones.md` | Analysis of v1's timezone handling and the recommended model. |
| `legacy-docs/trip_verify.py` | v1 verification logic (9 issue codes). |
| `legacy-docs/old_trip.schema.json` | v1 JSON schema for the import format. |
| `legacy-docs/feature_notes.md` | Julian's raw feature notes from v1 (verify, workflow, AI import ideas). |
| `private/` | **Gitignored.** Personal PDFs/notes from the old `docs/` folder and backups of the old `.env` files. |

The full v1 code lives in git: the `main` branch before the rebuild, and the
`llm-translate` branch.
