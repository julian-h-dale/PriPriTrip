"""Shared OpenAI client + structured-output parse helper for chat workflows.

Single choke point for:
- async client construction (the chat path must never block the event loop)
- model/timeout/retry configuration (read per-call, not at import time)
- request/response/error tracing to ai.log
- error scrubbing: raw exception text is logged server-side, clients get a
  generic message (review.md 1B-6)
"""

from __future__ import annotations

import logging
import time

from fastapi import HTTPException, status

from app.services.ai_trace import log_ai_event
from app.settings import get_settings

logger = logging.getLogger("app.services.openai_client")

_GENERIC_AI_ERROR = "The AI service request failed. Please try again."


def get_model() -> str:
    return get_settings().openai_model


def get_timeout() -> float:
    return get_settings().openai_timeout


def get_max_retries() -> int:
    return get_settings().openai_max_retries


def get_async_client():
    from openai import AsyncOpenAI

    api_key = get_settings().openai_api_key
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OPENAI_API_KEY is not configured on the server.",
        )
    return AsyncOpenAI(api_key=api_key, timeout=get_timeout(), max_retries=get_max_retries())


async def parse_structured(
    client,
    *,
    system: str,
    user: str,
    response_format,
    pass_name: str,
    event_prefix: str = "ai.openai",
):
    """Run a structured-output chat completion and return the parsed model.

    Raises HTTPException(502) with a generic client-facing message on failure;
    full details go to ai.log and the app logger.
    """
    model = get_model()
    started = time.monotonic()
    log_ai_event(
        f"{event_prefix}.request",
        passName=pass_name,
        model=model,
        requestTimeoutSeconds=get_timeout(),
        maxRetries=get_max_retries(),
        systemPrompt=system,
        userPrompt=user,
    )
    try:
        completion = await client.beta.chat.completions.parse(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format=response_format,
        )
    except Exception as exc:
        log_ai_event(
            f"{event_prefix}.error",
            passName=pass_name,
            elapsedSeconds=round(time.monotonic() - started, 3),
            error=str(exc),
        )
        logger.exception("OpenAI request failed (pass=%s)", pass_name)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=_GENERIC_AI_ERROR,
        ) from exc

    message = completion.choices[0].message
    usage = getattr(completion, "usage", None)
    prompt_details = getattr(usage, "prompt_tokens_details", None) if usage else None
    log_ai_event(
        f"{event_prefix}.response_meta",
        passName=pass_name,
        elapsedSeconds=round(time.monotonic() - started, 3),
        finishReason=(completion.choices[0].finish_reason if completion.choices else None),
        totalTokens=(getattr(usage, "total_tokens", None) if usage else None),
        promptTokens=(getattr(usage, "prompt_tokens", None) if usage else None),
        completionTokens=(getattr(usage, "completion_tokens", None) if usage else None),
        cachedPromptTokens=(getattr(prompt_details, "cached_tokens", None) if prompt_details else None),
        refusal=getattr(message, "refusal", None),
    )
    if getattr(message, "refusal", None):
        logger.warning("OpenAI refused the request (pass=%s)", pass_name)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=_GENERIC_AI_ERROR,
        )
    parsed = message.parsed
    if parsed is None:
        logger.warning("OpenAI returned no parseable %s response", pass_name)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=_GENERIC_AI_ERROR,
        )
    log_ai_event(f"{event_prefix}.parsed", passName=pass_name, parsed=parsed)
    return parsed
