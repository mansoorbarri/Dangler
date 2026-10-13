# Dangler Lakebed capsule

See [the project README](../README.md) for setup and privacy configuration. Run `node scripts/configure.mjs` from the project root before starting or building this capsule.

```bash
npx lakebed dev
npx lakebed build
npx lakebed deploy
```

- `server/index.ts`: private searches/bookmarks and source/route actions.
- `server/settings.ts`: validated server-only environment settings.
- `server/sources.ts`: source adapters.
- `client/index.tsx`: internal dashboard.
- `shared/jobs.ts`: matching, grouping and public town locations.
- `shared/tracking.ts`: independent shortlist/application state.
- `shared/domain-auth.ts`: optional custom-domain callback helper.

Personal server environment, generated client routing origins and deployment bindings are ignored by Git.
