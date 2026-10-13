# Dangler

An internal software engineering / development degree apprenticeship finder built with Lakebed. It searches GOV.UK, Higherin and Not Going To Uni in parallel, filters Level 6 / degree software roles, merges duplicate adverts and tracks shortlists and application progress independently.

## Setup

Requires Node.js 22.18+ and Python 3.10+ for the optional terminal finder.

```bash
cp .env.example .env.local
# Edit .env.local with your postcode and optional deployment settings.
node scripts/configure.mjs
cd app
npx lakebed dev
```

Personal configuration lives only in the ignored `.env.local`. The setup script resolves missing coordinates through Postcodes.io and generates ignored runtime files:

- `app/.env.lakebed.server`: server-side location and search settings.
- `app/shared/local-domain-config.ts`: public routing origins for the optional sign-in adapter; no home location or credentials.
- `app/lakebed.json`: optional existing deployment binding.
- `domain/wrangler.local.jsonc`: optional Cloudflare deployment configuration.

Rerun the setup script after changing `.env.local`. Shell environment variables override file values. The script does not print personal values. Credentials for Lakebed and Cloudflare are managed by their CLIs; do not put access tokens in source files or the example environment file.

Before committing, stage the intended files and run `node scripts/audit-git.mjs`. It checks Git's staged contents for configured personal values, local runtime files and common credential patterns without printing sensitive values.

A new deployment does not need `LAKEBED_DEPLOY_ID`. For updates to an existing app, configure its ID locally before deploying. Supply both deployment origins and a Cloudflare account ID only if using the custom-domain proxy.

## Web app

The app offers keyword, location and source filters, deadline/salary/employer sorting, JSON export and driving-time estimates. The default discovery area covers the North West and remote roles; unknown workplaces remain available under All locations.

The bookmark button only controls shortlist membership. Application status is separate: Not applied, Applied, Online assessment, Assessment centre (AC), Interview, Offer received, Rejected or Withdrawn. The Applied tab includes every application stage and has a stage filter. Tracked roles retain snapshots after adverts close or disappear.

Search results are cached for 15 minutes. Refresh walks up to 10 pages per source. Failed refreshes retain previous results and display source errors. Local Lakebed state resets when the dev server restarts; hosted state persists. Guest sessions are private to the browser, and Google sign-in upgrades them to an account.

```bash
node scripts/configure.mjs
cd app
npx lakebed build
npx lakebed deploy
```

Hosted outbound fetching requires a claimed deployment. A new anonymous deployment may need `npx lakebed claim`, followed by another deploy. Lakebed is in public alpha and has a five-second action budget; each source page and route fallback uses a separate bounded action. There is no background scheduler.

## Terminal finder

`pda.py` uses the Python standard library and reads the same `.env.local`.

```bash
python pda.py
python pda.py --refresh --commute
python pda.py --new
python pda.py --all-locations
python pda.py --no-interest
python pda.py --json
python pda.py --sources gov higherin
```

`--max-drive 45` changes the commute limit; `--max-pages 20` changes the pagination cap. Independent sources and commute checks run in parallel. Requests have bounded retries and timeouts. Exit code 1 means all requested sources failed; otherwise it returns 0.

Cache and seen-history files stay in ignored `data/` beside the script. They are separate from web shortlists. Displayed listings become seen after output succeeds, including IDs from duplicate adverts. Writes use an atomic rename. Local backups and any original-script archive belong in ignored `.local/`.

## Matching and journeys

Titles must explicitly mention software engineering/development or a web/application/full-stack developer role. Broad technology, cyber security, data and AI programmes are excluded. Explicit Levels 2–5, Level 7 and master's labels are excluded. A board's generic degree label requires qualification confirmation.

GOV.UK searches every Level 6 sector within the configured radius, then filters titles. Expired roles disappear from Discover after their published closing day. Unknown deadlines stay visible. Cross-site duplicates merge conservatively using employer, town, normalised role, intake and closing date; all source links are retained.

Driving checks use Postcodes.io and public OSRM routers, preferring the workplace postcode and otherwise a recognised town centre. Estimates exclude traffic. Failed, unchecked and unknown journeys remain visible; checked routes above the limit are hidden. A Google Maps link lets you verify the actual journey. Register-your-interest adverts are labelled separately from open applications.

## Custom domain

See [domain/README.md](domain/README.md). The optional Worker proxy preserves the Lakebed origin, database and live WebSocket connection. Its routing and account settings are generated from local environment values rather than committed.

## Checks

```bash
python -m unittest discover -s tests -p 'test_*.py'
npx --yes tsx --test tests/jobs.test.ts tests/tracking.test.ts tests/config.test.ts
node --test tests/domain.test.mjs tests/env.test.mjs
node scripts/configure.mjs
cd app
npx lakebed build
```

Parser fixtures contain reduced public vacancy responses; they contain no searcher's postcode, private account records or credentials. The server and Python CLI have independent adapters because Lakebed cannot execute Python or import arbitrary npm packages. Update both adapters and fixtures when a provider changes its format.
