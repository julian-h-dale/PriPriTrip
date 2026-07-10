#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_PATH="${AI_LOG_PATH:-$SCRIPT_DIR/ai.log}"
MODE="${1:-pretty}"
EVENT_FILTER="${2:-}"

if [[ ! -f "$LOG_PATH" ]]; then
  echo "Log file not found: $LOG_PATH"
  exit 1
fi

if command -v jq >/dev/null 2>&1; then
  case "$MODE" in
    pretty)
      if [[ -n "$EVENT_FILTER" ]]; then
        jq -C "select(.event == \"$EVENT_FILTER\")" "$LOG_PATH" | less -R
      else
        jq -C . "$LOG_PATH" | less -R
      fi
      ;;
    follow)
      if [[ -n "$EVENT_FILTER" ]]; then
        tail -f "$LOG_PATH" | jq -C "select(.event == \"$EVENT_FILTER\")"
      else
        tail -f "$LOG_PATH" | jq -C .
      fi
      ;;
    raw)
      if [[ -n "$EVENT_FILTER" ]]; then
        jq -c "select(.event == \"$EVENT_FILTER\")" "$LOG_PATH"
      else
        cat "$LOG_PATH"
      fi
      ;;
    *)
      echo "Usage: $0 [pretty|follow|raw] [event_name]"
      exit 2
      ;;
  esac
  exit 0
fi

# Fallback when jq is unavailable.
case "$MODE" in
  pretty)
    python3 -m json.tool "$LOG_PATH" | less
    ;;
  follow)
    tail -f "$LOG_PATH"
    ;;
  raw)
    cat "$LOG_PATH"
    ;;
  *)
    echo "Usage: $0 [pretty|follow|raw] [event_name]"
    exit 2
    ;;
esac
