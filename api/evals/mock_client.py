"""Scripted streaming client for exercising the harness without OpenAI.

Used by tests/test_eval_harness.py (the CI tier). Produces the same chunk
shapes the real streaming API delivers, so the real loop code runs unchanged.
"""

from __future__ import annotations

import json
import uuid
from types import SimpleNamespace


def tool_call(name: str, arguments: dict) -> SimpleNamespace:
    return SimpleNamespace(
        id=f"call_{uuid.uuid4().hex[:8]}",
        type="function",
        function=SimpleNamespace(name=name, arguments=json.dumps(arguments)),
    )


def response(*, content: str | None = None, tool_calls: list | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content, tool_calls=tool_calls or None),
                finish_reason="tool_calls" if tool_calls else "stop",
            )
        ],
        usage=SimpleNamespace(
            total_tokens=100,
            prompt_tokens=80,
            completion_tokens=20,
            prompt_tokens_details=None,
        ),
    )


def _as_chunks(scripted) -> list[SimpleNamespace]:
    msg = scripted.choices[0].message
    chunks = []
    if msg.content:
        chunks.append(
            SimpleNamespace(
                choices=[SimpleNamespace(delta=SimpleNamespace(content=msg.content, tool_calls=None), finish_reason=None)],
                usage=None,
            )
        )
    if msg.tool_calls:
        deltas = [
            SimpleNamespace(
                index=i,
                id=tc.id,
                type="function",
                function=SimpleNamespace(name=tc.function.name, arguments=tc.function.arguments),
            )
            for i, tc in enumerate(msg.tool_calls)
        ]
        chunks.append(
            SimpleNamespace(
                choices=[SimpleNamespace(delta=SimpleNamespace(content=None, tool_calls=deltas), finish_reason=None)],
                usage=None,
            )
        )
    chunks.append(SimpleNamespace(choices=[], usage=scripted.usage))
    return chunks


class _FakeStream:
    def __init__(self, chunks):
        self._chunks = list(chunks)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._chunks:
            raise StopAsyncIteration
        return self._chunks.pop(0)


class ScriptedClient:
    """Returns pre-scripted responses in order; records every request's kwargs."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.requests: list[dict] = []

        async def create(**kwargs):
            recorded = dict(kwargs)
            recorded["messages"] = [dict(m) for m in kwargs.get("messages", [])]
            self.requests.append(recorded)
            if not self._responses:
                raise AssertionError("ScriptedClient ran out of scripted responses")
            return _FakeStream(_as_chunks(self._responses.pop(0)))

        self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))
