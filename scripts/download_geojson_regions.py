import os
import json
import urllib.request
import re

URL = "https://raw.githubusercontent.com/openpolis/geojson-italy/master/geojson/limits_IT_municipalities.geojson"

OUTPUT_DIR = "data/geojson/regions"
os.makedirs(OUTPUT_DIR, exist_ok=True)

tmp_file = "tmp_municipalities.geojson"

print("Downloading national municipalities GeoJSON...")
urllib.request.urlretrieve(URL, tmp_file)

print("Loading dataset...")
with open(tmp_file) as f:
    data = json.load(f)

def normalize_region(name):
    name = name.split("/")[0]  # prende solo la parte prima della slash
    name = name.lower()
    name = name.replace(" ", "-")
    name = name.replace("'", "")
    name = re.sub(r"[^a-z\-]", "", name)
    return name

regions = {}

for feature in data["features"]:
    region_name = feature["properties"]["reg_name"]
    region = normalize_region(region_name)
    regions.setdefault(region, []).append(feature)

print("Splitting by region...")

for region, features in regions.items():
    region_geojson = {
        "type": "FeatureCollection",
        "features": features
    }

    path = os.path.join(OUTPUT_DIR, f"{region}.geojson")

    with open(path, "w") as f:
        json.dump(region_geojson, f)

    print(f"Created {region}.geojson")

os.remove(tmp_file)

print("Done.")