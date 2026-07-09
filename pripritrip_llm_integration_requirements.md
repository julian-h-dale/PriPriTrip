# PriPriTrip LLM Integration Requirements

## Purpose

This document describes the recommended changes for PriPriTrip's OpenAI API integration. It is intended as a handoff document for an implementation agent.

The goal is to make the assistant better at converting user chat into structured itinerary data while avoiding repeated questions, unnecessary year prompts, and weak location assumptions.

## Current Problem Summary

The current prompt has a solid foundation: it defines the PriPriTrip assistant, the data model, supported CRUD operations, field enumerations, stage-specific intake behavior, and a basic tool-action contract.

The main issues are architectural rather than purely prompt-related:

1. The model is being asked to read full chat history and the full structured model every turn, then independently decide what is missing.
2. The prompt contains a fixed missing-year rule: "If year is missing, assume 2026." This causes wrong behavior for dates like January 1 when the next occurrence should be in 2027.
3. The prompt treats some completion fields as if they are required before creating useful partial records.
4. Location resolution is being left mostly to prompt behavior, even though it should be a backend/tool responsibility.
5. There is no explicit backend follow-up gate to prevent the model from asking for information already present in the structured trip model.

## Recommended Target Architecture

The model should be an intent extractor and action proposer. The backend should be the final authority for validation, date normalization, location resolution, record matching, and whether a follow-up question is required.

Recommended flow:

```text
User message
  ↓
Build compact LLM context from app state
  ↓
OpenAI call using stable system prompt + Structured Outputs schema
  ↓
Model returns assistantMessage, proposed actions, assumptions, unresolved items, followUpQuestion
  ↓
Backend validates proposed actions against current structured trip model
  ↓
Backend normalizes dates and times
  ↓
Backend resolves locations or returns candidate options
  ↓
Backend applies duplicate-question / known-field gate
  ↓
Backend persists valid actions
  ↓
Assistant response summarizes saved data and asks max one needed question
```

## Requirement 1: Use Structured Outputs

### Recommendation

Use OpenAI Structured Outputs for the assistant response shape instead of relying on prose-only prompt instructions.

OpenAI's Structured Outputs feature is intended to make model responses adhere to a JSON Schema. OpenAI's documentation states that Structured Outputs ensures responses follow a supplied JSON Schema, reducing omitted required keys or invalid enum values.

### Output Contract

Use a schema similar to this:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "assistantMessage",
    "actions",
    "assumptions",
    "unresolvedItems",
    "followUpQuestion",
    "confidence"
  ],
  "properties": {
    "assistantMessage": {
      "type": "string",
      "description": "Concise user-facing response summarizing what was captured or asking a focused question."
    },
    "actions": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["op", "target", "id", "fields"],
        "properties": {
          "op": {
            "type": "string",
            "enum": ["create", "update", "delete"]
          },
          "target": {
            "type": "string",
            "enum": ["trip", "day", "point", "stay", "travel"]
          },
          "id": {
            "type": ["string", "null"],
            "description": "Required for update/delete. Null for create unless app expects model-generated IDs."
          },
          "fields": {
            "type": "object",
            "description": "Minimal field payload for create/update. Empty object for delete."
          }
        }
      }
    },
    "assumptions": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["type", "description", "confidence"],
        "properties": {
          "type": {
            "type": "string",
            "enum": ["date", "location", "record_match", "timezone", "other"]
          },
          "description": {
            "type": "string"
          },
          "confidence": {
            "type": "string",
            "enum": ["high", "medium", "low"]
          }
        }
      }
    },
    "unresolvedItems": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["type", "description", "blocking"],
        "properties": {
          "type": {
            "type": "string",
            "enum": ["date", "location", "record_match", "required_field", "other"]
          },
          "description": {
            "type": "string"
          },
          "blocking": {
            "type": "boolean"
          }
        }
      }
    },
    "followUpQuestion": {
      "type": ["string", "null"],
      "description": "At most one question. Null when no question is required."
    },
    "confidence": {
      "type": "string",
      "enum": ["high", "medium", "low"]
    }
  }
}
```

### Acceptance Criteria

- The OpenAI response always parses as valid JSON.
- The response always contains the expected top-level keys.
- Invalid operation names, targets, enum values, and confidence values are rejected before persistence.
- The backend does not persist actions directly from raw model text.

## Requirement 2: Add Backend Validation and Follow-Up Gate

### Recommendation

Do not let the model be the final decision-maker for follow-up questions. The backend should inspect the model output and suppress unnecessary questions.

### Backend Gate Rules

Before showing `followUpQuestion`, check:

1. Is the answer already present in the current structured trip model?
2. Is the answer present in the latest user message?
3. Is the answer available from active page context, active day, active stay, or active travel record?
4. Has the assistant recently asked the same question?
5. Can a useful partial record be created instead?
6. Is the missing field actually blocking, or merely needed for completion later?

If the question fails the gate, suppress it and replace the assistant message with a save/update summary.

### Suggested Recent Question Tracking

Track the last 3-5 assistant questions as normalized keys:

```json
[
  {
    "field": "trip.endDate",
    "question": "What date are you returning?",
    "askedAt": "2026-07-09T16:12:00-05:00"
  }
]
```

### Acceptance Criteria

- The assistant does not ask for a year when the next-occurrence date rule can resolve the year.
- The assistant does not ask for a destination if `destinationLocationName` is already present.
- The assistant does not ask the same missing-field question twice in a row.
- The assistant captures partial records instead of blocking on completion fields.

## Requirement 3: Replace Fixed Year Logic With Date Normalization

### Recommendation

Remove any fixed prompt rule such as "If year is missing, assume 2026."

Use deterministic backend date normalization.

### Inputs

The date normalizer should receive:

```json
{
  "rawText": "Oct 30",
  "appCurrentDate": "2026-07-09",
  "userTimezoneId": "America/Chicago",
  "tripTimezoneId": "Asia/Tokyo",
  "tripStartDate": null,
  "tripEndDate": null,
  "activeDayDate": null
}
```

### Rules

1. If the user provides a year, preserve it.
2. If the user provides month/day without year, resolve to the next occurrence of that date based on `appCurrentDate` and the relevant timezone.
3. If active trip date range exists, prefer dates inside that range.
4. If active day exists and user provides only time, attach the time to active day.
5. If only day of week is provided, choose the next occurrence unless trip/day context clearly indicates otherwise.
6. Do not ask for year unless interpretations materially conflict.

### Examples When `appCurrentDate = 2026-07-09`

| User text | Normalized value |
|---|---:|
| Oct 30 | 2026-10-30 |
| January 1 | 2027-01-01 |
| tomorrow | 2026-07-10 |
| July 1 | 2027-07-01 |
| 2026-07-01 | 2026-07-01 |

### Acceptance Criteria

- Month/day inputs no longer trigger default year questions.
- January dates after July resolve to the next calendar year.
- The prompt does not hardcode a specific year.
- Unit tests cover month/day, relative dates, active day time-only input, and trip-range preference.

## Requirement 4: Add Location Resolution Pipeline

### Recommendation

The model should extract raw location intent. The backend should resolve canonical locations.

OpenAI function calling/tools are appropriate when the model needs to request app functionality or data. OpenAI's function calling documentation describes tool calling as a way for models to interface with external systems and access application-provided data/actions.

### Model Responsibility

The model extracts:

```json
{
  "rawLocationText": "Naha airport",
  "role": "destination",
  "locationTypeHint": "airport"
}
```

The model should not fabricate:

- latitude
- longitude
- Google Place ID
- Google Maps URI
- full address
- precise timezone

### Backend Responsibility

Implement a `resolve_location` step using a places API, internal airport table, or search provider.

Suggested result shape:

```json
{
  "query": "Naha airport",
  "candidates": [
    {
      "name": "Naha Airport",
      "fullAddress": "150 Kagamizu, Naha, Okinawa 901-0142, Japan",
      "googlePlaceId": "...",
      "googleMapsUri": "...",
      "lat": 26.1958,
      "lng": 127.6459,
      "timezoneId": "Asia/Tokyo",
      "confidence": "high",
      "reason": "Main commercial airport serving Naha."
    }
  ]
}
```

### Confidence Behavior

- High confidence: apply the top candidate and record an assumption.
- Medium confidence: offer 2-3 options.
- Low confidence: ask a focused clarification question.

### Acceptance Criteria

- "Naha airport" resolves to the main airport serving Naha when confidence is high.
- The assistant can create a partial travel leg even before full place metadata is resolved.
- The app does not persist fabricated coordinates or place IDs.
- Ambiguous place queries produce a short options question instead of a generic "where is that?" question.

## Requirement 5: Reframe Required Fields as Completion Criteria

### Recommendation

Do not treat completion fields as blockers for creating records.

Current prompt language says a travel leg requires `mode`, `departureDateTime`, and `arrivalDateTime` to complete, and a stay requires `stayType`, `checkIn`, and `checkOut` to complete. That is fine as a completion rule, but it should not block partial capture.

### New Rules

Travel:
- Required to create partial record: at least one meaningful travel fact.
- Required to complete record: mode, departureDateTime, arrivalDateTime.

Stay:
- Required to create partial record: at least one meaningful stay fact.
- Required to complete record: stayType, checkIn, checkOut.

Trip shell:
- Required to create partial trip: destinationLocationName or startDate.
- Required to complete shell: destinationLocationName, startDate, endDate.

### Acceptance Criteria

- The assistant creates a travel record from "I'm flying into Naha airport" even if dates/times are missing.
- The assistant creates a stay record from "We're staying at the Hyatt in Kyoto" even if check-in/check-out are missing.
- Missing completion fields appear in validation/status, not as repeated blocking questions.

## Requirement 6: Provide Compact Runtime Context Instead of Full History Reliance

### Recommendation

Continue sending recent chat history, but do not rely on the model to rediscover all known facts from the full transcript every turn.

Send a compact runtime context object generated by the app.

### Suggested Runtime Context

```json
{
  "appCurrentDate": "2026-07-09",
  "userTimezoneId": "America/Chicago",
  "pageContext": "travel",
  "activeTripId": "trip_123",
  "activeDayId": null,
  "activePointId": null,
  "activeStayDetailId": null,
  "activeTravelDetailId": null,
  "currentStructuredTripModel": {},
  "knownFactsSummary": {
    "tripName": "Okinawa Trip",
    "destinationLocationName": "Okinawa",
    "startDate": "2026-10-30",
    "endDate": null
  },
  "recentAssistantQuestions": [
    {
      "field": "trip.endDate",
      "question": "What date are you returning?"
    }
  ],
  "backendValidation": {
    "missingForTripCompletion": ["endDate"],
    "missingForTravelCompletion": [],
    "missingForStayCompletion": [],
    "blockingIssues": []
  },
  "locationCandidates": []
}
```

### Context Priority

The prompt should instruct the model to use:

1. current structured trip model
2. current user message
3. runtime context
4. recent chat history
5. older chat history

### Acceptance Criteria

- The model does not need the full transcript to avoid repeat questions.
- Known facts summary and structured model are sufficient to prevent obvious repeated prompts.
- Full history can be truncated without losing core trip state.

## Requirement 7: Optimize Prompt Layout for Prompt Caching

### Recommendation

Place stable content first and variable content last.

OpenAI prompt caching works best when requests share an exact prompt prefix. OpenAI's prompt caching guide says cache hits require exact prefix matches and recommends placing static content like instructions and examples at the beginning, with variable user-specific information at the end.

Recommended prompt order:

```text
Stable system prompt
Stable schema/tool definitions
Stable examples
Dynamic runtime context
Recent chat history
Current user message
```

### Acceptance Criteria

- Static prompt text is not rebuilt with dynamic values in the middle.
- Runtime context is appended after stable instructions.
- Token usage logs include cached token counts when available.

## Requirement 8: Use Function Calling for App Tools, Not Skills for MVP

### Recommendation

Do not prioritize OpenAI Skills for the current MVP.

OpenAI Skills are versioned bundles of files plus a `SKILL.md` manifest that can be attached to hosted or local shell environments. They are useful for reusable shell-based workflows, but PriPriTrip's immediate needs are better served by structured model output, backend validation, and app-owned tools.

Use function calling or backend-only functions for:

- `resolve_location`
- `normalize_date`
- `match_existing_record`
- `validate_actions`
- `summarize_validation_state`

Skills may become useful later if the app adds agentic file-processing workflows, export/report generation, or reusable shell workflows.

### Acceptance Criteria

- MVP does not require OpenAI Skills.
- Location/date/validation workflows are implemented in backend code or API tools.
- The implementation avoids introducing shell execution unless there is a clear product need.

## Requirement 9: Add Regression Test Cases

### Date Tests

| Input | App current date | Expected |
|---|---:|---:|
| Oct 30 | 2026-07-09 | 2026-10-30 |
| Jan 1 | 2026-07-09 | 2027-01-01 |
| July 1 | 2026-07-09 | 2027-07-01 |
| tomorrow | 2026-07-09 | 2026-07-10 |
| Friday | 2026-07-09 | 2026-07-10 |

### No Repeat Question Tests

1. Given `destinationLocationName = Okinawa`, when user says "I'm flying into Naha airport," assistant must not ask "Where are you going?"
2. Given `startDate = 2026-10-30`, assistant must not ask for the trip start date again.
3. Given assistant asked "What date are you returning?" in previous turn, assistant should not ask the same question again if the latest user message adds unrelated details.

### Partial Capture Tests

1. "I'm flying into Naha airport" creates or updates a travel record with mode = flight and destination raw location = Naha airport.
2. "We're staying at the Hyatt in Kyoto" creates or updates a stay record with name/location text and inferred stayType = hotel.
3. "Dinner at Giaxa at 7" creates an activity point with unresolved date if no active day exists, or attaches to active day if active day exists.

### Location Tests

1. "Naha airport" resolves to the main Naha Airport when the resolver has high confidence.
2. "Springfield airport" should ask for options if multiple plausible candidates exist.
3. "the Hyatt" should use active destination context before asking a broad clarification question.

### Conflict Tests

1. If existing trip is Okinawa and user says "Actually we're going to Tokyo," assistant should treat this as a correction and update/ask depending on confidence.
2. If existing arrival is Oct 30 and user says "arrive Oct 31 instead," assistant should update the travel record rather than create a duplicate if active record context is present.

## Implementation Checklist

### Phase 1: Prompt and Schema

- [ ] Replace current prompt with `pripritrip_system_prompt_v2.md`.
- [ ] Implement Structured Outputs response schema.
- [ ] Validate model response before applying actions.
- [ ] Log raw model response, parsed response, validation errors, and final persisted actions.

### Phase 2: Backend Gates

- [ ] Implement known-field follow-up suppression.
- [ ] Track recent assistant questions.
- [ ] Separate partial creation from completion validation.
- [ ] Add blocking vs non-blocking unresolved item handling.

### Phase 3: Date Handling

- [ ] Implement deterministic `normalize_date`.
- [ ] Remove hardcoded year assumptions from prompts and code.
- [ ] Add unit tests for next-occurrence behavior.
- [ ] Use active trip/day context for date/time interpretation.

### Phase 4: Location Handling

- [ ] Implement `resolve_location` or stub it behind an interface.
- [ ] Add confidence thresholds.
- [ ] Persist raw unresolved location text when canonical metadata is unavailable.
- [ ] Add location regression tests.

### Phase 5: Context Packing and Cost

- [ ] Build compact `knownFactsSummary`.
- [ ] Send current structured model or relevant subset.
- [ ] Limit chat history to recent relevant turns.
- [ ] Keep static prompt prefix stable for prompt caching.
- [ ] Log token usage and cached token usage.

## Suggested API Boundary

The OpenAI integration should return proposed changes, not directly mutate the database.

```ts
type LlmTripAssistantResult = {
  assistantMessage: string;
  actions: TripAction[];
  assumptions: Assumption[];
  unresolvedItems: UnresolvedItem[];
  followUpQuestion: string | null;
  confidence: "high" | "medium" | "low";
};
```

Then backend should transform it into:

```ts
type AppliedTripAssistantResult = {
  userMessage: string;
  persistedActions: TripAction[];
  suppressedActions: SuppressedAction[];
  assumptions: Assumption[];
  unresolvedItems: UnresolvedItem[];
  assistantMessage: string;
  followUpQuestion: string | null;
};
```

## Open Questions for Implementation Agent

1. Does the current app expect the model to generate IDs, or does the backend/database generate them?
2. Does the app currently use the Responses API or Chat Completions API?
3. Is there already a validation layer for action payloads?
4. Is there already a places API or airport/station resolver available?
5. Does the trip model have a canonical timezone per trip/day, or only per point/stay/travel detail?
6. How much of the full structured model is required per request versus a relevant subset?

## References

- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI Function Calling: https://developers.openai.com/api/docs/guides/function-calling
- OpenAI Prompt Caching: https://developers.openai.com/api/docs/guides/prompt-caching
- OpenAI Skills: https://developers.openai.com/api/docs/guides/tools-skills
