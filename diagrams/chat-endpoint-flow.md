# Chat Endpoint Integration and Data Flow

This document shows how data moves through the chat endpoints, including client payloads, server orchestration, and OpenAI structured calls.

## 1) End-to-End Sequence: trip:new_trip workflow

```mermaid
sequenceDiagram
    autonumber
    participant UI as UI (React)
    participant API as FastAPI /chat router
    participant DB as PostgreSQL
    participant WF as new_trip_workflow
    participant OAI as OpenAI API

    UI->>API: POST /chat/reply\n{tripId?, workflowName:"trip:new_trip", message, context}
    API->>DB: Validate or create TripRecord (status=new if new shell)
    API->>DB: Insert user ChatMessageRecord
    API->>DB: Load workflow chat messages ordered by created_at
    API->>API: Build transcript window (last 12 turns)
    API->>DB: Load/append workflow summary stream\n(workflowName::summary)
    API->>WF: handle_new_trip_chat_turn(\ntrip, transcript, conversation_summary, ui_context)

    WF->>DB: Build trip summary + full trip snapshot
    WF->>OAI: chat.completions.parse\nmessages:[systemPrompt, userPrompt]\nresponse_format: WelcomeTurn/TravelTurn/StayTurn
    OAI-->>WF: Parsed structured turn

    alt missing welcome fields
        WF->>DB: Update trip header + reconcile trip days
    else no travel yet
        WF->>DB: Create travel detail + locations + generated points
    else no stay yet
        WF->>DB: Create stay detail + locations + generated points
        WF->>DB: Mark trip status draft
        WF->>DB: Verify assembled trip
    end

    WF-->>API: WorkflowOutcome\n{assistantMessage, complete, verify?, structuredContent}
    API->>DB: Insert bot ChatMessageRecord (is_bot=true)
    API-->>UI: ChatReplyResponse\n{tripId, complete, tripName, verify?, messages[]}
```

## 2) End-to-End Sequence: trip:manage workflow (action-oriented)

```mermaid
sequenceDiagram
    autonumber
    participant UI as UI (React)
    participant API as FastAPI /chat router
    participant DB as PostgreSQL
    participant AWF as trip_assistant_workflow
    participant OAI as OpenAI API

    UI->>API: POST /chat/reply\n{tripId, workflowName:"trip:manage", message, context}
    API->>DB: Validate trip ownership
    API->>DB: Insert user ChatMessageRecord
    API->>DB: Load messages + summary state
    API->>AWF: handle_trip_assistant_chat_turn(...)

    AWF->>DB: Build summary + full trip snapshot
    AWF->>OAI: chat.completions.parse\nresponse_format: AssistantTurn
    OAI-->>AWF: assistantMessage + actions[]

    loop each action
        AWF->>DB: Execute create/update/delete on\ntrip/day/point/stay/travel
        AWF->>DB: Sync generated points/locations when needed
    end

    AWF-->>API: WorkflowOutcome\n{assistantMessage, structuredContent:{actions,results}}
    API->>DB: Insert bot ChatMessageRecord
    API-->>UI: ChatReplyResponse
```

## 3) Conversation Metadata and Summary Compaction

```mermaid
flowchart TD
    A[Load workflow chat messages] --> B{Messages > 12?}
    B -- No --> C[Use all as transcript window]
    B -- Yes --> D[Keep last 12 as transcript]
    D --> E[Older messages become summary candidates]
    E --> F[Load latest summary record for workflow::summary]
    F --> G[Append only uncovered older turns]
    G --> H[Persist new summary with coveredTurns metadata]
    H --> I[Pass transcript + conversation_summary to workflow]
```

## 4) Example Payloads

### 4.1 Client -> Server: POST /chat/reply

```json
{
  "tripId": "5ec22afc-b04a-4f8f-8f80-f4dca11f37fd",
  "workflowName": "trip:new_trip",
  "message": "We fly from Chicago to Rome on Sept 10 and stay 4 nights.",
  "context": {
    "page": "trips",
    "chatOverlay": "new_trip",
    "selectedTripId": "5ec22afc-b04a-4f8f-8f80-f4dca11f37fd",
    "workflowName": "trip:new_trip"
  }
}
```

### 4.2 Server -> OpenAI: new_trip staged parse call (conceptual)

```json
{
  "model": "gpt-5.4",
  "messages": [
    {
      "role": "system",
      "content": "<base prompt + stage overlay from api/pripritrip_system_prompt.md>"
    },
    {
      "role": "user",
      "content": "Current trip state + full trip snapshot + rolling summary + transcript + UI context + latest user message"
    }
  ],
  "response_format": "WelcomeTurn | TravelTurn | StayTurn"
}
```

### 4.3 Server -> OpenAI: trip assistant action parse call (conceptual)

```json
{
  "model": "gpt-5.4",
  "messages": [
    {
      "role": "system",
      "content": "<base prompt + stage:assistant_actions overlay>"
    },
    {
      "role": "user",
      "content": "Current trip state + full trip snapshot + rolling summary + transcript + UI context + latest user message"
    }
  ],
  "response_format": "AssistantTurn"
}
```

### 4.4 Server -> Client: ChatReplyResponse (example)

```json
{
  "tripId": "5ec22afc-b04a-4f8f-8f80-f4dca11f37fd",
  "complete": false,
  "tripName": "Italy Honeymoon",
  "verify": null,
  "messages": [
    {
      "messageId": "0f74aa94-fcb2-45e0-b57c-8a2cc6a8772f",
      "tripId": "5ec22afc-b04a-4f8f-8f80-f4dca11f37fd",
      "workflowName": "trip:new_trip",
      "message": "We fly from Chicago to Rome on Sept 10 and stay 4 nights.",
      "structureContent": null,
      "isBot": false,
      "createdAt": "2026-07-08T21:31:47.123456+00:00"
    },
    {
      "messageId": "f4b06d2f-9af1-43de-8e56-66a0f6f58b45",
      "tripId": "5ec22afc-b04a-4f8f-8f80-f4dca11f37fd",
      "workflowName": "trip:new_trip",
      "message": "Great start. What city are you departing from, and what hotel are you staying at in Rome?",
      "structureContent": "{\"tripName\":\"Italy Honeymoon\",\"destinationLocationName\":\"Rome\"}",
      "isBot": true,
      "createdAt": "2026-07-08T21:31:47.456789+00:00"
    }
  ]
}
```

## 5) Endpoints involved in chat integration

- POST /chat/reply
- GET /chat/trips/{trip_id}?workflowName=...
- Internal AI workflow branch when workflowName is trip:new_trip
- Internal AI workflow branch when workflowName starts with trip:
