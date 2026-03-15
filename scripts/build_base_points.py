#!/usr/bin/env python3

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INPUT_CSV = ROOT / "data" / "old_cro_cno.csv"
OUTPUT_JSON = ROOT / "data" / "base_points.json"

# Mappa provincia -> regione
PROVINCE_TO_REGION = {
    "AGRIGENTO": "SICILIA",
    "ALESSANDRIA": "PIEMONTE",
    "ANCONA": "MARCHE",
    "AOSTA": "VALLE D'AOSTA",
    "AREZZO": "TOSCANA",
    "ASCOLI PICENO": "MARCHE",
    "ASTI": "PIEMONTE",
    "AVELLINO": "CAMPANIA",
    "BARI": "PUGLIA",
    "BARLETTA-ANDRIA-TRANI": "PUGLIA",
    "BELLUNO": "VENETO",
    "BENEVENTO": "CAMPANIA",
    "BERGAMO": "LOMBARDIA",
    "BIELLA": "PIEMONTE",
    "BOLOGNA": "EMILIA-ROMAGNA",
    "BOLZANO": "TRENTINO-ALTO ADIGE",
    "BRESCIA": "LOMBARDIA",
    "BRINDISI": "PUGLIA",
    "CAGLIARI": "SARDEGNA",
    "CALTANISSETTA": "SICILIA",
    "CAMPOBASSO": "MOLISE",
    "CASERTA": "CAMPANIA",
    "CATANIA": "SICILIA",
    "CATANZARO": "CALABRIA",
    "CHIETI": "ABRUZZO",
    "COMO": "LOMBARDIA",
    "COSENZA": "CALABRIA",
    "CREMONA": "LOMBARDIA",
    "CROTONE": "CALABRIA",
    "CUNEO": "PIEMONTE",
    "ENNA": "SICILIA",
    "FERMO": "MARCHE",
    "FERRARA": "EMILIA-ROMAGNA",
    "FIRENZE": "TOSCANA",
    "FOGGIA": "PUGLIA",
    "FORLÌ-CESENA": "EMILIA-ROMAGNA",
    "FROSINONE": "LAZIO",
    "GENOVA": "LIGURIA",
    "GORIZIA": "FRIULI-VENEZIA GIULIA",
    "GROSSETO": "TOSCANA",
    "IMPERIA": "LIGURIA",
    "ISERNIA": "MOLISE",
    "L'AQUILA": "ABRUZZO",
    "LA SPEZIA": "LIGURIA",
    "LATINA": "LAZIO",
    "LECCE": "PUGLIA",
    "LECCO": "LOMBARDIA",
    "LIVORNO": "TOSCANA",
    "LODI": "LOMBARDIA",
    "LUCCA": "TOSCANA",
    "MACERATA": "MARCHE",
    "MANTOVA": "LOMBARDIA",
    "MASSA-CARRARA": "TOSCANA",
    "MATERA": "BASILICATA",
    "MESSINA": "SICILIA",
    "MILANO": "LOMBARDIA",
    "MODENA": "EMILIA-ROMAGNA",
    "MONZA E DELLA BRIANZA": "LOMBARDIA",
    "NAPOLI": "CAMPANIA",
    "NOVARA": "PIEMONTE",
    "NUORO": "SARDEGNA",
    "ORISTANO": "SARDEGNA",
    "PADOVA": "VENETO",
    "PALERMO": "SICILIA",
    "PARMA": "EMILIA-ROMAGNA",
    "PAVIA": "LOMBARDIA",
    "PERUGIA": "UMBRIA",
    "PESARO E URBINO": "MARCHE",
    "PESCARA": "ABRUZZO",
    "PIACENZA": "EMILIA-ROMAGNA",
    "PISA": "TOSCANA",
    "PISTOIA": "TOSCANA",
    "PORDENONE": "FRIULI-VENEZIA GIULIA",
    "POTENZA": "BASILICATA",
    "PRATO": "TOSCANA",
    "RAGUSA": "SICILIA",
    "RAVENNA": "EMILIA-ROMAGNA",
    "REGGIO CALABRIA": "CALABRIA",
    "REGGIO EMILIA": "EMILIA-ROMAGNA",
    "RIETI": "LAZIO",
    "RIMINI": "EMILIA-ROMAGNA",
    "ROMA": "LAZIO",
    "ROVIGO": "VENETO",
    "SALERNO": "CAMPANIA",
    "SASSARI": "SARDEGNA",
    "SAVONA": "LIGURIA",
    "SIENA": "TOSCANA",
    "SIRACUSA": "SICILIA",
    "SONDRIO": "LOMBARDIA",
    "SUD SARDEGNA": "SARDEGNA",
    "TARANTO": "PUGLIA",
    "TERAMO": "ABRUZZO",
    "TERNI": "UMBRIA",
    "TORINO": "PIEMONTE",
    "TRAPANI": "SICILIA",
    "TRENTO": "TRENTINO-ALTO ADIGE",
    "TREVISO": "VENETO",
    "TRIESTE": "FRIULI-VENEZIA GIULIA",
    "UDINE": "FRIULI-VENEZIA GIULIA",
    "VARESE": "LOMBARDIA",
    "VENEZIA": "VENETO",
    "VERBANO-CUSIO-OSSOLA": "PIEMONTE",
    "VERCELLI": "PIEMONTE",
    "VERONA": "VENETO",
    "VIBO VALENTIA": "CALABRIA",
    "VICENZA": "VENETO",
    "VITERBO": "LAZIO",
}

def clean_string(value: str) -> str:
    return (value or "").strip()

def parse_float(value: str):
    value = clean_string(value).replace(",", ".")
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None

def build_point(row: dict) -> dict | None:
    provincia = clean_string(row.get("PROVINCIA", "")).upper()
    comune = clean_string(row.get("COMUNE", "")).upper()
    lat = parse_float(row.get("LATITUDINE", ""))
    lon = parse_float(row.get("LONGITUDINE", ""))

    if lat is None or lon is None:
        return None

    regione = PROVINCE_TO_REGION.get(provincia, "")

    return {
        "id": clean_string(row.get("ID_ELEMENTO", "")).upper(),
        "regione": regione,
        "provincia": provincia,
        "comune": comune,
        "lat": lat,
        "lon": lon,
        "codice_acl": clean_string(row.get("CODICE_ACL", "")).upper(),
        "centrale_tx": clean_string(row.get("CENTRALE_TX_DI_RIF", "")).upper(),
        "tipo": clean_string(row.get("TIPO", "")).upper(),
        "tipologia_cro": clean_string(row.get("TIPOLOGIA_CRO", "")).upper(),
        "stato": clean_string(row.get("STATO", "")).upper(),
        "data_disponibilita": clean_string(row.get("DATA_DISPONIBILITA", "")),
        "indirizzo": clean_string(row.get("INDIRIZZO", "")).upper(),
        "data_pubblicazione": clean_string(row.get("DATA_PUBBLICAZIONE", "")),
    }

def main():
    if not INPUT_CSV.exists():
        raise FileNotFoundError(f"File non trovato: {INPUT_CSV}")

    points = []
    skipped = 0

    with INPUT_CSV.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            point = build_point(row)
            if point is None:
                skipped += 1
                continue
            points.append(point)

    points.sort(key=lambda p: (p["regione"], p["provincia"], p["comune"], p["id"]))

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_JSON.open("w", encoding="utf-8") as f:
        json.dump(points, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Creati {len(points)} punti in {OUTPUT_JSON}")
    print(f"Scartate {skipped} righe senza coordinate valide")

if __name__ == "__main__":
    main()