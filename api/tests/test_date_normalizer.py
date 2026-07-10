from app.services.date_normalizer import DateNormalizerInput, normalize_date


def test_normalize_month_day_next_occurrence():
    assert (
        normalize_date(
            DateNormalizerInput(
                rawText="Oct 30",
                appCurrentDate="2026-07-09",
            )
        )
        == "2026-10-30"
    )


def test_normalize_january_rolls_next_year():
    assert (
        normalize_date(
            DateNormalizerInput(
                rawText="Jan 1",
                appCurrentDate="2026-07-09",
            )
        )
        == "2027-01-01"
    )


def test_normalize_july_one_rolls_next_year_when_past():
    assert (
        normalize_date(
            DateNormalizerInput(
                rawText="July 1",
                appCurrentDate="2026-07-09",
            )
        )
        == "2027-07-01"
    )


def test_normalize_relative_dates():
    assert (
        normalize_date(
            DateNormalizerInput(
                rawText="tomorrow",
                appCurrentDate="2026-07-09",
            )
        )
        == "2026-07-10"
    )
    assert (
        normalize_date(
            DateNormalizerInput(
                rawText="Friday",
                appCurrentDate="2026-07-09",
            )
        )
        == "2026-07-10"
    )
