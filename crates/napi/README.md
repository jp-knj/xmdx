# Markflow N-API (crates/napi)

## Build / Test
- Install deps first (required):
  - `pnpm install --frozen-lockfile`
- Build NAPI binary:
  - `pnpm run build:napi`
- Smoke test against fixture:
  - `pnpm run smoke:napi -- ../../fixtures/core/markdown/hello.md`

## Notes
- `napi` CLI must be available via `node_modules/.bin` (comes from devDependencies). If you see `napi: not found`, run the install step above.
- CI follows the order: install → build → smoke test (see `.github/workflows/ci.yml`).
