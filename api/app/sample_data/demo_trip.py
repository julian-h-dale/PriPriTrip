"""The demo trip: Chicago to Athens, built around today's date.

Unlike `sample_trip.json` (fixed dates, a test fixture), this trip is generated
relative to the day the seed runs, so the demo always has a *current* trip: it
started two days ago and ends five days from now.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

DEMO_TRIP_NAME = "Athens Getaway"

_ORD = {
    "name": "Chicago O'Hare (ORD)",
    "city": "Chicago",
    "lat": 41.9786,
    "lng": -87.9048,
    "placeId": "ChIJ82J3aie0D4gRS61ZAgdHF1E",
    "imgRef": "https://lh3.googleusercontent.com/place-photos/AO7kbWF6iQFAyanx_j8T-mNK1DA05gWJ80aA2jq775slMJHvVfBUqjbuz4YKfpKCMxbEnWxlBLhLGAH1Uc1tlz-A0lNgM34jmWHe8QcWYYMlhzz4MQMk4du0u8NX-MAV32qux-EWJ4jC7jAZtYK7=s4800-w800",
}
_ATH = {
    "name": "Athens Eleftherios Venizelos (ATH)",
    "city": "Athens",
    "lat": 37.9364,
    "lng": 23.9445,
    "placeId": "ChIJYVzn2RqQoRQRqrPuCt8Vsjg",
    "imgRef": "https://lh3.googleusercontent.com/grass-cs/AABkmLfrEUtq6byu3HJ4m5XkzDEKD1BppFpjkOiGGK0MoUAx4j6fgL9Okr5ijCr_1nXoWXvEiZIGbs5KT2lbU2QkUcX47WM5yf8PWySHoA8A_bft4u921wt1-v2D2zK6QP4bI3J5W_ERtQ=s4800-w800",
}


def build_demo_trip(today: date | None = None) -> dict[str, Any]:
    """A fresh trip document whose middle (day 3 of 8) is `today`."""
    today = today or date.today()
    start = today - timedelta(days=2)
    end = today + timedelta(days=5)

    def d(offset: int) -> date:
        return start + timedelta(days=offset)

    def at(offset: int, hhmm: str) -> str:
        return f"{d(offset).isoformat()}T{hhmm}"

    return {
        "schemaVersion": 1,
        "name": DEMO_TRIP_NAME,
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "timezone": "Europe/Athens",
        "stays": [
            {
                "name": "Plaka Boutique Hotel",
                "type": "hotel",
                "checkIn": at(1, "14:00"),
                "checkOut": at(7, "11:00"),
                "location": {
                    "name": "Plaka Boutique Hotel",
                    "address": "Adrianou 74, Athens 105 55, Greece",
                    "city": "Athens",
                    "lat": 37.9744,
                    "lng": 23.7299,
                    "placeId": "ChIJybmoKD29oRQRb2lA_IVA-zE",
                    "imgRef": "https://lh3.googleusercontent.com/place-photos/AO7kbWFOyY2kvO9Wfaqkj18Q951q7Ydg5E1r-fKdSJ1WpP2nWb8M5krWi7Eae2fIQtBtiH5nIgF5w0Mhr2YnVbp38UCtAVgBS5WVlDkcEn6VXLnVgaOtLquaSOBtXpC9j0b0hlJWSE_mmcrX9Tdt=s4800-w800",
                },
                "roomType": "Double, Acropolis view",
                "confirmationNumber": "DEMO-PLK4821",
                "notes": "Rooftop breakfast with a view of the **Acropolis**. Early check-in "
                "isn't guaranteed, so they'll hold bags.",
            }
        ],
        "travels": [
            {
                "title": "Chicago → Athens",
                "mode": "flight",
                "carrier": "Aegean Airlines",
                "number": "A3 7",
                "seat": "31K",
                "from": _ORD,
                "to": _ATH,
                "depart": at(0, "17:30"),
                "departTimezone": "America/Chicago",
                "arrive": at(1, "12:10"),
                "arriveTimezone": "Europe/Athens",
                "confirmationNumber": "DEMO-ATH7QK",
                "notes": "Overnight flight. Get the **Athens metro** ticket on arrival.",
            },
            {
                "title": "Athens Airport → Plaka",
                "mode": "train",
                "carrier": "Athens Metro",
                "number": "Line 3",
                "from": {
                    "name": "Athens Airport",
                    "city": "Athens",
                    "placeId": "ChIJYVzn2RqQoRQRqrPuCt8Vsjg",
                    "imgRef": "https://lh3.googleusercontent.com/grass-cs/AABkmLfrEUtq6byu3HJ4m5XkzDEKD1BppFpjkOiGGK0MoUAx4j6fgL9Okr5ijCr_1nXoWXvEiZIGbs5KT2lbU2QkUcX47WM5yf8PWySHoA8A_bft4u921wt1-v2D2zK6QP4bI3J5W_ERtQ=s4800-w800",
                },
                "to": {
                    "name": "Syntagma",
                    "city": "Athens",
                    "placeId": "ChIJNQRIkj69oRQRDlYNy1cQumg",
                    "imgRef": "https://lh3.googleusercontent.com/grass-cs/AABkmLdj5nwurCjaCXDDusk3mwxaFOKFtoGyoXKff4LPfA8vwlJ5s5vJFLy4dwG7JeIyMfIIIw9Xm6CgZl5e5S8Ts_ZT8xUxfmESnVwm4CXbaTnAmU62ydrIEU9NhTF19if62PSXbcY=s4800-w800",
                },
                "depart": at(1, "13:05"),
                "arrive": at(1, "14:00"),
            },
            {
                "title": "Athens → Hydra",
                "mode": "ferry",
                "carrier": "Hellenic Seaways",
                "from": {
                    "name": "Piraeus Port",
                    "city": "Piraeus",
                    "lat": 37.9381,
                    "lng": 23.6469,
                    "placeId": "ChIJYSYNb9q7oRQR2l1T5IyBtV8",
                    "imgRef": "https://lh3.googleusercontent.com/grass-cs/AABkmLdtDzMrvdlVwMP7oOwrV9ZuZrcGtOFWIhx_rZi_JBZhm3nqpxihg9dn5wOj_YnZNt4dGLSKBjE9L6ZQCGVfL7LNkLRAjjVqkFOJgA_Vzs09HMH9FtQX3NDB7gySQGRvFrH1QjkKzp4SR160=s4800-w800",
                },
                "to": {
                    "name": "Hydra Port",
                    "city": "Hydra",
                    "lat": 37.3477,
                    "lng": 23.4650,
                    "placeId": "ChIJF34_Vbx3nxQRYPU2tzGyrIc",
                    "imgRef": "https://lh3.googleusercontent.com/place-photos/AO7kbWFYxlSVGJzgYWT-F99QiCRfIrgVZbncJaw0ftKGKRTM-blHENbt7AZ8ibeDGtaTgnjlV_pdjav7ieoqeV9L1YYeyduc4vwtL3foRpyLl6oF8Cs6FnEeNuMjzoCYBU0Cl1O1KI4Cd-6By6ewew=s4800-w800",
                },
                "depart": at(5, "08:00"),
                "arrive": at(5, "10:15"),
                "confirmationNumber": "DEMO-HYD552",
                "notes": "Arrive 30 minutes early. Seats are unassigned.",
            },
            {
                "title": "Hydra → Athens",
                "mode": "ferry",
                "carrier": "Hellenic Seaways",
                "from": {
                    "name": "Hydra Port",
                    "city": "Hydra",
                    "lat": 37.3477,
                    "lng": 23.4650,
                    "placeId": "ChIJF34_Vbx3nxQRYPU2tzGyrIc",
                    "imgRef": "https://lh3.googleusercontent.com/place-photos/AO7kbWFYxlSVGJzgYWT-F99QiCRfIrgVZbncJaw0ftKGKRTM-blHENbt7AZ8ibeDGtaTgnjlV_pdjav7ieoqeV9L1YYeyduc4vwtL3foRpyLl6oF8Cs6FnEeNuMjzoCYBU0Cl1O1KI4Cd-6By6ewew=s4800-w800",
                },
                "to": {
                    "name": "Piraeus Port",
                    "city": "Piraeus",
                    "lat": 37.9381,
                    "lng": 23.6469,
                    "placeId": "ChIJYSYNb9q7oRQR2l1T5IyBtV8",
                    "imgRef": "https://lh3.googleusercontent.com/grass-cs/AABkmLdtDzMrvdlVwMP7oOwrV9ZuZrcGtOFWIhx_rZi_JBZhm3nqpxihg9dn5wOj_YnZNt4dGLSKBjE9L6ZQCGVfL7LNkLRAjjVqkFOJgA_Vzs09HMH9FtQX3NDB7gySQGRvFrH1QjkKzp4SR160=s4800-w800",
                },
                "depart": at(5, "17:30"),
                "arrive": at(5, "19:45"),
            },
            {
                "title": "Athens → Chicago",
                "mode": "flight",
                "carrier": "Aegean Airlines",
                "number": "A3 8",
                "from": _ATH,
                "to": _ORD,
                "depart": at(7, "14:20"),
                "departTimezone": "Europe/Athens",
                "arrive": at(7, "18:05"),
                "arriveTimezone": "America/Chicago",
                "confirmationNumber": "DEMO-ATH7QK",
            },
        ],
        "days": [
            {
                "date": d(1).isoformat(),
                "title": "Touchdown in Athens",
                "summary": "Land, metro into town, and keep the evening easy.",
                "items": [
                    {
                        "title": "Sunset stroll through Anafiotika",
                        "start": at(1, "18:30"),
                        "end": at(1, "19:30"),
                        "location": {
                            "name": "Anafiotika",
                            "city": "Athens",
                            "lat": 37.9726,
                            "lng": 23.7298,
                            "placeId": "ChIJ1R5whRm9oRQRhlUhe3e_GQk",
                            "imgRef": "https://lh3.googleusercontent.com/grass-cs/ACvplmO6DPyeCA0JwqQhJnLPieaz7yxLHGRAIu2qYE3EtTkmWFT6LDIMG5_ZBP8gRjJcP_WcUHavV9miNgyz8Coxx7wjQteIXH466jRAaX4U0w3Q6MbdQSiAQpj5g2STXzdsRO13ek7q=s4800-w800",
                        },
                    },
                    {
                        "title": "Dinner at Taverna Psarras",
                        "start": at(1, "20:30"),
                        "end": at(1, "22:30"),
                        "location": {
                            "name": "Taverna Psarras",
                            "address": "Erechtheos 16, Athens 105 55, Greece",
                            "city": "Athens",
                            "lat": 37.9729,
                            "lng": 23.7297,
                            "placeId": "ChIJzST35Re9oRQRR705nXGNlhQ",
                            "imgRef": "https://lh3.googleusercontent.com/grass-cs/ACvplmOAPrH_wTIARGvTtC-Mmu0c6hqeHmR1YJOZMXgExNvWlJ2fpf6Em4OrxL2rhwpvnUxg9snyiwRfnehgusJZrsFsduO_4RdKtKO6pWmEo8oRZ1DlGCdEGRX64qlBBqizECvLwcfizg=s4800-w800",
                        },
                        "confirmationNumber": "Table for 2, 20:30",
                    },
                ],
            },
            {
                "date": d(2).isoformat(),
                "title": "Acropolis & the old city",
                "summary": "Beat the heat and the crowds: up the hill first, museum after.",
                "items": [
                    {
                        "title": "Acropolis",
                        "start": at(2, "08:30"),
                        "end": at(2, "11:00"),
                        "location": {
                            "name": "Acropolis of Athens",
                            "city": "Athens",
                            "lat": 37.9715,
                            "lng": 23.7257,
                            "placeId": "ChIJ86z1Nxi9oRQR9g3r9ULAl1w",
                            "imgRef": "https://lh3.googleusercontent.com/place-photos/AO7kbWEt8Fb6xBn4OyrOeT_q25iRSfCQf7AuiUG_u_VX6qUGSDz4Cub1J3w5J2ZwCyZ0Ied-SVf8Ey6ywi91ukBAgyGVwoJS1qDzyKvhnKndTTW5Tjn4M-y2DClWs2MgMFaBvK5uShcbh3YPO66u2nrpkwNDPQ=s4800-w800",
                        },
                        "confirmationNumber": "Timed entry 08:30",
                        "notes": "Bring water and **flat shoes**: the marble is slippery.",
                    },
                    {
                        "title": "Acropolis Museum",
                        "start": at(2, "11:30"),
                        "end": at(2, "13:30"),
                        "location": {
                            "name": "Acropolis Museum",
                            "city": "Athens",
                            "lat": 37.9684,
                            "lng": 23.7285,
                            "placeId": "ChIJ4eRGPxe9oRQRPAoBLGq0D7A",
                            "imgRef": "https://lh3.googleusercontent.com/place-photos/AO7kbWFR20Gwnykv1OYrGFSWzcaOkr-vwV-g_cOAEOdzGcvyPRA5KNxFbRDMjDjoJ7wNPXMxQdjS8rgGPSbpDe0GEm8gYXVqTczyUo30CTpcRhn83eN8Zcvln2PFsKnQe202VVD1RvBLn2T5cEU_A4o=s4800-w800",
                        },
                    },
                    {
                        "title": "Lunch in Monastiraki",
                        "start": at(2, "14:00"),
                        "end": at(2, "15:15"),
                        "location": {
                            "name": "Monastiraki Square",
                            "city": "Athens",
                            "lat": 37.9763,
                            "lng": 23.7255,
                            "placeId": "ChIJC4KLpD29oRQR7NaZJeLcuzE",
                            "imgRef": "https://lh3.googleusercontent.com/grass-cs/ACvplmN5fUpr752MwlpIZ5tz2p7gNkyb5vvPXNu73-iCFNnh9GNwgZC0-1O0rFr-fgr1bjTcaKQ5XGqJDLywrsWSwHQVBO3ZRbuBnJAPMCQbTODTD10nmbM9EDxj8HQKMi0R72po6OqZPtqW3-Ms=s4800-w800",
                        },
                    },
                    {"title": "Siesta at the hotel"},
                ],
            },
            {
                "date": d(3).isoformat(),
                "title": "Markets and Mount Lycabettus",
                "summary": "Food-focused day, finishing with the best view in the city.",
                "items": [
                    {
                        "title": "Varvakios Central Market",
                        "start": at(3, "10:00"),
                        "end": at(3, "11:30"),
                        "location": {
                            "name": "Athens Central Market",
                            "city": "Athens",
                            "lat": 37.9792,
                            "lng": 23.7260,
                            "placeId": "ChIJmxTsUSO9oRQRLUSSm2pGMTA",
                            "imgRef": "https://lh3.googleusercontent.com/grass-cs/AABkmLdTFeRhm0h9XAapuHDh66_NDnji3vuCIqA9Pu_zhBhVw9ON4w88X1EQl1b_CRYw6OdBMyzR3I32u99sDEP2Yf3Gzes2OYXcGD2Y5XPSmYQhei5OdGOWqRxlTSn9PSdrtNdUyqYoIA=s4800-w800",
                        },
                    },
                    {
                        "title": "Coffee and loukoumades",
                        "start": at(3, "12:00"),
                        "end": at(3, "13:00"),
                    },
                    {
                        "title": "Lycabettus Hill at sunset",
                        "start": at(3, "18:00"),
                        "end": at(3, "20:00"),
                        "location": {
                            "name": "Mount Lycabettus",
                            "city": "Athens",
                            "lat": 37.9819,
                            "lng": 23.7430,
                            "placeId": "ChIJkXWXEk69oRQRao7rDwGANWg",
                            "imgRef": "https://lh3.googleusercontent.com/grass-cs/ACvplmPKoN-eCpaVtyVqr0d642Gkr-RrZSHwQCK8sB9j2-E04Oorcyhb04H65czccsXqzQeypc2tbrehgFZCBo2Ylj2q3bsCYWT_-CMiQRc_ICs55swA9a_e22LuDAj0Ea4vXCfbDu3o=s4800-w800",
                        },
                        "notes": "Take the **funicular** up and walk down.",
                    },
                    {
                        "title": "Dinner in Kolonaki",
                        "start": at(3, "20:30"),
                        "end": at(3, "22:30"),
                    },
                ],
            },
            {
                "date": d(4).isoformat(),
                "title": "Delphi day trip",
                "summary": "Out to the oracle and back, about 2.5 hours each way.",
                "items": [
                    {
                        "title": "Pick up the rental car",
                        "start": at(4, "07:30"),
                        "end": at(4, "08:00"),
                    },
                    {
                        "title": "Archaeological Site of Delphi",
                        "start": at(4, "10:30"),
                        "end": at(4, "13:00"),
                        "location": {
                            "name": "Archaeological Site of Delphi",
                            "city": "Delphi",
                            "lat": 38.4824,
                            "lng": 22.5010,
                            "placeId": "ChIJ4XICju95XxMRlCAMyvLmqtA",
                            "imgRef": "https://lh3.googleusercontent.com/place-photos/AO7kbWGiV1wr0tawMqqYU-wndck0VI7oSX9QXJRY30ooNonKaQmQicA1xahxMU0g9TWVZKRMwhefAryS4pBiYoNWWUKIgH_7RIr4hYyscuWe4FUs5NxAWEYcsQS4jv7stiUHONwITnglw0b4gJj87Bosvdj3wA=s4800-w800",
                        },
                    },
                    {
                        "title": "Lunch in Arachova",
                        "start": at(4, "13:45"),
                        "end": at(4, "15:00"),
                        "location": {
                            "name": "Arachova",
                            "city": "Arachova",
                            "lat": 38.4817,
                            "lng": 22.5880,
                            "placeId": "ChIJCQEFiqV9XxMRcIS54iy9AAQ",
                            "imgRef": "https://lh3.googleusercontent.com/place-photos/AO7kbWGYAohUi3OmWYxcWFELRXKqdhUe-zJXV_FZcmfng6JoAQUAzF4UJIx_ZthtfQmId3FXUj_xxP5EhmDdl-VFu1dKBC3SmPDxSrndR2HZAaOXEMWS11dzy8_aD6_dX7An-Tni9SmYFKF2LwMP4c4=s4800-w800",
                        },
                    },
                ],
            },
            {
                "date": d(5).isoformat(),
                "title": "Hydra by ferry",
                "summary": "No cars on the island: walk, swim, and take the late boat back.",
                "items": [
                    {
                        "title": "Swim at Spilia",
                        "start": at(5, "11:30"),
                        "end": at(5, "13:30"),
                        "location": {
                            "name": "Spilia Beach",
                            "city": "Hydra",
                            "lat": 37.3490,
                            "lng": 23.4620,
                            "placeId": "ChIJjW1XxsV2nxQRjMRTlwOki-I",
                            "imgRef": "https://lh3.googleusercontent.com/grass-cs/AABkmLe-ediFWVGOJS4NwzlMFb7xfLBCE__1LevEsypxOXuP7QKCePwAoCNkbFZM-w7vc7y8Qz9D16RnSA5hPBWBxcM8erosGWegxThfxDsett0TptAY7tDOJy4HLHiS9MVwu_f97ZSS=s4800-w800",
                        },
                    },
                    {
                        "title": "Lunch by the harbour",
                        "start": at(5, "14:00"),
                        "end": at(5, "15:30"),
                    },
                ],
            },
            {
                "date": d(6).isoformat(),
                "title": "Last full day",
                "summary": "Slow morning, souvenirs, and a farewell dinner.",
                "items": [
                    {"title": "Souvenir shopping on Ermou Street"},
                    {
                        "title": "Farewell dinner",
                        "start": at(6, "20:00"),
                        "end": at(6, "22:00"),
                        "notes": "Book somewhere with a view of the Acropolis lit up.",
                    },
                ],
            },
        ],
    }
