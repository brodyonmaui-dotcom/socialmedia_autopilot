# UI screenshots: deletions (done 2026-11-18)

Deleted on 2026-11-18 with the creator's OK (f12/ and the 9 loose PNGs). Sizes were from `du -sh`.

| Path | Size | Why |
|---|---|---|
| `docs/design/ui-shots/f12/` (whole folder) | 48M | Superseded by `v3/` on 2026-11-17 |
| `docs/design/ui-shots/approve-sheet-phone.png` | 128K | Loose old shot |
| `docs/design/ui-shots/batch-card-phone-light.png` | 608K | Loose old shot |
| `docs/design/ui-shots/batch-card-phone.png` | 688K | Loose old shot |
| `docs/design/ui-shots/home-desktop-light.png` | 1.6M | Loose old shot |
| `docs/design/ui-shots/home-desktop.png` | 1.9M | Loose old shot |
| `docs/design/ui-shots/home-phone-full-light.png` | 404K | Loose old shot |
| `docs/design/ui-shots/home-phone-light.png` | 624K | Loose old shot |
| `docs/design/ui-shots/home-phone.png` | 684K | Loose old shot |
| `docs/design/ui-shots/reveal-hover-desktop.png` | 832K | Loose old shot |

Totals: f12/ 48M + 9 loose PNGs about 7.5M = about 55M.

Kept: `docs/design/ui-shots/v3/` (9.4M) and `docs/design/ui-shots/f15/` (3.9M).

Deleting shrinks checkouts, but git history still holds the blobs. Clones only shrink after a history rewrite, which is your call. Cloud sessions could use a partial clone (`git clone --filter=blob:none`) instead.

Command to run yourself:

```sh
git rm -r docs/design/ui-shots/f12 docs/design/ui-shots/*.png
```
