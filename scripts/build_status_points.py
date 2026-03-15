#!/usr/bin/env python3

from __future__ import annotations

import csv
import io
import json
import socket
import sys
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
SOURCE_URL = (
    "https://areaclienti.market.fibercop.com/sitepub/SFTP/"
    "59_Coperture_Bitstream_NGA_e_VULA/Elenco_CRO_CNO.zip"
)
OUTPUT_JSON = ROOT / "data" / "status_points.json"
SUPPORTED_ENCODINGS = ("utf-8-sig", "utf-8", "cp1252", "latin-1")
REQUIRED_COLUMNS = {"ID_ELEMENTO", "STATO", "DATA_DISPONIBILITA"}


class BuildStatusPointsError(Exception):
    """Errore previsto durante la generazione di status_points.json."""


def clean_string(value: str | None) -> str:
    return (value or "").strip()


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def download_zip_bytes(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "fibercop-map-status-builder/1.0"},
    )

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        raise BuildStatusPointsError(
            f"Download fallito con HTTP {exc.code}: {url}"
        ) from exc
    except urllib.error.URLError as exc:
        raise BuildStatusPointsError(
            f"Download fallito: {exc.reason}"
        ) from exc
    except (TimeoutError, socket.timeout) as exc:
        raise BuildStatusPointsError("Download fallito per timeout.") from exc


def read_zip_csv(zip_bytes: bytes) -> tuple[str, bytes]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile as exc:
        raise BuildStatusPointsError("Il file scaricato non e' uno ZIP valido.") from exc

    with archive:
        csv_members = [
            info for info in archive.infolist()
            if not info.is_dir() and info.filename.lower().endswith(".csv")
        ]

        if not csv_members:
            raise BuildStatusPointsError("Nessun file CSV trovato nello ZIP.")

        if len(csv_members) > 1:
            csv_names = ", ".join(info.filename for info in csv_members)
            raise BuildStatusPointsError(
                f"Trovati piu' file CSV nello ZIP, situazione ambigua: {csv_names}"
            )

        csv_info = csv_members[0]
        return PurePosixPath(csv_info.filename).name, archive.read(csv_info)


def open_csv_reader(
    csv_bytes: bytes,
) -> tuple[csv.DictReader, dict[str, str], str]:
    errors = []

    # Accetta solo una decodifica che espone davvero le colonne richieste.
    for encoding in SUPPORTED_ENCODINGS:
        try:
            text = csv_bytes.decode(encoding)
        except UnicodeDecodeError as exc:
            errors.append(f"{encoding}: {exc}")
            continue

        reader = csv.DictReader(io.StringIO(text, newline=""), delimiter=";")
        fieldnames = reader.fieldnames or []
        columns = {
            clean_string(name).upper(): name
            for name in fieldnames
            if clean_string(name)
        }
        missing = sorted(REQUIRED_COLUMNS - set(columns))
        if missing:
            errors.append(
                f"{encoding}: colonne mancanti {', '.join(missing)}"
            )
            continue

        return reader, columns, encoding

    joined_errors = "; ".join(errors) if errors else "nessun dettaglio disponibile"
    raise BuildStatusPointsError(
        "Impossibile leggere il CSV con le codifiche supportate: "
        f"{joined_errors}"
    )


def build_entry_score(entry: dict[str, str], row_number: int) -> tuple[int, str, int]:
    date_value = clean_string(entry.get("data_disponibilita"))
    return (1 if date_value else 0, date_value, row_number)


def build_status_map(
    reader: csv.DictReader,
    columns: dict[str, str],
) -> tuple[dict[str, dict[str, str]], int, int, int, int]:
    items: dict[str, dict[str, str]] = {}
    scores: dict[str, tuple[int, str, int]] = {}
    processed_rows = 0
    skipped_rows = 0
    duplicate_rows = 0
    conflicting_ids = set()

    id_key = columns["ID_ELEMENTO"]
    status_key = columns["STATO"]
    availability_key = columns["DATA_DISPONIBILITA"]

    for row_number, row in enumerate(reader, start=2):
        processed_rows += 1

        item_id = clean_string(row.get(id_key)).upper()
        if not item_id:
            skipped_rows += 1
            continue

        entry = {
            "stato": clean_string(row.get(status_key)),
            "data_disponibilita": clean_string(row.get(availability_key)),
        }

        if item_id in items:
            duplicate_rows += 1
            if items[item_id] != entry:
                conflicting_ids.add(item_id)

            # Il formato finale prevede una sola voce per ID_ELEMENTO.
            candidate_score = build_entry_score(entry, row_number)
            if candidate_score >= scores[item_id]:
                items[item_id] = entry
                scores[item_id] = candidate_score
            continue

        items[item_id] = entry
        scores[item_id] = build_entry_score(entry, row_number)

    sorted_items = {key: items[key] for key in sorted(items)}
    return sorted_items, processed_rows, skipped_rows, duplicate_rows, len(conflicting_ids)


def write_output(source_file: str, items: dict[str, dict[str, str]]) -> None:
    payload = {
        "source_file": source_file,
        "updated_at": utc_timestamp(),
        "items": items,
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_JSON.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))


def main() -> int:
    try:
        zip_bytes = download_zip_bytes(SOURCE_URL)
        source_file, csv_bytes = read_zip_csv(zip_bytes)
        reader, columns, encoding = open_csv_reader(csv_bytes)
        items, processed_rows, skipped_rows, duplicate_rows, conflicting_ids = build_status_map(
            reader,
            columns,
        )
        write_output(source_file, items)
    except BuildStatusPointsError as exc:
        print(f"Errore: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Operazione interrotta dall'utente.", file=sys.stderr)
        return 130

    print(f"CSV trovato: {source_file}")
    print(f"Encoding usato: {encoding}")
    print(f"Elaborati {processed_rows} record dal CSV.")
    print(f"Salvati {len(items)} ID univoci in {OUTPUT_JSON}.")
    if skipped_rows:
        print(f"Saltate {skipped_rows} righe senza ID_ELEMENTO.")
    if duplicate_rows:
        print(
            f"Compattate {duplicate_rows} righe duplicate; "
            f"{conflicting_ids} ID avevano stato/data differenti."
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
