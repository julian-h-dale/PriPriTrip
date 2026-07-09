from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import re
from typing import Literal


PromptStage = Literal["welcome", "travel", "stay", "assistant_actions"]

_FALLBACK_BASE = "You are PriPriTrip Assistant for trip-planning tasks only."

_FALLBACK_STAGE: dict[str, str] = {
    "welcome": "Skill Card: Welcome Intake. Capture trip shell fields with best effort and ask one focused follow-up when needed.",
    "travel": "Skill Card: Collect One Travel Leg. Capture mode, departureDateTime, arrivalDateTime and ask for the next missing required field.",
    "stay": "Skill Card: Collect One Stay. Capture stayType, checkIn, checkOut and ask for the next missing required field.",
    "assistant_actions": "Skill Card: Trip CRUD Actions. Return assistantMessage and zero or more structured CRUD actions.",
}

_SECTION_PATTERN = re.compile(r"^##\s*\[(?P<name>[^\]]+)\]\s*$", re.MULTILINE)


def _prompt_path() -> Path:
    # api/app/services -> api root is parents[2]
    return Path(__file__).resolve().parents[2] / "pripritrip_system_prompt.md"


def _split_sections(text: str) -> dict[str, str]:
    sections: dict[str, str] = {}
    matches = list(_SECTION_PATTERN.finditer(text))
    if not matches:
        return sections

    for idx, match in enumerate(matches):
        name = match.group("name").strip().lower()
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        if body:
            sections[name] = body
    return sections


@lru_cache(maxsize=1)
def _load_prompt_sections() -> dict[str, str]:
    prompt_path = _prompt_path()
    try:
        text = prompt_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {}
    cleaned = text.strip()
    if not cleaned:
        return {}
    return _split_sections(cleaned)


def load_base_prompt() -> str:
    sections = _load_prompt_sections()
    return sections.get("base", _FALLBACK_BASE)


def _load_stage_overlay(stage: PromptStage) -> str:
    sections = _load_prompt_sections()
    return sections.get(f"stage:{stage}", _FALLBACK_STAGE[stage])


def build_new_trip_stage_prompt(stage: Literal["welcome", "travel", "stay"]) -> str:
    base = load_base_prompt()
    overlay = _load_stage_overlay(stage)
    return f"{base}\n\n{overlay}"


def build_trip_assistant_prompt() -> str:
    base = load_base_prompt()
    return f"{base}\n\n{_load_stage_overlay('assistant_actions')}"
