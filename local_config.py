"""Load personal configuration without committing it or printing its values."""
from pathlib import Path
import os
import re

ROOT = Path(__file__).resolve().parent


def parse_env(text):
    values = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        match = re.fullmatch(r'(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)', line)
        if not match:
            raise ValueError('Invalid environment file entry')
        value = match[2].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        else:
            value = re.sub(r'\s+#.*$', '', value).strip()
        values[match[1]] = value
    return values


def load_config(path=None, environ=None):
    path = Path(path) if path is not None else ROOT / '.env.local'
    local = parse_env(path.read_text()) if path.exists() else {}
    values = {**local, **(os.environ if environ is None else environ)}
    postcode = values.get('ORIGIN_POSTCODE', '').strip().upper()
    if not postcode or postcode == 'YOUR_POSTCODE':
        raise ValueError('Set ORIGIN_POSTCODE in .env.local before running the finder')
    lat, lon = values.get('ORIGIN_LATITUDE'), values.get('ORIGIN_LONGITUDE')
    origin = (float(lon), float(lat)) if lat and lon else None
    if origin is not None and not (-180 <= origin[0] <= 180 and -90 <= origin[1] <= 90):
        raise ValueError('Invalid origin coordinates')
    radius = int(values.get('SEARCH_RADIUS_MILES', '40'))
    max_drive = int(values.get('DEFAULT_MAX_DRIVE_MINUTES', '60'))
    if not 1 <= radius <= 100 or not 1 <= max_drive <= 180:
        raise ValueError('Invalid search settings')
    return {'postcode': postcode, 'origin': origin, 'radius': radius, 'max_drive': max_drive}
