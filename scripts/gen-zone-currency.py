#!/usr/bin/env python3
"""Generate ui/src/features/currency/zoneCurrency.js: IANA zone -> ISO 4217
currency, for the Currency page's "this trip's currencies".

A trip's places already carry their computed zone (api/app/zones.py), so the
page maps zone -> country (tzdata's zone.tab) -> currency (the table below).

Run from the repo root with the API's venv (it has tzdata):
    api/.venv/bin/python scripts/gen-zone-currency.py

Re-run when tzdata adds zones; edit COUNTRY_CURRENCY when a country changes
currency.
"""

from __future__ import annotations

import importlib.resources
import json
from pathlib import Path

# ISO 3166 alpha-2 -> ISO 4217. Territories using another country's currency
# are listed with it.
# fmt: off
COUNTRY_CURRENCY = {
    "AD": "EUR", "AE": "AED", "AF": "AFN", "AG": "XCD", "AI": "XCD", "AL": "ALL",
    "AM": "AMD", "AO": "AOA", "AQ": "USD", "AR": "ARS", "AS": "USD", "AT": "EUR",
    "AU": "AUD", "AW": "AWG", "AX": "EUR", "AZ": "AZN", "BA": "BAM", "BB": "BBD",
    "BD": "BDT", "BE": "EUR", "BF": "XOF", "BG": "BGN", "BH": "BHD", "BI": "BIF",
    "BJ": "XOF", "BL": "EUR", "BM": "BMD", "BN": "BND", "BO": "BOB", "BQ": "USD",
    "BR": "BRL", "BS": "BSD", "BT": "BTN", "BW": "BWP", "BY": "BYN", "BZ": "BZD",
    "CA": "CAD", "CC": "AUD", "CD": "CDF", "CF": "XAF", "CG": "XAF", "CH": "CHF",
    "CI": "XOF", "CK": "NZD", "CL": "CLP", "CM": "XAF", "CN": "CNY", "CO": "COP",
    "CR": "CRC", "CU": "CUP", "CV": "CVE", "CW": "ANG", "CX": "AUD", "CY": "EUR",
    "CZ": "CZK", "DE": "EUR", "DJ": "DJF", "DK": "DKK", "DM": "XCD", "DO": "DOP",
    "DZ": "DZD", "EC": "USD", "EE": "EUR", "EG": "EGP", "EH": "MAD", "ER": "ERN",
    "ES": "EUR", "ET": "ETB", "FI": "EUR", "FJ": "FJD", "FK": "FKP", "FM": "USD",
    "FO": "DKK", "FR": "EUR", "GA": "XAF", "GB": "GBP", "GD": "XCD", "GE": "GEL",
    "GF": "EUR", "GG": "GBP", "GH": "GHS", "GI": "GIP", "GL": "DKK", "GM": "GMD",
    "GN": "GNF", "GP": "EUR", "GQ": "XAF", "GR": "EUR", "GS": "GBP", "GT": "GTQ",
    "GU": "USD", "GW": "XOF", "GY": "GYD", "HK": "HKD", "HN": "HNL", "HR": "EUR",
    "HT": "HTG", "HU": "HUF", "ID": "IDR", "IE": "EUR", "IL": "ILS", "IM": "GBP",
    "IN": "INR", "IO": "USD", "IQ": "IQD", "IR": "IRR", "IS": "ISK", "IT": "EUR",
    "JE": "GBP", "JM": "JMD", "JO": "JOD", "JP": "JPY", "KE": "KES", "KG": "KGS",
    "KH": "KHR", "KI": "AUD", "KM": "KMF", "KN": "XCD", "KP": "KPW", "KR": "KRW",
    "KW": "KWD", "KY": "KYD", "KZ": "KZT", "LA": "LAK", "LB": "LBP", "LC": "XCD",
    "LI": "CHF", "LK": "LKR", "LR": "LRD", "LS": "LSL", "LT": "EUR", "LU": "EUR",
    "LV": "EUR", "LY": "LYD", "MA": "MAD", "MC": "EUR", "MD": "MDL", "ME": "EUR",
    "MF": "EUR", "MG": "MGA", "MH": "USD", "MK": "MKD", "ML": "XOF", "MM": "MMK",
    "MN": "MNT", "MO": "MOP", "MP": "USD", "MQ": "EUR", "MR": "MRU", "MS": "XCD",
    "MT": "EUR", "MU": "MUR", "MV": "MVR", "MW": "MWK", "MX": "MXN", "MY": "MYR",
    "MZ": "MZN", "NA": "NAD", "NC": "XPF", "NE": "XOF", "NF": "AUD", "NG": "NGN",
    "NI": "NIO", "NL": "EUR", "NO": "NOK", "NP": "NPR", "NR": "AUD", "NU": "NZD",
    "NZ": "NZD", "OM": "OMR", "PA": "PAB", "PE": "PEN", "PF": "XPF", "PG": "PGK",
    "PH": "PHP", "PK": "PKR", "PL": "PLN", "PM": "EUR", "PN": "NZD", "PR": "USD",
    "PS": "ILS", "PT": "EUR", "PW": "USD", "PY": "PYG", "QA": "QAR", "RE": "EUR",
    "RO": "RON", "RS": "RSD", "RU": "RUB", "RW": "RWF", "SA": "SAR", "SB": "SBD",
    "SC": "SCR", "SD": "SDG", "SE": "SEK", "SG": "SGD", "SH": "SHP", "SI": "EUR",
    "SJ": "NOK", "SK": "EUR", "SL": "SLE", "SM": "EUR", "SN": "XOF", "SO": "SOS",
    "SR": "SRD", "SS": "SSP", "ST": "STN", "SV": "USD", "SX": "ANG", "SY": "SYP",
    "SZ": "SZL", "TC": "USD", "TD": "XAF", "TF": "EUR", "TG": "XOF", "TH": "THB",
    "TJ": "TJS", "TK": "NZD", "TL": "USD", "TM": "TMT", "TN": "TND", "TO": "TOP",
    "TR": "TRY", "TT": "TTD", "TV": "AUD", "TW": "TWD", "TZ": "TZS", "UA": "UAH",
    "UG": "UGX", "UM": "USD", "US": "USD", "UY": "UYU", "UZ": "UZS", "VA": "EUR",
    "VC": "XCD", "VE": "VES", "VG": "USD", "VI": "USD", "VN": "VND", "VU": "VUV",
    "WF": "XPF", "WS": "WST", "YE": "YER", "YT": "EUR", "ZA": "ZAR", "ZM": "ZMW",
    "ZW": "ZWL",
}
# fmt: on

OUT = (
    Path(__file__).resolve().parents[1]
    / "ui"
    / "src"
    / "features"
    / "currency"
    / "zoneCurrency.js"
)


def zone_countries() -> dict[str, str]:
    """zone -> the first country zone.tab lists for it."""
    text = importlib.resources.files("tzdata.zoneinfo").joinpath("zone.tab").read_text()
    zones: dict[str, str] = {}
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        country, _coords, zone, *_ = line.split("\t")
        zones.setdefault(zone, country)
    return zones


def main() -> None:
    table = {
        zone: COUNTRY_CURRENCY[country]
        for zone, country in sorted(zone_countries().items())
        if country in COUNTRY_CURRENCY
    }
    body = json.dumps(table, indent=2, sort_keys=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// Generated by scripts/gen-zone-currency.py from tzdata's zone.tab — don't edit by hand.\n"
        "// IANA zone -> the ISO 4217 currency used there.\n"
        f"export const ZONE_CURRENCY = {body};\n"
    )
    print(f"wrote {len(table)} zones to {OUT}")


if __name__ == "__main__":
    main()
