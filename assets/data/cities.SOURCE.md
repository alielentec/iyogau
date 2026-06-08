# cities.json — Source & Attribution

## Source

The data in `cities.json` is derived from the **GeoNames cities15000** export
(<https://download.geonames.org/export/dump/cities15000.zip>) combined with
the GeoNames `countryInfo.txt` lookup
(<https://download.geonames.org/export/dump/countryInfo.txt>) for the
human-readable country names.

GeoNames is licensed under
**[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)**.

## Filtering

From the ~33,700 cities in `cities15000` (population &ge; 15,000), we kept
the **top 5,000 by population** (minimum population in the bundled set:
~120,000). This stays within the &lt;120&nbsp;KB gzipped budget while still
covering every population centre our prospective students are likely to
have been born in.

## Output shape

```json
[
  { "name": "Seoul", "country": "South Korea",
    "lat": 37.5665, "lon": 126.978, "tz": "Asia/Seoul" }
]
```

Coordinates are rounded to 4 decimal places (&asymp;11&nbsp;m precision,
ample for natal-chart sidereal calculations whose ayanamsa drift dwarfs
any sub-arc-second positional error).

## Attribution requirement (CC BY 4.0)

The licence requires we credit the source. This file satisfies the
requirement; an additional credit line is rendered in the footer of
`/natal-chart/` (and is also surfaced in the page&rsquo;s machine-readable
&lsquo;data provenance&rsquo; JSON-LD).

## Regenerating

```bash
# Fetch raw data
curl -sSL https://download.geonames.org/export/dump/cities15000.zip -o cities15000.zip
curl -sSL https://download.geonames.org/export/dump/countryInfo.txt  -o countryInfo.txt
unzip cities15000.zip

# Build (see scripts/build-cities.py — same logic used to produce the bundled file):
#   1. Parse countryInfo.txt: column 1 (cc) -> column 5 (full name)
#   2. Parse cities15000.txt: keep name (col 2), cc (col 9), lat (col 5),
#      lon (col 6), tz (col 18), pop (col 15)
#   3. Sort by pop desc, take top 5000
#   4. Emit compact JSON with country names resolved
```
