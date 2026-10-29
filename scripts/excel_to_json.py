#!/usr/bin/env python3
"""Import the tournament's Results worksheet into the static site's JSON data."""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from datetime import date, datetime
from pathlib import Path
from typing import Any

from openpyxl import load_workbook


EXPECTED_ROUNDS = 12
EXPECTED_PLACEMENTS = set(range(1, 12))


def normalize(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(character for character in text if not unicodedata.combining(character))
    return re.sub(r"\s+", " ", text).strip().casefold()


def placement_number(value: Any) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool):
        return value if 1 <= value <= 12 else None
    match = re.fullmatch(
        r"\s*(\d{1,2})\s*(?:°|º|o)?\s*(?:(?:posto|classificato|classifica))?\s*",
        str(value or ""),
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    number = int(match.group(1))
    return number if 1 <= number <= 12 else None


def parse_date(value: Any, row_number: int) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        text = value.strip()
        for date_format in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d"):
            try:
                return datetime.strptime(text, date_format).date().isoformat()
            except ValueError:
                continue
    raise ValueError(f"Data non riconosciuta alla riga {row_number}: {value!r}")


def find_results_layout(sheet: Any) -> tuple[int, int, dict[int, int], int]:
    for row_number in range(1, min(sheet.max_row, 40) + 1):
        headers = {
            column: normalize(sheet.cell(row_number, column).value)
            for column in range(1, sheet.max_column + 1)
        }
        placements = {
            placement_number(sheet.cell(row_number, column).value): column
            for column in range(1, sheet.max_column + 1)
            if placement_number(sheet.cell(row_number, column).value) is not None
        }
        joker_columns = [
            column for column, header in headers.items()
            if header in {"jolly", "jolly player", "giocatore jolly"}
        ]
        date_columns = [
            column for column, header in headers.items()
            if header in {"data", "date", "giornata", "data giornata"}
        ]
        if (
            set(placements) == EXPECTED_PLACEMENTS
            and len(joker_columns) == 1
            and len(date_columns) <= 1
        ):
            date_column = date_columns[0] if len(date_columns) == 1 else 1
            return row_number, date_column, placements, joker_columns[0]
    raise ValueError(
        "Non trovo nell'intestazione di 'Risultati' le colonne Data, 1°–11° e Jolly."
    )


def workbook_results(workbook_path: Path, players: list[dict[str, str]]) -> tuple[list[str], list[dict[str, Any]]]:
    workbook = load_workbook(workbook_path, data_only=True, read_only=True)
    sheet_names = {normalize(sheet_name): sheet_name for sheet_name in workbook.sheetnames}
    if "risultati" not in sheet_names:
        raise ValueError("Il file Excel deve contenere un foglio chiamato 'Risultati'.")

    sheet = workbook[sheet_names["risultati"]]
    header_row, date_column, placement_columns, joker_column = find_results_layout(sheet)
    player_ids = {normalize(player["name"]): player["id"] for player in players}
    rows_by_date: dict[str, dict[str, Any]] = {}
    joker_users: set[str] = set()

    for row_number in range(header_row + 1, sheet.max_row + 1):
        row = {
            column: sheet.cell(row_number, column).value
            for column in range(1, sheet.max_column + 1)
        }
        date_value = row.get(date_column)
        has_values = any(value not in (None, "") for value in row.values())
        if date_value in (None, ""):
            if has_values:
                raise ValueError(
                    f"La riga {row_number} di 'Risultati' contiene dati ma non ha una data."
                )
            continue

        round_date = parse_date(date_value, row_number)
        if round_date in rows_by_date:
            raise ValueError(f"La data {round_date} è ripetuta nel foglio 'Risultati'.")

        placements: list[str | None] = [None] * 12
        for placement, column in placement_columns.items():
            value = row.get(column)
            if value in (None, ""):
                continue
            player_id = player_ids.get(normalize(value))
            if player_id is None:
                raise ValueError(
                    f"Nome giocatore sconosciuto alla riga {row_number}, "
                    f"piazzamento {placement}: {value!r}"
                )
            placements[placement - 1] = player_id

        filled = [player_id for player_id in placements if player_id is not None]
        if len(set(filled)) != len(filled):
            raise ValueError(f"Un giocatore è ripetuto nella serata del {round_date}.")

        joker_value = row.get(joker_column)
        joker_player_id = None
        if joker_value not in (None, ""):
            joker_player_id = player_ids.get(normalize(joker_value))
            if joker_player_id is None:
                raise ValueError(
                    f"Il valore della colonna Jolly alla riga {row_number} "
                    f"non corrisponde a un giocatore: {joker_value!r}"
                )
            if joker_player_id not in filled:
                raise ValueError(
                    f"Il giocatore con il jolly non ha un piazzamento nella serata del {round_date}."
                )
            if joker_player_id in joker_users:
                raise ValueError(f"{joker_value!r} risulta aver usato il jolly più di una volta.")
            joker_users.add(joker_player_id)

        rows_by_date[round_date] = {
            "date": round_date,
            "placements": placements,
            "jokerPlayerId": joker_player_id,
        }

    workbook.close()
    if len(rows_by_date) != EXPECTED_ROUNDS:
        raise ValueError(
            f"Il foglio 'Risultati' deve contenere tutte le {EXPECTED_ROUNDS} date "
            f"del torneo; trovate {len(rows_by_date)}."
        )
    dates = sorted(rows_by_date)
    return dates, [rows_by_date[round_date] for round_date in dates]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbook", type=Path, required=True, help="Percorso al file Excel.")
    parser.add_argument("--data", type=Path, required=True, help="Percorso a data/torneo.json.")
    args = parser.parse_args()

    try:
        data = json.loads(args.data.read_text(encoding="utf-8"))
        dates, rounds = workbook_results(args.workbook, data["players"])
        data["calendar"] = dates
        data["rounds"] = rounds
        args.data.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except (OSError, KeyError, ValueError) as error:
        print(f"Errore importando il foglio Excel: {error}", file=sys.stderr)
        return 1

    print(f"Importate {len(rounds)} giornate da {args.workbook}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
