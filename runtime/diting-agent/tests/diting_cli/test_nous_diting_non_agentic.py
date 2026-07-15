"""Tests for the Nous-DiTing-3/4 non-agentic warning detector.

Prior to this check, the warning fired on any model whose name contained
``"diting"`` anywhere (case-insensitive). That false-positived on unrelated
local Modelfiles such as ``diting-brain:qwen3-14b-ctx16k`` — a tool-capable
Qwen3 wrapper that happens to live under the "diting" tag namespace.

``is_nous_diting_non_agentic`` should only match the actual Nous Research
DiTing-3 / DiTing-4 chat family.
"""

from __future__ import annotations

import pytest

from diting_cli.model_switch import (
    _DiTing_MODEL_WARNING,
    _check_diting_model_warning,
    is_nous_diting_non_agentic,
)


@pytest.mark.parametrize(
    "model_name",
    [
        "NousResearch/DiTing-3-Llama-3.1-70B",
        "NousResearch/DiTing-3-Llama-3.1-405B",
        "diting-3",
        "DiTing-3",
        "diting-4",
        "diting-4-405b",
        "diting_4_70b",
        "openrouter/diting3:70b",
        "openrouter/nousresearch/diting-4-405b",
        "NousResearch/DiTing3",
        "diting-3.1",
    ],
)
def test_matches_real_nous_diting_chat_models(model_name: str) -> None:
    assert is_nous_diting_non_agentic(model_name), (
        f"expected {model_name!r} to be flagged as Nous DiTing 3/4"
    )
    assert _check_diting_model_warning(model_name) == _DiTing_MODEL_WARNING


@pytest.mark.parametrize(
    "model_name",
    [
        # Kyle's local Modelfile — qwen3:14b under a custom tag
        "diting-brain:qwen3-14b-ctx16k",
        "diting-brain:qwen3-14b-ctx32k",
        "diting-honcho:qwen3-8b-ctx8k",
        # Plain unrelated models
        "qwen3:14b",
        "qwen3-coder:30b",
        "qwen2.5:14b",
        "claude-opus-4-6",
        "anthropic/claude-sonnet-4.5",
        "gpt-5",
        "openai/gpt-4o",
        "google/gemini-2.5-flash",
        "deepseek-chat",
        # Non-chat DiTing models we don't warn about
        "diting-llm-2",
        "diting2-pro",
        "nous-diting-2-mistral",
        # Edge cases
        "",
        "diting",  # bare "diting" isn't the 3/4 family
        "diting-brain",
        "brain-diting-3-impostor",  # "3" not preceded by /: boundary
    ],
)
def test_does_not_match_unrelated_models(model_name: str) -> None:
    assert not is_nous_diting_non_agentic(model_name), (
        f"expected {model_name!r} NOT to be flagged as Nous DiTing 3/4"
    )
    assert _check_diting_model_warning(model_name) == ""


def test_none_like_inputs_are_safe() -> None:
    assert is_nous_diting_non_agentic("") is False
    # Defensive: the helper shouldn't crash on None-ish falsy input either.
    assert _check_diting_model_warning("") == ""
