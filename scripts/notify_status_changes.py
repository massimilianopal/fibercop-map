#!/usr/bin/env python3

from __future__ import annotations

import json
import logging
import os
import socket
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
STATUS_POINTS_PATH = ROOT / "data" / "status_points.json"
BASE_POINTS_PATH = ROOT / "data" / "base_points.json"
TARGET_STATES = {"ATTIVO", "DISPONIBILE"}
REQUEST_TIMEOUT_SECONDS = 30


class NotificationError(Exception):
    """Errore previsto durante il processo di notifica."""


@dataclass(frozen=True)
class StatusChange:
    point_id: str
    previous_state: str
    new_state: str


@dataclass(frozen=True)
class BasePointInfo:
    point_id: str
    comune: str
    provincia: str
    indirizzo: str


def clean_string(value: Any) -> str:
    return str(value or "").strip()


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(message)s",
    )


def load_json_file(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise NotificationError(f"File non trovato: {path}") from exc
    except json.JSONDecodeError as exc:
        raise NotificationError(f"JSON non valido in {path}: {exc}") from exc


def extract_status_map(payload: Any, source_name: str) -> dict[str, str]:
    if not isinstance(payload, dict):
        raise NotificationError(f"{source_name} non contiene un oggetto JSON valido.")

    items = payload.get("items")
    if not isinstance(items, dict):
        raise NotificationError(f"{source_name} non contiene la chiave 'items' valida.")

    state_map: dict[str, str] = {}
    skipped_items = 0

    for raw_point_id, raw_entry in items.items():
        point_id = clean_string(raw_point_id).upper()
        if not point_id or not isinstance(raw_entry, dict):
            skipped_items += 1
            continue

        state = clean_string(raw_entry.get("stato")).upper()
        if not state:
            skipped_items += 1
            continue

        state_map[point_id] = state

    if skipped_items:
        logging.warning("%s contiene %d record di stato non validi.", source_name, skipped_items)

    return state_map


def load_previous_status_map_from_git() -> dict[str, str]:
    git_path = STATUS_POINTS_PATH.relative_to(ROOT).as_posix()
    command = ["git", "show", f"HEAD:{git_path}"]
    result = subprocess.run(
        command,
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    if result.returncode != 0:
        stderr = clean_string(result.stderr)
        missing_path_markers = (
            "exists on disk, but not in 'HEAD'",
            "does not exist in 'HEAD'",
        )

        if any(marker in stderr for marker in missing_path_markers):
            logging.info("Nessuna versione precedente di %s trovata in git.", git_path)
            return {}

        raise NotificationError(
            f"Impossibile leggere la versione precedente di {git_path} da git: {stderr}"
        )

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise NotificationError(
            f"La versione precedente di {git_path} in git non contiene JSON valido: {exc}"
        ) from exc

    return extract_status_map(payload, f"git:{git_path}")


def find_relevant_changes(
    previous_map: dict[str, str],
    current_map: dict[str, str],
) -> list[StatusChange]:
    changes: list[StatusChange] = []
    changed_points = 0
    new_points_without_previous_state = 0

    for point_id, new_state in current_map.items():
        previous_state = previous_map.get(point_id)
        if previous_state is None:
            new_points_without_previous_state += 1
            continue

        if previous_state == new_state:
            continue

        changed_points += 1
        if new_state not in TARGET_STATES:
            continue

        changes.append(
            StatusChange(
                point_id=point_id,
                previous_state=previous_state,
                new_state=new_state,
            )
        )

    changes.sort(key=lambda item: item.point_id)
    logging.info(
        "Rilevati %d cambi di stato, %d notificabili verso %s.",
        changed_points,
        len(changes),
        ", ".join(sorted(TARGET_STATES)),
    )
    if new_points_without_previous_state:
        logging.info(
            "Ignorati %d point_id senza stato precedente nel file versionato.",
            new_points_without_previous_state,
        )

    return changes


def base_point_priority(raw_point: dict[str, Any]) -> tuple[int, int, int, int]:
    return (
        1 if clean_string(raw_point.get("indirizzo")) else 0,
        1 if clean_string(raw_point.get("comune")) else 0,
        1 if clean_string(raw_point.get("provincia")) else 0,
        1 if clean_string(raw_point.get("tipo")).upper() == "CRO" else 0,
    )


def load_base_point_index() -> tuple[dict[str, BasePointInfo], dict[str, int]]:
    payload = load_json_file(BASE_POINTS_PATH)
    if not isinstance(payload, list):
        raise NotificationError(f"{BASE_POINTS_PATH} non contiene una lista JSON valida.")

    index: dict[str, BasePointInfo] = {}
    scores: dict[str, tuple[int, int, int, int]] = {}
    counts: Counter[str] = Counter()

    for raw_point in payload:
        if not isinstance(raw_point, dict):
            continue

        point_id = clean_string(raw_point.get("id")).upper()
        if not point_id:
            continue

        counts[point_id] += 1
        candidate = BasePointInfo(
            point_id=point_id,
            comune=clean_string(raw_point.get("comune")).upper(),
            provincia=clean_string(raw_point.get("provincia")).upper(),
            indirizzo=clean_string(raw_point.get("indirizzo")).upper(),
        )
        candidate_score = base_point_priority(raw_point)

        if point_id not in index or candidate_score > scores[point_id]:
            index[point_id] = candidate
            scores[point_id] = candidate_score

    duplicate_counts = {
        point_id: occurrences
        for point_id, occurrences in counts.items()
        if occurrences > 1
    }
    return index, duplicate_counts


def request_json(
    url: str,
    *,
    method: str,
    headers: dict[str, str] | None = None,
    params: dict[str, str] | None = None,
    json_body: dict[str, Any] | None = None,
) -> Any:
    final_url = url
    if params:
        final_url = f"{url}?{urllib.parse.urlencode(params)}"

    request_headers = dict(headers or {})
    body_bytes: bytes | None = None

    if json_body is not None:
        body_bytes = json.dumps(json_body).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")

    request = urllib.request.Request(
        final_url,
        data=body_bytes,
        headers=request_headers,
        method=method,
    )

    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        error_text = exc.read().decode("utf-8", errors="replace")
        raise NotificationError(
            f"HTTP {exc.code} su {url}: {clean_string(error_text) or exc.reason}"
        ) from exc
    except urllib.error.URLError as exc:
        raise NotificationError(f"Richiesta fallita verso {url}: {exc.reason}") from exc
    except socket.timeout as exc:
        raise NotificationError(f"Timeout durante la richiesta verso {url}.") from exc

    if not body:
        return None

    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise NotificationError(f"Risposta JSON non valida da {url}: {exc}") from exc


def require_env(name: str) -> str:
    value = clean_string(os.environ.get(name))
    if not value:
        raise NotificationError(f"Variabile d'ambiente mancante: {name}")
    return value


def fetch_subscribed_chat_ids(
    supabase_url: str,
    service_role_key: str,
    point_id: str,
) -> list[str]:
    url = f"{supabase_url.rstrip('/')}/rest/v1/subscriptions"
    rows = request_json(
        url,
        method="GET",
        headers={
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Accept": "application/json",
        },
        params={
            "select": "chat_id",
            "point_id": f"eq.{point_id}",
        },
    )

    if rows is None:
        return []

    if not isinstance(rows, list):
        raise NotificationError(
            f"Risposta Supabase inattesa per point_id {point_id}: attesa una lista JSON."
        )

    chat_ids: list[str] = []
    seen_chat_ids: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue

        chat_id = clean_string(row.get("chat_id"))
        if not chat_id or chat_id in seen_chat_ids:
            continue

        seen_chat_ids.add(chat_id)
        chat_ids.append(chat_id)

    return chat_ids


def render_field(value: str) -> str:
    return value or "N/D"


def build_notification_message(change: StatusChange, point: BasePointInfo | None) -> str:
    if point is None:
        point = BasePointInfo(
            point_id=change.point_id,
            comune="",
            provincia="",
            indirizzo="",
        )

    return "\n".join(
        [
            "Aggiornamento punto monitorato FiberCop",
            f"point_id: {change.point_id}",
            f"comune: {render_field(point.comune)}",
            f"provincia: {render_field(point.provincia)}",
            f"indirizzo: {render_field(point.indirizzo)}",
            f"stato precedente: {render_field(change.previous_state)}",
            f"nuovo stato: {render_field(change.new_state)}",
        ]
    )


def send_telegram_message(bot_token: str, chat_id: str, text: str) -> None:
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    response = request_json(
        url,
        method="POST",
        headers={"Accept": "application/json"},
        json_body={
            "chat_id": chat_id,
            "text": text,
        },
    )

    if not isinstance(response, dict) or response.get("ok") is not True:
        raise NotificationError(
            f"Telegram ha restituito una risposta inattesa per chat_id {chat_id}: {response}"
        )


def main() -> int:
    configure_logging()

    try:
        current_status_map = extract_status_map(
            load_json_file(STATUS_POINTS_PATH),
            str(STATUS_POINTS_PATH),
        )
        previous_status_map = load_previous_status_map_from_git()
        changes = find_relevant_changes(previous_status_map, current_status_map)

        if not changes:
            logging.info("Nessun cambiamento verso ATTIVO o DISPONIBILE: nessuna notifica inviata.")
            return 0

        base_point_index, duplicate_base_points = load_base_point_index()
        supabase_url = require_env("SUPABASE_URL")
        service_role_key = require_env("SUPABASE_SERVICE_ROLE_KEY")

        subscribers_by_point: dict[str, list[str]] = {}
        total_subscribers = 0
        for change in changes:
            chat_ids = fetch_subscribed_chat_ids(
                supabase_url=supabase_url,
                service_role_key=service_role_key,
                point_id=change.point_id,
            )
            subscribers_by_point[change.point_id] = chat_ids
            total_subscribers += len(chat_ids)

            if chat_ids:
                logging.info(
                    "Point %s: trovati %d iscritti.",
                    change.point_id,
                    len(chat_ids),
                )
            else:
                logging.info("Point %s: nessun iscritto.", change.point_id)

        if total_subscribers == 0:
            logging.info("Nessun iscritto per i point_id cambiati: nessuna notifica inviata.")
            return 0

        bot_token = require_env("TELEGRAM_BOT_TOKEN")
        sent_notifications: set[tuple[str, str]] = set()
        sent_count = 0
        failed_count = 0

        for change in changes:
            point = base_point_index.get(change.point_id)
            if point is None:
                logging.warning(
                    "Point %s non trovato in %s; uso campi anagrafici vuoti.",
                    change.point_id,
                    BASE_POINTS_PATH,
                )
            elif change.point_id in duplicate_base_points:
                logging.warning(
                    "Point %s compare %d volte in %s; uso il record con piu' dati utili.",
                    change.point_id,
                    duplicate_base_points[change.point_id],
                    BASE_POINTS_PATH,
                )

            message = build_notification_message(change, point)
            for chat_id in subscribers_by_point.get(change.point_id, []):
                notification_key = (chat_id, change.point_id)
                if notification_key in sent_notifications:
                    logging.info(
                        "Notifica duplicata evitata per point %s verso chat %s.",
                        change.point_id,
                        chat_id,
                    )
                    continue

                try:
                    send_telegram_message(bot_token=bot_token, chat_id=chat_id, text=message)
                except NotificationError as exc:
                    failed_count += 1
                    logging.error(
                        "Invio Telegram fallito per point %s verso chat %s: %s",
                        change.point_id,
                        chat_id,
                        exc,
                    )
                    continue

                sent_notifications.add(notification_key)
                sent_count += 1
                logging.info(
                    "Notifica inviata per point %s verso chat %s.",
                    change.point_id,
                    chat_id,
                )

        logging.info(
            "Run completato: %d notifiche inviate, %d errori Telegram.",
            sent_count,
            failed_count,
        )
        return 0
    except NotificationError as exc:
        logging.error("%s", exc)
        return 1
    except KeyboardInterrupt:
        logging.error("Operazione interrotta dall'utente.")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
