# PoseTek web application

See the [repository README](../README.md) for fresh-clone setup, homepage preview,
validation, production assembly, and collaboration instructions. Read the
[project context](../POSETEK_PROJECT_CONTEXT.md) before changing the website.

This directory contains the React/TypeScript/Vite application and the isolated
homepage, including Svelte/Threlte hero components.

From this directory:

```powershell
npm ci --no-audit --no-fund
npm run dev
```

The development server runs application source. For the public homepage, use
the separate marketing build and preview commands in the repository README.
`npm run build` creates the ordinary application output; the preservation-based
homepage release is assembled by `node scripts/build-production.mjs` from the
repository root.

- [Player architecture and mobile parity](../docs/PLAYER_EXPERIENCE.md)
- [Porting and routing conventions](PORTING.md)
- [Latest homepage release receipt](../deployment/ANNOTATION_UPDATE_PRODUCTION.json)
