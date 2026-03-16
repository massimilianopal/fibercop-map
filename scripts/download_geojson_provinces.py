#!/usr/bin/env python3

import json
import re
import tempfile
import unicodedata
import urllib.request
from collections import defaultdict
from pathlib import Path


URL = "https://raw.githubusercontent.com/openpolis/geojson-italy/master/geojson/limits_IT_provinces.geojson"
ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT / "data" / "geojson" / "provinces"


def normalize_region_name(name):
    primary_name = str(name or "").split("/")[0].strip()

    if not primary_name:
        raise ValueError("Missing region name in GeoJSON feature.")

    normalized_name = unicodedata.normalize("NFD", primary_name)
    normalized_name = "".join(
        character
        for character in normalized_name
        if unicodedata.category(character) != "Mn"
    )
    normalized_name = normalized_name.lower().replace("'", "")
    normalized_name = re.sub(r"[^a-z0-9]+", "-", normalized_name)
    normalized_name = re.sub(r"-+", "-", normalized_name).strip("-")

    if not normalized_name:
        raise ValueError(f"Unable to normalize region name: {name!r}")

    return normalized_name


def download_national_geojson(url, destination):
    print("Downloading national provinces GeoJSON...")
    urllib.request.urlretrieve(url, destination)


def load_geojson(path):
    print("Loading dataset...")
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def split_features_by_region(data):
    grouped_features = defaultdict(list)

    for feature in data.get("features", []):
        region_name = feature.get("properties", {}).get("reg_name")
        region_slug = normalize_region_name(region_name)
        grouped_features[region_slug].append(feature)

    return grouped_features


def write_region_files(grouped_features):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Splitting by region...")

    for region_slug in sorted(grouped_features):
        output_path = OUTPUT_DIR / f"{region_slug}.geojson"
        feature_collection = {
            "type": "FeatureCollection",
            "features": grouped_features[region_slug],
        }

        with output_path.open("w", encoding="utf-8") as handle:
            json.dump(feature_collection, handle, ensure_ascii=False)

        print(f"Created {output_path.name}")


def main():
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir) / "limits_IT_provinces.geojson"
        download_national_geojson(URL, temp_path)
        data = load_geojson(temp_path)

    write_region_files(split_features_by_region(data))
    print("Done.")


if __name__ == "__main__":
    main()
