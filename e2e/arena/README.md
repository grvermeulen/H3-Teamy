# Isolated GTA H3 verification

Use Node 22 and a disposable PostgreSQL database named `gta_h3_test` on `127.0.0.1:54329`, with a local `postgres` account. The committed test configuration never reads a remote database URL. Do not point a production database at this port.

```powershell
node node_modules/prisma/build/index.js migrate deploy --config e2e/arena/prisma.local.config.ts
node e2e/arena/seedLocal.cjs
node node_modules/vitest/vitest.mjs run --config vitest.arena.config.ts
node --import tsx e2e/arena/performanceAfter.ts
node e2e/arena/localServer.cjs dev
```

`localServer.cjs` blanks environment-file integrations before Next loads them, overrides every supported database alias with the disposable URL, and enables only the configured Ably key. It binds to loopback port 3100. The `build` and `start` arguments run the production build and server. Stop the development server before building. No environment files are modified. This harness is exclusively for local verification; never deploy its disposable authentication settings.

For a live-service test, sign in at `http://localhost:3100/` as `host@arena.example.test`, password `arena-local-test-2026`. Create a room, then in another terminal:

```powershell
node --import tsx e2e/arena/liveService.ts ROOMCODE
```

The second account is `peer@arena.example.test`, with the same disposable password. The peer connects to real Ably, confirms unauthorized state publishing and cross-member token access are denied, sends one malformed input, and follows the match. Start through the browser UI, wait for the second player, then close the browser host. After its lease expires, reopen the page and join the same room. The peer becomes host and submits the result at the server-issued deadline. It leaves automatically after completion or four minutes. These are real test messages on unique channels, so use a development Ably application when available.

```powershell
node --import tsx e2e/arena/verifyLive.ts
```

That last command checks the actual isolated database: one match, both accounts, 180-second duration and the host-reported label. Reports go to `docs/tech/arena/audits/2026-09-12/`. `liveService.ts` also writes progress under `.cache/`; create `.cache/gta-h3-live-stop` to request early shutdown, and remove that marker before the next run.

The simulation benchmark covers all shipped map tiles, four districts and eight players. Its five-minute stress scenario is simulated time with deterministic 10% loss and 33–167 ms delivery delay. It is not an eight-device browser or GPU benchmark. Browser layout and keyboard checks must be performed separately; physical touch, background throttling and thermal behavior still need representative devices.

The harness follows `MAP_BASE_PATH`, including map version changes. Pass an output path to preserve an earlier benchmark: `node --import tsx e2e/arena/performanceAfter.ts docs/tech/arena/audits/2026-09-12/performance-pr.json`.
