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
}
_ATH = {
    "name": "Athens Eleftherios Venizelos (ATH)",
    "city": "Athens",
    "lat": 37.9364,
    "lng": 23.9445,
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
                "from": {"name": "Athens Airport", "city": "Athens"},
                "to": {"name": "Syntagma", "city": "Athens"},
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
                },
                "to": {"name": "Hydra Port", "city": "Hydra", "lat": 37.3477, "lng": 23.4650},
                "depart": at(5, "08:00"),
                "arrive": at(5, "10:15"),
                "confirmationNumber": "DEMO-HYD552",
                "notes": "Arrive 30 minutes early. Seats are unassigned.",
            },
            {
                "title": "Hydra → Athens",
                "mode": "ferry",
                "carrier": "Hellenic Seaways",
                "from": {"name": "Hydra Port", "city": "Hydra", "lat": 37.3477, "lng": 23.4650},
                "to": {
                    "name": "Piraeus Port",
                    "city": "Piraeus",
                    "lat": 37.9381,
                    "lng": 23.6469,
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
