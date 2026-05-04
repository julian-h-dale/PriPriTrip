#!/usr/bin/env python3
"""
Enrich location objects in data/trip.json with Google Places API data.

For each location, queries the Places API using fullAddress (or name as fallback)
and updates the location object with:
  - fullAddress  → replaced with the API's formattedAddress
  - location     → { latitude, longitude } (replaces old top-level lat/long)
  - googlePlaceId
  - googleMapsUri

Usage:
    MAPS_API_KEY=<your_key> python3 enrich_locations.py [--dry-run]

Options:
    --dry-run   Print what would be changed without writing to trip.json
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error

PLACES_API_URL = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = "places.id,places.formattedAddress,places.location,places.googleMapsUri"
TRIP_JSON_PATH = "data/trip.json"


def lookup_place(api_key: str, query: str) -> dict | None:
    payload = json.dumps({"textQuery": query}).encode("utf-8")
    req = urllib.request.Request(
        PLACES_API_URL,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": api_key,
            "X-Goog-FieldMask": FIELD_MASK,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            places = data.get("places", [])
            return places[0] if places else None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"    HTTP {e.code}: {body[:200]}")
        return None
    except Exception as e:
        print(f"    Error: {e}")
        return None


def enrich_location(loc: dict, place: dict) -> dict:
    """Return an updated copy of loc with Places API data applied."""
    updated = dict(loc)

    if "formattedAddress" in place:
        updated["fullAddress"] = place["formattedAddress"]

    # Replace old top-level lat/long with a nested location object
    updated.pop("lat", None)
    updated.pop("long", None)
    if "location" in place:
        updated["location"] = {
            "latitude": place["location"].get("latitude"),
            "longitude": place["location"].get("longitude"),
        }

    if "id" in place:
        updated["googlePlaceId"] = place["id"]

    if "googleMapsUri" in place:
        updated["googleMapsUri"] = place["googleMapsUri"]

    return updated


def main():
    dry_run = "--dry-run" in sys.argv

    api_key = os.environ.get("MAPS_API_KEY")
    if not api_key:
        print("Error: MAPS_API_KEY environment variable is not set.")
        sys.exit(1)

    with open(TRIP_JSON_PATH, encoding="utf-8") as f:
        data = json.load(f)

    total = 0
    enriched = 0
    not_found = 0

    for item in data["items"]:
        locations = item.get("locations")
        if not locations:
            continue

        updated_locations = []
        for loc in locations:
            total += 1
            query = loc.get("fullAddress") or loc.get("name")

            if not query:
                print(f"[{item['itemId']}] Skipping location with no address or name")
                updated_locations.append(loc)
                continue

            print(f"[{item['itemId']}] Looking up: {query}")

            place = lookup_place(api_key, query)

            if place:
                updated = enrich_location(loc, place)
                updated_locations.append(updated)
                enriched += 1
                print(f"    ✓ {place.get('formattedAddress', 'N/A')}")
            else:
                print(f"    ✗ No result — location unchanged")
                updated_locations.append(loc)
                not_found += 1

            time.sleep(0.1)  # gentle rate limiting

        item["locations"] = updated_locations

    if dry_run:
        print(f"\nDry run — no changes written.")
    else:
        with open(TRIP_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        print(f"\nWritten to {TRIP_JSON_PATH}")

    print(f"Results: {enriched}/{total} enriched, {not_found} not found.")


if __name__ == "__main__":
    main()
