"""data/*.toml 로더. DAILY_MISSIONS_DATA 환경변수로 다른 데이터 폴더를 쓸 수 있다."""

from __future__ import annotations

import os
import tomllib
from functools import cache
from pathlib import Path
from typing import Any

DATA_DIR = Path(os.environ.get("DAILY_MISSIONS_DATA", Path(__file__).parent / "data"))


@cache
def load(name: str) -> dict[str, Any]:
    return tomllib.loads((DATA_DIR / f"{name}.toml").read_text(encoding="utf-8"))


BALANCE = load("balance")
