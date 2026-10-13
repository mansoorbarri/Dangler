#!/usr/bin/env python3
"""Parallel software degree apprenticeship finder. Python 3.10+, no dependencies."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html import unescape
import json
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
from local_config import load_config

ROOT = Path(__file__).resolve().parent
STATE = ROOT / "data"
SOURCES = {
    "gov": "https://www.findapprenticeship.service.gov.uk/apprenticeships?sort=AgeAsc&levelIds=6",
    "higherin": "https://higherin.com/search-jobs/degree-apprenticeship/software-engineering",
    "ngtu": "https://api.notgoingtouni.co.uk/api/fn/v1/opportunities?opportunity_type=degree-apprenticeship&per_page=24",
}
TOWNS = {
    "manchester": (53.4808, -2.2426), "liverpool": (53.4084, -2.9916),
    "warrington": (53.39, -2.597), "bolton": (53.5769, -2.4282),
    "wigan": (53.544, -2.6325), "salford": (53.4875, -2.2901),
    "cheadle": (53.394, -2.214), "stockport": (53.4106, -2.1575),
    "altrincham": (53.3875, -2.3485), "knutsford": (53.302, -2.374),
    "radbroke": (53.274, -2.343), "wilmslow": (53.328, -2.232),
    "bury": (53.593, -2.298), "rochdale": (53.61, -2.157),
    "oldham": (53.54, -2.118), "leigh": (53.497, -2.519),
    "preston": (53.763, -2.703), "chester": (53.191, -2.891),
    "runcorn": (53.341, -2.733), "widnes": (53.363, -2.728),
    "st helens": (53.454, -2.737), "st. helens": (53.454, -2.737),
    "macclesfield": (53.259, -2.127), "broughton": (53.163, -2.993),
    "northwich": (53.262, -2.514), "crewe": (53.099, -2.441),
    "blackburn": (53.749, -2.484), "burnley": (53.789, -2.248),
}
REGIONS = ("greater manchester", "merseyside", "cheshire", "lancashire", "north west", "north-west", "remote")


def clean(value):
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]*>", " ", str(value or "")))).strip()


def software_match(title, level):
    text = title + " " + level
    return bool(re.search(r"software\s*(engineering|engineer|development|developer)|(?:web|application|full.stack)\s*developer", title, re.I)
                and re.search(r"level\s*6|\bl6\b|degree", text, re.I)
                and not re.search(r"level\s*[23457]|\bl[23457]\b|master", text, re.I))


def closing_timestamp(raw):
    value = re.sub(r"^Closes?\s+(?:on\s+)?", "", raw, flags=re.I)
    value = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", value)
    value = re.sub(r"\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b,?\s*", "", value).strip()
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        try:
            return datetime.strptime(value, "%d %B %Y").replace(tzinfo=timezone.utc).timestamp()
        except ValueError:
            return None


def make_job(source, identifier, title, company, location, salary, closing, url, course, start=""):
    return dict(id=f"{source}:{identifier}", source=source, title=clean(title), company=clean(company),
                location=clean(location) or "Location not specified", salary=clean(salary) or "Not specified",
                closing=clean(closing) or "Not specified", closing_at=closing_timestamp(closing or ""),
                url=url, course=clean(course), start=clean(start),
                interest=bool(re.search(r"register.*interest", title, re.I)))


def parse_gov(html):
    if not any(t in html for t in ("faa-search-results", "das-search-results")) and not re.search(r"no results|0 apprenticeships", html, re.I):
        raise ValueError("GOV.UK results format changed or access was blocked")
    jobs = []
    for block in re.split(r'<li\b[^>]*class="[^"]*das-search-results__list-item[^"]*"[^>]*>', html)[1:]:
        card = block.split("</li>")[0]
        link = re.search(r'<a\b[^>]*href="(/apprenticeship/[^"?#]+)"[^>]*>([\s\S]*?)</a>', card)
        if not link:
            continue
        def field(name):
            match = re.search(r"<b>" + name + r"</b>([\s\S]*?)</p>", card, re.I)
            return clean(match[1]) if match else ""
        def find(pattern):
            match = re.search(pattern, card)
            return clean(match[1]) if match else ""
        title, course = clean(link[2]), field("Training course")
        if not software_match(title, course):
            continue
        jobs.append(make_job("gov", link[1].split("/")[-1], title,
                             find(r'<p class="govuk-body govuk-!-margin-bottom-0">([\s\S]*?)</p>'),
                             find(r'<p class="govuk-body das-!-color-dark-grey">([\s\S]*?)</p>'),
                             field("Wage"), find(r"(Closes on[^<]+)"),
                             "https://www.findapprenticeship.service.gov.uk" + link[1], course, field("Start date")))
    return jobs, bool(re.search(r'govuk-pagination__next|govuk-pagination__link[^>]*rel="next"', html))


def parse_higherin(html):
    match = re.search(r"window\.__RMP_SEARCH_RESULTS_INITIAL_STATE__\s*=\s*", html)
    if not match:
        raise ValueError("Higherin results format changed or access was blocked")
    data, _ = json.JSONDecoder().raw_decode(html[match.end():])
    if not isinstance(data.get("data"), list):
        raise ValueError("Unexpected Higherin response")
    jobs = [make_job("higherin", j["id"], j["jobTitle"], j.get("companyName"),
                     j.get("jobLocationNames"), j.get("salary"), j.get("deadline"), j["url"],
                     j.get("jobTypeName", ""), j.get("employmentStartDate", ""))
            for j in data["data"] if software_match(j.get("jobTitle", ""), j.get("jobTypeName", ""))]
    return jobs, bool(data.get("meta", {}).get("pagination", {}).get("hasMorePages"))


def parse_ngtu(raw):
    page = json.loads(raw)["data"]
    if not isinstance(page.get("data"), list):
        raise ValueError("Unexpected Not Going To Uni response")
    jobs = []
    for j in page["data"]:
        course = j.get("category", {}).get("name", "")
        if j.get("is_currently_live") is False or not software_match(j.get("title", ""), course):
            continue
        provider = j.get("provider") or {}
        location = ", ".join(t["name"] for t in j.get("towns", []) + j.get("counties", [])) or j.get("address")
        url = "https://notgoingtouni.co.uk/" + quote(provider.get("provider_slug", "provider")) + "/opportunity-detail/" + quote(j["opportunity_slug"])
        jobs.append(make_job("ngtu", j["id"], j["title"], provider.get("name"), location,
                             j.get("salary"), j.get("end") or j.get("job_expiration_date"), url,
                             course, j.get("job_start_date", "")))
    return jobs, page["current_page"] < page["last_page"]


PARSERS = {"gov": parse_gov, "higherin": parse_higherin, "ngtu": parse_ngtu}


def request(url, timeout=8):
    req = Request(url, headers={"User-Agent": "Dangler/1.0 apprenticeship search", "Accept": "application/json,text/html"})
    # Bounded retry for transient errors, not access blocks or changed formats.
    for attempt in range(2):
        try:
            with urlopen(req, timeout=timeout) as response:
                return response.read().decode("utf-8")
        except HTTPError as error:
            if error.code not in (502, 503, 504) or attempt:
                raise
        except (URLError, TimeoutError):
            if attempt:
                raise
        time.sleep(0.2)


def read_json(path, default):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, ValueError, OSError):
        return default


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False))
    temporary.replace(path)


def fetch_source(source, refresh=False, max_pages=10, config=None):
    config = load_config() if config is None else config
    path = STATE / (source + ".json")
    cached = read_json(path, {})
    if not refresh and cached and time.time() - cached.get("checked_at", 0) < 900 and not cached.get("error"):
        return {**cached, "cached": True}
    jobs = []
    try:
        more = False
        for page in range(1, max_pages + 1):
            base = SOURCES[source] + ("&" + urlencode({"location": config["postcode"], "distance": config["radius"]}) if source == "gov" else "")
            url = base + ("&pageNumber=" if source == "gov" else "?page=" if source == "higherin" else "&page=") + str(page)
            batch, more = PARSERS[source](request(url))
            jobs.extend(batch)
            if not more:
                break
        result = dict(jobs=jobs, checked_at=time.time(), error=None, incomplete=more, cached=False)
        write_json(path, result)
        return result
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, KeyError, TypeError) as error:
        # Never destroy the last successful cache when a source fails.
        return dict(jobs=cached.get("jobs", jobs), checked_at=cached.get("checked_at"), error=str(error), incomplete=True, cached=bool(cached))


def nearby(location):
    return any(t in location.lower() for t in (*TOWNS, *REGIONS))


def duplicate_key(job):
    def normalize(text):
        return re.sub("[^a-z]", "", re.sub(r"\b(limited|ltd|uk|plc|202\d|level|6|digital|and|technology|solutions|professional|degree|apprentice|apprenticeship)\b", "", text.lower()))
    town = next((t for t in TOWNS if t in job["location"].lower()), job["location"].lower())
    if town == "stockport":
        town = "cheadle"
    year = re.search(r"202\d", job["start"] + " " + job["title"])
    year = year[0] if year else str(datetime.fromtimestamp(job["closing_at"], timezone.utc).year) if job["closing_at"] else ""
    title = re.sub(r"\s*-\s*(?:Cheadle|Stockport)$", "", job["title"], flags=re.I)
    return normalize(job["company"]), town, normalize(title), year, job["closing_at"]


def deduplicate(jobs):
    groups = {}
    for job in jobs:
        key = duplicate_key(job)
        if key in groups and (job["closing_at"] is None or (groups[key]["source"] == job["source"] and groups[key]["url"] != job["url"])):
            key = (*key, job["id"])
        if key in groups:
            groups[key]["also_listed_on"].append({"id": job["id"], "source": job["source"], "url": job["url"]})
        else:
            groups[key] = {**job, "also_listed_on": []}
    return list(groups.values())


def check_commute(job, config):
    result = {**job, "drive_minutes": None, "drive_miles": None, "route_note": "Workplace location needs checking"}
    postcode = re.search(r"\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b", job["location"], re.I)
    try:
        destination = None
        if postcode:
            data = json.loads(request("https://api.postcodes.io/postcodes/" + quote(postcode[0]), 4))
            if data.get("result"):
                destination = data["result"]["latitude"], data["result"]["longitude"]
                result["route_note"] = "Workplace postcode estimate; no traffic"
        if destination is None:
            town = next((t for t in TOWNS if t in job["location"].lower()), None)
            if town:
                destination = TOWNS[town]
                result["route_note"] = "Town centre estimate; no traffic"
        if destination:
            lat, lon = destination
            data = json.loads(request(f"https://router.project-osrm.org/route/v1/driving/{config["origin"][0]},{config["origin"][1]};{lon},{lat}?overview=false", 4))
            route = data["routes"][0]
            result.update(drive_minutes=int((route["duration"] + 59) // 60), drive_miles=round(route["distance"] / 1609.344))
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, KeyError, IndexError):
        result["route_note"] = "Route unavailable; check Google Maps"
    result["maps_url"] = "https://www.google.com/maps/dir/?" + urlencode({"api": 1, "origin": config["postcode"], "destination": job["location"], "travelmode": "driving"})
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Bypass the 15-minute source cache")
    parser.add_argument("--new", action="store_true", help="Only listings not previously printed")
    parser.add_argument("--all-locations", action="store_true", help="Include locations outside the North West and unknown workplaces")
    parser.add_argument("--commute", action="store_true", help="Estimate road journeys and filter against --max-drive (excludes traffic)")
    parser.add_argument("--max-drive", type=int, default=None)
    parser.add_argument("--max-pages", type=int, default=10)
    parser.add_argument("--sources", nargs="+", choices=list(SOURCES), default=list(SOURCES))
    parser.add_argument("--json", action="store_true", help="Print machine-readable results and source status")
    parser.add_argument("--no-interest", action="store_true", help="Exclude register-your-interest adverts")
    args = parser.parse_args(argv)
    try:
        config = load_config()
    except (ValueError, OSError) as error:
        parser.error(str(error))
    if args.max_drive is None:
        args.max_drive = config["max_drive"]
    if not 1 <= args.max_pages <= 100 or not 1 <= args.max_drive <= 180:
        parser.error("--max-pages must be 1–100 and --max-drive must be 1–180")
    results = {}
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(fetch_source, source, args.refresh, args.max_pages, config): source for source in args.sources}
        for future in as_completed(futures):
            results[futures[future]] = future.result()
    jobs = deduplicate([job for source in args.sources for job in results[source]["jobs"]
                        if (args.all_locations or nearby(job["location"]))
                        and (not job["closing_at"] or job["closing_at"] + 86400 > time.time())
                        and (not args.no_interest or not job["interest"])])
    if args.commute:
        if config["origin"] is None:
            try:
                resolved = json.loads(request("https://api.postcodes.io/postcodes/" + quote(config["postcode"])))['result']
                config['origin'] = (resolved['longitude'], resolved['latitude'])
            except (HTTPError, URLError, TimeoutError, OSError, ValueError, KeyError, TypeError):
                parser.error("Could not resolve your origin. Configure its coordinates in .env.local or retry.")
        with ThreadPoolExecutor(max_workers=4) as pool:
            jobs = list(pool.map(lambda job: check_commute(job, config), jobs))
        jobs = [j for j in jobs if j["drive_minutes"] is None or j["drive_minutes"] <= args.max_drive]
    seen = set(read_json(STATE / "seen.json", []))
    if args.new:
        jobs = [j for j in jobs if not ({j["id"]} | {x["id"] for x in j["also_listed_on"]}) & seen]
    jobs.sort(key=lambda j: j["closing_at"] or float("inf"))
    status = {key: {k: v for k, v in value.items() if k != "jobs"} for key, value in results.items()}
    if args.json:
        print(json.dumps({"origin": config["postcode"], "jobs": jobs, "sources": status}, indent=2, ensure_ascii=False))
    else:
        for source in args.sources:
            value = results[source]
            print(f"{source}: {value['error'] or ('cached' if value['cached'] else 'checked')}" + (" (partial/stale results)" if value.get("incomplete") else ""), file=sys.stderr)
        print(f"\n{len(jobs)} software degree apprenticeship(s) — from {config['postcode']}\n")
        for job in jobs:
            print(f"{job['title']}\n  {job['company']} · {job['location']}\n  {job['salary']} · {job['closing']}")
            if job["interest"]:
                print("  Register your interest — check whether applications are open")
            if args.commute:
                print(f"  Drive: {str(job['drive_minutes']) + ' min' if job['drive_minutes'] is not None else 'unconfirmed'} · {job['route_note']}\n  {job['maps_url']}")
            print(f"  {job['url']}")
            for other in job["also_listed_on"]:
                print(f"  Also on {other['source']}: {other['url']}")
            print()
    # Save only after output succeeds. Ctrl-C and broken pipes do not mark unseen jobs.
    sys.stdout.flush()
    for job in jobs:
        seen.add(job["id"])
        seen.update(x["id"] for x in job["also_listed_on"])
    write_json(STATE / "seen.json", sorted(seen))
    return 1 if all(r["error"] for r in results.values()) else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (KeyboardInterrupt, BrokenPipeError):
        raise SystemExit(130)
