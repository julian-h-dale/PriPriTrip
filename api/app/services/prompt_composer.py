from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import re
from typing import Literal


PromptStage = Literal["welcome", "travel", "stay", "assistant_actions"]
_REQUIRED_SECTIONS = {
    "base",
    "stage:welcome",
    "stage:travel",
    "stage:stay",
    "stage:assistant_actions",
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


def _validate_sections(sections: dict[str, str]) -> None:
    missing = sorted(name for name in _REQUIRED_SECTIONS if not sections.get(name))
    if missing:
        missing_text = ", ".join(missing)
        raise RuntimeError(
            "Prompt file is missing required machine-readable section markers: "
            f"{missing_text}. Expected markers like '## [base]' and '## [stage:welcome]'."
        )


@lru_cache(maxsize=1)
def _load_prompt_sections() -> dict[str, str]:
    prompt_path = _prompt_path()
    try:
        text = prompt_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise RuntimeError(f"Prompt file not found at {prompt_path}")
    cleaned = text.strip()
    if not cleaned:
        raise RuntimeError(f"Prompt file is empty at {prompt_path}")
    sections = _split_sections(cleaned)
    _validate_sections(sections)
    return sections


def load_base_prompt() -> str:
    sections = _load_prompt_sections()
    return sections["base"]


def _load_stage_overlay(stage: PromptStage) -> str:
    sections = _load_prompt_sections()
    return sections[f"stage:{stage}"]


def validate_prompt_sections() -> None:
    _load_prompt_sections()


def build_new_trip_stage_prompt(stage: Literal["welcome", "travel", "stay"]) -> str:
    base = load_base_prompt()
    overlay = _load_stage_overlay(stage)
    return f"{base}\n\n{overlay}"


def build_trip_assistant_prompt() -> str:
    base = load_base_prompt()
    return f"{base}\n\n{_load_stage_overlay('assistant_actions')}"
