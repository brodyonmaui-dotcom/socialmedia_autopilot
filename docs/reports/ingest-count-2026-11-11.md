# Ingest count check — 2026-11-11 (read-only)

Expected ~219 media rows; DB has 204; scanner finds 203 ingestable files. Nothing was changed.

## Ingest roots (all pillar `gym`)
| Root | Video files on disk | Skipped by design | Scanned | In DB |
|---|---|---|---|---|
| Ready To Post/Workout Vlogs/Full Logs | 30 (22 .mp4, 8 .mov) | 27 in `Posted/` | 3 | 3 |
| Ready To Post/Workout Vlogs/Short Reels | 75 | 10 in `Physique Check Edits/posted/` | 65 | 65 |
| Ready To Post/Single Sets/Upper Body | 135 | 0 | 135 | 135 |
| **Total** | **240** | **37** | **203** | **203** |

- Extensions: the scanner already takes `.mp4/.mov/.m4v` case-insensitively; the 8 `.mov` files are counted. No hidden files and no other video types (avi/mkv/webm/…) in the roots. The only non-video files are a few `.jpg`/`.json`.
- The 37 skips are all in `posted` folders (`SKIP_DIR`), which is intended.

## The 204th row
- One row (status `ready`) points at `Ready To Post/Single Sets/Physique/shirtless-physique-check.mp4`. That folder no longer exists, and the file isn't anywhere under `Gym Content` (only a matching `.docx` in `_Archive/Edit Status/2 - Approved/`).
- It's from an earlier, wider `INGEST_ROOTS` scope. That's what `deleteFromR2` was written for, but nothing calls it.

## Folders next to the roots but not in `INGEST_ROOTS`
| Folder | Videos |
|---|---|
| Single Sets/Lower Body | 41 |
| Single Sets/PT + Plyos | 31 |
| Single Sets/Core + Abs | 21 |
| **Total** | **93** |

## Why ~219 doesn't match
No subset of the folders adds up to exactly 219 (203 + 16, or 240 − 21 is a coincidence). The estimate most likely came from an older folder layout, e.g. one that still had `Single Sets/Physique`. The ingest itself is complete for the configured scope.

## Proposed fix (needs OK; nothing done)
1. **Orphan row:** mark it as not postable (e.g. status `missing`/`archived`) instead of `ready`, so a batch can't pick a clip whose master is gone. Deleting the row and its R2 object would need an explicit OK.
2. **Scope:** if the three Single Sets folders should be in the library, add them to `INGEST_ROOTS` in `.env` (+93 files, upload time ≈ 30–40 min) and run the ingest agent.
3. **Guard:** have the ingest agent print `N rows whose source file is gone` at the end of a run (read-only check), so drift shows up without a manual audit.

## Update — later on 2026-11-11 (day run c)
- Added **Single Sets/Lower Body, PT + Plyos, Core + Abs** (creator's OK). Dry run: 93 to ingest, 0 duplicates. Real run: **93 ingested, 0 failed** over three passes. Passes 1 and 2 lost the SSH tunnel mid-run, and the re-runs skipped what was already in by content hash.
- `media` rows: **297** (296 `ready`, 1 `archived`).
- The orphan row (`Single Sets/Physique/shirtless-physique-check.mp4`) is now **`archived`**. Its R2 copy is kept; batch `create` refuses archived clips; the library shows "file missing" when run on the laptop.
- `INGEST_ROOTS` in `.env` still lists only the original 3 roots; the run passed the 6 roots via the environment. Add the 3 new folders to `.env` so future runs include them.
- Duplicate report refreshed: `docs/reports/duplicates-2026-11-11-refresh.md`, **449 files, 0 duplicate sets** (the 11 reviewed copies in `duplicates-review/` are skipped).
