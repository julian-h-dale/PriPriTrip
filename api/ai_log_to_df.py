#!/usr/bin/env python3
"""
ai_log_to_df.py — load PriPriTrip's JSONL ai.log into a pandas DataFrame.

Each line in ai.log is one JSON object (see app/services/ai_trace.py). This
script parses every line into one DataFrame row, with each top-level JSON key
becoming a column. Nested values (dicts/lists, e.g. structuredContent,
uiContext, verify) are kept as Python objects in the cell — pass --flatten to
explode them into their own dotted columns instead.

Standalone: only needs pandas (+ openpyxl if you export to .xlsx). It does not
import anything from the `app` package.

Examples:
    python ai_log_to_df.py                              # print a table view of ai.log
    python ai_log_to_df.py --path ai.log --rotated       # include rotated ai.log.1, ai.log.2, ...
    python ai_log_to_df.py --event chat.reply.outcome    # only rows with this exact event
    python ai_log_to_df.py --grep turn.outcome           # substring match on the event name
    python ai_log_to_df.py --columns timestampUtc event tripId botMessage
    python ai_log_to_df.py --tail 20
    python ai_log_to_df.py --out ai_log.csv              # or .xlsx / .json
    python ai_log_to_df.py --flatten --out ai_log.csv    # nested keys -> their own columns
    python ai_log_to_df.py --interactive                 # drop into a REPL with `df` loaded
"""

from __future__ import annotations

import argparse
import glob
import json
import sys
from pathlib import Path

try:
    import pandas as pd
except ImportError:
    sys.exit(
        "This script requires pandas, which isn't installed in this environment.\n"
        "Install it with: pip install pandas"
    )

DEFAULT_LOG_PATH = Path(__file__).resolve().parent / "ai.log"

# Columns worth seeing first when browsing; everything else keeps its
# original left-to-right order from the JSON.
_PREFERRED_COLUMN_ORDER = ["timestampUtc", "event", "workflowName", "tripId", "passName"]


def _rotated_paths(path: Path) -> list[Path]:
    """Oldest-to-newest rotated backups for a RotatingFileHandler log (ai.log.1, ai.log.2, ...).

    Higher numeric suffix = older backup, so sort descending by suffix to get
    oldest-first, then the caller appends the live file last (newest).
    """

    def _suffix(p: str) -> int:
        try:
            return int(p.rsplit(".", 1)[-1])
        except ValueError:
            return -1

    candidates = glob.glob(f"{path}.*")
    numbered = [p for p in candidates if _suffix(p) >= 0]
    return [Path(p) for p in sorted(numbered, key=_suffix, reverse=True)]


def _iter_log_lines(path: Path, *, include_rotated: bool):
    paths = [*(_rotated_paths(path) if include_rotated else []), path]
    for p in paths:
        if not p.exists():
            continue
        with p.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if line:
                    yield line


def load_ai_log(path: str | Path = DEFAULT_LOG_PATH, *, include_rotated: bool = False) -> pd.DataFrame:
    """Parse a JSONL ai.log file into a DataFrame: one row per line, JSON keys as columns."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"ai.log not found at {path}")

    records: list[dict] = []
    malformed = 0
    for line in _iter_log_lines(path, include_rotated=include_rotated):
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            malformed += 1
            continue
        if not isinstance(obj, dict):
            malformed += 1
            continue
        records.append(obj)

    if malformed:
        print(f"Warning: skipped {malformed} malformed/non-object line(s)", file=sys.stderr)

    df = pd.DataFrame.from_records(records)
    if df.empty:
        return df

    ordered = [c for c in _PREFERRED_COLUMN_ORDER if c in df.columns] + [
        c for c in df.columns if c not in _PREFERRED_COLUMN_ORDER
    ]
    df = df[ordered]

    if "timestampUtc" in df.columns:
        df["timestampUtc"] = pd.to_datetime(df["timestampUtc"], errors="coerce")
        df = df.sort_values("timestampUtc", kind="stable").reset_index(drop=True)

    return df


def _stringify_complex_cells(df: pd.DataFrame) -> pd.DataFrame:
    """Serialize dict/list cell values to JSON strings (needed for CSV/Excel export)."""

    def _to_str(value):
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False, default=str)
        return value

    return df.map(_to_str)


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--path", default=DEFAULT_LOG_PATH, help=f"Path to ai.log (default: {DEFAULT_LOG_PATH})")
    parser.add_argument("--rotated", action="store_true", help="Also include rotated backups (ai.log.1, ai.log.2, ...)")
    parser.add_argument("--event", help="Only rows where event exactly equals this value")
    parser.add_argument("--grep", help="Only rows where event contains this substring (case-insensitive)")
    parser.add_argument("--columns", nargs="+", help="Only show these columns (in this order)")
    parser.add_argument("--flatten", action="store_true", help="Explode nested dict columns into dotted sub-columns")
    parser.add_argument("--head", type=int, help="Show only the first N rows")
    parser.add_argument("--tail", type=int, help="Show only the last N rows")
    parser.add_argument("--out", help="Write the result to a file instead of printing (.csv, .xlsx, or .json)")
    parser.add_argument("--max-colwidth", type=int, default=80, help="Truncate long cell text when printing (default 80; 0 = no truncation)")
    parser.add_argument("--interactive", action="store_true", help="Drop into a Python REPL with `df` loaded instead of printing")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)

    df = load_ai_log(args.path, include_rotated=args.rotated)

    if df.empty:
        print("No log rows found.", file=sys.stderr)
        return

    if args.event:
        df = df[df["event"] == args.event]
    if args.grep:
        df = df[df["event"].str.contains(args.grep, case=False, na=False)]

    if args.flatten:
        df = pd.json_normalize(json.loads(df.to_json(orient="records", date_format="iso")))

    if args.columns:
        missing = [c for c in args.columns if c not in df.columns]
        if missing:
            print(f"Warning: unknown column(s), ignoring: {', '.join(missing)}", file=sys.stderr)
        df = df[[c for c in args.columns if c in df.columns]]

    if args.tail is not None:
        df = df.tail(args.tail)
    elif args.head is not None:
        df = df.head(args.head)

    df = df.reset_index(drop=True)

    if args.interactive:
        print(f"Loaded {len(df)} row(s) into `df`. Explore away (df.head(), df[df.event=='...'], etc.)")
        import code

        code.interact(local={"df": df, "pd": pd})
        return

    if args.out:
        out_path = Path(args.out)
        export_df = _stringify_complex_cells(df)
        if out_path.suffix.lower() == ".csv":
            export_df.to_csv(out_path, index=False)
        elif out_path.suffix.lower() in (".xlsx", ".xls"):
            export_df.to_excel(out_path, index=False)
        elif out_path.suffix.lower() == ".json":
            df.to_json(out_path, orient="records", indent=2, date_format="iso")
        else:
            sys.exit(f"Unsupported --out extension: {out_path.suffix} (use .csv, .xlsx, or .json)")
        print(f"Wrote {len(df)} row(s) to {out_path}")
        return

    pd.set_option("display.max_columns", None)
    pd.set_option("display.width", None)
    pd.set_option("display.max_colwidth", args.max_colwidth if args.max_colwidth > 0 else None)
    print(f"{len(df)} row(s)\n")
    print(df.to_string())


if __name__ == "__main__":
    main()
