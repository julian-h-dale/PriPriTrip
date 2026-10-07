# Run stage 9 — one look for an entry's details

Asked 2026-10-05 (Julian): the stays/travel details dialog (hero photo) and
the expanded rows show the same details in two looks. Keep one.

- **Already shared:** both render `EntryDetails` from `describeEntry`, so the
  content is one thing. Only the photo differed.
- **Decisions (answered 2026-10-05):** the hero sits at the top of the
  expanded panel, under the summary row (so the row doesn't jump on expand);
  activities get it too; flights and ferries use their airport/port photos,
  as the dialog did.

- **Phase 45 — one hero.** ✅ (2026-10-05)
  - `describeEntry().hero` is the one rule (a place's photo; a leg's
    destination, else origin). `HeroFade` + `useHeroImage` are the one
    component; `Dialog` and the expanded rows both use them. `PlaceRow`
    thumbnails and the `photos` flag are removed.
  - **Tests:** the hero rule for each kind of entry; an expanded row shows it
    (a flight too); it is dropped, with its padding, when the image fails;
    none without a photo; the dialog tests as before.
  - **Julian, on a phone:** open a day and expand a stay, a flight and an
    activity: the fade, the text over it, and no jump in the header. Photos
    need the network, so offline shows the plain row.
