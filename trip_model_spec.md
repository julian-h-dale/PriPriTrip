# Travel Timeline App Data Model

This document describes a JSON-based data model for a travel timeline app. The model is designed to support a timeline-first UI with expandable and collapsible sections, such as a top-level city section that expands into day-by-day plans and individual itinerary items.

The main modeling choice is to keep the trip items in a flat array while using `parentItemId` to represent hierarchy. This gives the UI tree-like behavior without requiring deeply nested recursive JSON as the source of truth.

---

## JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Trip Timeline Model",
  "type": "object",
  "required": [
    "tripId",
    "tripName",
    "startDate",
    "endDate",
    "items"
  ],
  "properties": {
    "tripId": {
      "type": "string",
      "description": "Unique identifier for the trip."
    },
    "tripName": {
      "type": "string",
      "description": "Human-readable name of the trip."
    },
    "startDate": {
      "type": "string",
      "format": "date",
      "description": "Trip start date in ISO 8601 date format."
    },
    "endDate": {
      "type": "string",
      "format": "date",
      "description": "Trip end date in ISO 8601 date format."
    },
    "documents": {
      "type": "array",
      "description": "Trip-level documents such as flight confirmations, hotel bookings, or travel insurance.",
      "items": {
        "$ref": "#/$defs/document"
      },
      "default": []
    },
    "items": {
      "type": "array",
      "description": "Flat list of groups and itinerary legs. Hierarchy is represented with parentItemId.",
      "items": {
        "$ref": "#/$defs/tripItem"
      }
    }
  },
  "$defs": {
    "document": {
      "type": "object",
      "required": [
        "url",
        "name"
      ],
      "properties": {
        "url": {
          "type": "string",
          "format": "uri"
        },
        "name": {
          "type": "string"
        },
        "description": {
          "type": "string"
        }
      }
    },
    "tripItem": {
      "type": "object",
      "required": [
        "itemId",
        "kind",
        "title",
        "startDateTime",
        "endDateTime",
        "parentItemId",
        "sortOrder"
      ],
      "properties": {
        "itemId": {
          "type": "string",
          "description": "Unique identifier for this timeline item."
        },
        "parentItemId": {
          "type": [
            "string",
            "null"
          ],
          "description": "The parent timeline item. Null means this item is top-level."
        },
        "kind": {
          "type": "string",
          "enum": [
            "group",
            "leg"
          ],
          "description": "Whether this item is a UI grouping container or an actual itinerary leg."
        },
        "title": {
          "type": "string"
        },
        "startDateTime": {
          "type": "string",
          "format": "date-time"
        },
        "endDateTime": {
          "type": "string",
          "format": "date-time"
        },
        "sortOrder": {
          "type": "integer",
          "minimum": 1,
          "description": "Manual ordering value within a parent group."
        },
        "type": {
          "type": [
            "string",
            "null"
          ],
          "enum": [
            "travel",
            "stay",
            "activity",
            null
          ],
          "description": "Travel meaning of the item. Usually null for groups."
        },
        "subtype": {
          "type": [
            "string",
            "null"
          ],
          "description": "More specific classification of the item."
        },
        "confirmationNumber": {
          "type": [
            "string",
            "null"
          ],
          "description": "Reservation or booking confirmation number. Used by leg items for flights, hotels, and other reservations."
        },
        "description": {
          "type": "string"
        },
        "imageUrl": {
          "type": "string"
        },
        "logoUrl": {
          "type": "string"
        },
        "locations": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/location"
          },
          "default": []
        },
        "documents": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/document"
          },
          "default": []
        },
        "completed": {
          "type": "boolean",
          "default": false
        },
        "completedDateTime": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "kind": {
                "const": "leg"
              }
            }
          },
          "then": {
            "required": [
              "type",
              "subtype",
              "locations",
              "completed"
            ]
          }
        }
      ]
    },
    "location": {
      "type": "object",
      "required": [
        "name"
      ],
      "properties": {
        "lat": {
          "type": [
            "number",
            "null"
          ]
        },
        "long": {
          "type": [
            "number",
            "null"
          ]
        },
        "fullAddress": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "link": {
          "type": "string"
        }
      }
    }
  }
}
```

---

## Example Data

```json
{
  "tripId": "trip_001",
  "tripName": "Switzerland and Croatia Honeymoon",
  "startDate": "2026-05-10",
  "endDate": "2026-05-20",
  "documents": [
    {
      "url": "https://example.com/flight-confirmation",
      "name": "Flight Confirmation",
      "description": "Round-trip flight details between Chicago and Zurich."
    },
    {
      "url": "https://example.com/travel-insurance",
      "name": "Travel Insurance",
      "description": "Trip insurance policy and emergency contact information."
    }
  ],
  "items": [
    {
      "itemId": "bern",
      "parentItemId": null,
      "kind": "group",
      "title": "Bern",
      "startDateTime": "2026-05-11T14:00:00+02:00",
      "endDateTime": "2026-05-13T10:00:00+02:00",
      "sortOrder": 1,
      "type": null,
      "subtype": null,
      "description": "First stop in Switzerland before heading into the Alps.",
      "imageUrl": "",
      "logoUrl": "",
      "locations": [
        {
          "lat": 46.948,
          "long": 7.4474,
          "fullAddress": "Bern, Switzerland",
          "name": "Bern",
          "description": "Swiss capital and old town base.",
          "link": ""
        }
      ],
      "documents": [],
      "completed": false,
      "completedDateTime": null
    },
    {
      "itemId": "zurich_to_bern_train",
      "parentItemId": "bern",
      "kind": "leg",
      "title": "Train from Zurich Airport to Bern",
      "startDateTime": "2026-05-11T12:15:00+02:00",
      "endDateTime": "2026-05-11T13:45:00+02:00",
      "sortOrder": 1,
      "type": "travel",
      "subtype": "train",
      "description": "Rail connection from Zurich Airport to Bern after arrival.",
      "imageUrl": "",
      "logoUrl": "",
      "locations": [
        {
          "lat": 47.4581,
          "long": 8.5555,
          "fullAddress": "Zurich Airport, Switzerland",
          "name": "Zurich Airport Station",
          "description": "",
          "link": ""
        },
        {
          "lat": 46.9489,
          "long": 7.4391,
          "fullAddress": "Bahnhofplatz 10A, 3011 Bern, Switzerland",
          "name": "Bern Station",
          "description": "",
          "link": ""
        }
      ],
      "documents": [],
      "completed": false,
      "completedDateTime": null,
      "confirmationNumber": null
    },
    {
      "itemId": "bern_hotel_checkin",
      "parentItemId": "bern",
      "kind": "leg",
      "title": "Check in at Goldener Hotel",
      "startDateTime": "2026-05-11T14:00:00+02:00",
      "endDateTime": "2026-05-11T15:00:00+02:00",
      "sortOrder": 2,
      "type": "stay",
      "subtype": "hotel",
      "description": "Drop bags and settle in before exploring Bern.",
      "imageUrl": "",
      "logoUrl": "",
      "locations": [
        {
          "lat": null,
          "long": null,
          "fullAddress": "",
          "name": "Goldener Hotel",
          "description": "Bern hotel stay.",
          "link": ""
        }
      ],
      "documents": [
        {
          "url": "https://example.com/bern-hotel-booking",
          "name": "Bern Hotel Booking",
          "description": "Hotel reservation details for Bern."
        }
      ],
      "completed": false,
      "completedDateTime": null,
      "confirmationNumber": null
    },
    {
      "itemId": "bern_old_town_walk",
      "parentItemId": "bern",
      "kind": "leg",
      "title": "Bern Old Town walk",
      "startDateTime": "2026-05-11T17:00:00+02:00",
      "endDateTime": "2026-05-11T19:00:00+02:00",
      "sortOrder": 3,
      "type": "activity",
      "subtype": "walk",
      "description": "Casual evening stroll through Bern Old Town before dinner.",
      "imageUrl": "",
      "logoUrl": "",
      "locations": [
        {
          "lat": 46.948,
          "long": 7.4474,
          "fullAddress": "Old City, Bern, Switzerland",
          "name": "Bern Old Town",
          "description": "",
          "link": ""
        }
      ],
      "documents": [],
      "completed": false,
      "completedDateTime": null,
      "confirmationNumber": null
    },
    {
      "itemId": "watch_museum_visit",
      "parentItemId": "bern",
      "kind": "leg",
      "title": "International Watch Museum",
      "startDateTime": "2026-05-12T11:00:00+02:00",
      "endDateTime": "2026-05-12T13:00:00+02:00",
      "sortOrder": 4,
      "type": "activity",
      "subtype": "museum",
      "description": "Visit the watch museum in La Chaux-de-Fonds.",
      "imageUrl": "",
      "logoUrl": "",
      "locations": [
        {
          "lat": 47.1035,
          "long": 6.8328,
          "fullAddress": "La Chaux-de-Fonds, Switzerland",
          "name": "International Watch Museum",
          "description": "",
          "link": ""
        }
      ],
      "documents": [],
      "completed": false,
      "completedDateTime": null,
      "confirmationNumber": null
    },
    {
      "itemId": "wengen",
      "parentItemId": null,
      "kind": "group",
      "title": "Wengen",
      "startDateTime": "2026-05-13T14:00:00+02:00",
      "endDateTime": "2026-05-15T10:00:00+02:00",
      "sortOrder": 2,
      "type": null,
      "subtype": null,
      "description": "Alpine stay in the Jungfrau region.",
      "imageUrl": "",
      "logoUrl": "",
      "locations": [
        {
          "lat": 46.6056,
          "long": 7.9203,
          "fullAddress": "Wengen, Switzerland",
          "name": "Wengen",
          "description": "Mountain village base.",
          "link": ""
        }
      ],
      "documents": [],
      "completed": false,
      "completedDateTime": null
    },
    {
      "itemId": "bern_to_wengen_train",
      "parentItemId": "wengen",
      "kind": "leg",
      "title": "Train to Wengen",
      "startDateTime": "2026-05-13T12:00:00+02:00",
      "endDateTime": "2026-05-13T13:45:00+02:00",
      "sortOrder": 1,
      "type": "travel",
      "subtype": "train",
      "description": "Train from Bern to Lauterbrunnen, then cog railway up to Wengen.",
      "imageUrl": "",
      "logoUrl": "",
      "locations": [
        {
          "lat": 46.9489,
          "long": 7.4391,
          "fullAddress": "Bern Station",
          "name": "Bern Station",
          "description": "",
          "link": ""
        },
        {
          "lat": 46.6056,
          "long": 7.9203,
          "fullAddress": "Wengen, Switzerland",
          "name": "Wengen Station",
          "description": "",
          "link": ""
        }
      ],
      "documents": [],
      "completed": false,
      "completedDateTime": null,
      "confirmationNumber": null
    },
    {
      "itemId": "wengen_hotel_checkin",
      "parentItemId": "wengen",
      "kind": "leg",
      "title": "Check in at Hotel Beausite",
      "startDateTime": "2026-05-13T14:00:00+02:00",
      "endDateTime": "2026-05-13T15:00:00+02:00",
      "sortOrder": 2,
      "type": "stay",
      "subtype": "hotel",
      "description": "Alpine hotel with Jungfrau views.",
      "imageUrl": "",
      "logoUrl": "",
      "locations": [
        {
          "lat": 46.6056,
          "long": 7.9203,
          "fullAddress": "Hotel Beausite, Wengen, Switzerland",
          "name": "Hotel Beausite",
          "description": "",
          "link": ""
        }
      ],
      "documents": [],
      "completed": false,
      "completedDateTime": null,
      "confirmationNumber": null
    },
    {
      "itemId": "jungfraujoch",
      "parentItemId": "wengen",
      "kind": "leg",
      "title": "Jungfraujoch day trip",
      "startDateTime": "2026-05-14T08:30:00+02:00",
      "endDateTime": "2026-05-14T16:00:00+02:00",
      "sortOrder": 3,
      "type": "activity",
      "subtype": "tour",
      "description": "Day trip to the Top of Europe at 3,454 m.",
      "imageUrl": "",
      "logoUrl": "",
      "locations": [
        {
          "lat": 46.5475,
          "long": 7.9852,
          "fullAddress": "Jungfraujoch, Switzerland",
          "name": "Jungfraujoch",
          "description": "Highest railway station in Europe.",
          "link": ""
        }
      ],
      "documents": [],
      "completed": false,
      "completedDateTime": null,
      "confirmationNumber": null
    }
  ]
}
```

---

## Model Explanation

### Core idea

The trip is modeled as a timeline made of `items`. Each item is either a `group` or a `leg`.

A `group` is used for organization in the UI. Examples include:

- Bern
- Wengen
- Hvar
- May 11 — Arrival Day
- Travel Day
- Food Day

A `leg` is an actual itinerary item. Examples include:

- Flight from Chicago to Zurich
- Train from Zurich Airport to Bern
- Hotel check-in
- Museum visit
- Dinner reservation
- Scenic walk

### Why this model is not fully recursive

Instead of nesting child items directly inside parent items, every item lives in one flat array. Hierarchy is created with `parentItemId`.

For example:

```json
{
  "itemId": "zurich_to_bern_train",
  "parentItemId": "bern"
}
```

This means `zurich_to_bern_train` is a child of `bern`.

This is easier to:

- persist in a database
- reorder
- filter
- search
- sync
- update from the UI
- render as either a flat timeline or nested tree

### Ordering strategy

Items should be ordered first by their parent group, then by `sortOrder`, and then by `startDateTime` as a fallback.

Recommended display logic:

1. Find top-level items where `parentItemId` is `null`.
2. Sort them by `sortOrder`.
3. For each item, find children where `parentItemId` equals the current `itemId`.
4. Sort children by `sortOrder`.
5. Render recursively in the UI, even though the data is stored flat.

### `kind` vs `type`

The model intentionally separates `kind` and `type`.

`kind` tells the app what the item is structurally.

`type` tells the app what the item means in travel terms.

Examples:

```json
{
  "kind": "group",
  "type": null,
  "title": "Bern"
}
```

```json
{
  "kind": "leg",
  "type": "travel",
  "subtype": "train",
  "title": "Train from Zurich Airport to Bern"
}
```

This keeps the UI organization separate from the travel semantics.

---

## Item Kinds

| Kind key | Description |
|---|---|
| `group` | A UI organization container used for sections such as cities, days, or trip phases. |
| `leg` | An actual itinerary item with travel meaning, timing, locations, and completion status. |

---

## Top-Level Types

| Type key | Description |
|---|---|
| `travel` | Movement from one place to another, such as a flight, train, ferry, walk, or car ride. |
| `stay` | Lodging or overnight accommodation, such as a hotel, Airbnb, apartment, or resort. |
| `activity` | Something the traveler does, such as a museum visit, meal, tour, hike, show, or reservation. |

---

## Travel Subtypes

| Subtype key | Description |
|---|---|
| `flight` | Air travel between airports. |
| `train` | Rail travel between stations or cities. |
| `bus` | Bus or coach travel. |
| `ferry` | Boat or ferry travel, often between islands or coastal cities. |
| `car` | Travel by personal car, rental car, or private driver. |
| `taxi` | Taxi ride or rideshare-style transfer. |
| `rideshare` | App-based ride such as Uber, Lyft, Bolt, or similar. |
| `walk` | Walking route between locations. |
| `bike` | Bicycle travel or bike rental segment. |
| `metro` | Subway, underground, tram, or local urban rail segment. |
| `transfer` | Generic connection or transfer between travel modes. |
| `other_travel` | Travel item that does not fit another travel subtype. |

---

## Stay Subtypes

| Subtype key | Description |
|---|---|
| `hotel` | Hotel stay. |
| `airbnb` | Airbnb or short-term rental stay. |
| `apartment` | Apartment stay, serviced apartment, or longer-term rental. |
| `resort` | Resort stay with property-based amenities. |
| `hostel` | Hostel or shared lodging stay. |
| `guesthouse` | Guesthouse, inn, pension, or small lodging property. |
| `camping` | Campsite, glamping, or outdoor overnight stay. |
| `overnight_transport` | Overnight train, ferry, or sleeper travel that also functions as lodging. |
| `other_stay` | Stay item that does not fit another stay subtype. |

---

## Activity Subtypes

| Subtype key | Description |
|---|---|
| `restaurant` | Meal reservation or planned restaurant visit. |
| `cafe` | Coffee, cafe, bakery, or casual snack stop. |
| `bar` | Bar, cocktail lounge, brewery, or nightlife stop. |
| `museum` | Museum, gallery, or cultural institution visit. |
| `tour` | Guided tour, private tour, or structured experience. |
| `sightseeing` | Landmark, viewpoint, old town, or general sightseeing stop. |
| `hike` | Hiking or nature trail activity. |
| `beach` | Beach time, swimming, or coastal relaxation. |
| `shopping` | Shopping stop, market, boutique, or souvenir visit. |
| `event` | Scheduled event such as a concert, show, sports event, or festival. |
| `reservation` | Generic reservation that does not clearly fit another subtype. |
| `appointment` | Timed appointment, service booking, or required check-in. |
| `free_time` | Open time intentionally left flexible. |
| `other_activity` | Activity item that does not fit another activity subtype. |

---

## Recommended UI Direction

For a React app, use **MUI X Tree View** for the expandable and collapsible timeline hierarchy. It pairs well with MUI, supports nested tree structures, and fits this model naturally because the flat `items` array can be transformed into a tree at render time.
