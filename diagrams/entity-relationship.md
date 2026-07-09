# PriPriTrip Backend Entity Relationship Diagram

This ERD reflects current SQLAlchemy models in api/app/models.py.

```mermaid
erDiagram
    USERS ||--o{ TRIPS : owns
    USERS ||--o{ CHAT_MESSAGES : writes
    USERS ||--o{ AI_DOCUMENTS : uploads

    TRIPS ||--o{ TRIP_DAYS : has
    TRIPS ||--o{ TRIP_POINTS : has
    TRIPS ||--o{ STAY_DETAILS : has
    TRIPS ||--o{ TRAVEL_DETAILS : has
    TRIPS ||--o{ CHAT_MESSAGES : has
    TRIPS ||--o{ AI_DOCUMENTS : has

    TRIP_DAYS ||--o{ TRIP_POINTS : contains

    STAY_DETAILS ||--o{ TRIP_POINTS : referenced_by
    TRAVEL_DETAILS ||--o{ TRIP_POINTS : referenced_by

    TRIP_POINTS ||--o{ LOCATIONS : owns
    STAY_DETAILS ||--o{ LOCATIONS : owns
    TRAVEL_DETAILS ||--o{ LOCATIONS : owns

    USERS {
      uuid id PK
      string email
      string hashed_password
      bool is_active
      bool is_superuser
      bool is_verified
      string name
      string first_name
      string last_name
      string home_timezone_id
    }

    TRIPS {
      uuid trip_id PK
      uuid user_id FK
      string trip_name
      string status
      string start_date
      string end_date
      string default_timezone_id
      datetime created_at
      datetime updated_at
    }

    TRIP_DAYS {
      uuid day_id PK
      uuid trip_id FK
      string title
      string date
      bool is_alternate
      bool completed
      bool is_deleted
      datetime deleted_at
    }

    TRIP_POINTS {
      uuid point_id PK
      uuid trip_id FK
      uuid day_id FK
      uuid stay_detail_id FK
      uuid travel_detail_id FK
      string type
      string title
      string start_date_time
      string end_date_time
      bool is_deleted
      datetime deleted_at
    }

    STAY_DETAILS {
      uuid stay_detail_id PK
      uuid trip_id FK
      string stay_type
      string check_in
      string check_out
      string check_in_tzid
      string check_out_tzid
      bool is_deleted
      datetime deleted_at
    }

    TRAVEL_DETAILS {
      uuid travel_detail_id PK
      uuid trip_id FK
      string mode
      string departure_date_time
      string arrival_date_time
      string departure_tzid
      string arrival_tzid
      bool is_deleted
      datetime deleted_at
    }

    LOCATIONS {
      uuid location_id PK
      uuid point_id FK
      uuid stay_detail_id FK
      uuid travel_detail_id FK
      string role
      string name
      float lat
      float lng
      string timezone_id
    }

    AI_DOCUMENTS {
      uuid document_id PK
      uuid user_id FK
      uuid trip_id FK
      string filename
      string document_type
      string workflow_mode
      string content_hash
      string extracted_payload
      string trip_import_payload
      datetime created_at
      datetime updated_at
    }

    CHAT_MESSAGES {
      uuid message_id PK
      uuid user_id FK
      uuid trip_id FK
      string workflow_name
      string message
      string structure_content
      bool is_bot
      datetime created_at
    }
```

## Notes

- Location ownership is polymorphic by nullable foreign keys, with a DB check constraint ensuring exactly one owner is present among point_id, stay_detail_id, travel_detail_id.
- Trip points can optionally reference a stay or travel detail, depending on point type.
- AI documents enforce a uniqueness constraint on user_id + trip_id + content_hash + document_type.
- Chat summaries for long conversations are persisted in chat_messages using workflow names with a ::summary suffix.
