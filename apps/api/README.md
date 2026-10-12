# CPLayout service

This service authenticates username/password accounts, keeps opaque server sessions,
enforces workspace membership and roles, and persists domain commands with PostgreSQL
transactions. Domain documents remain exact TEXT. The mobile/web workspace retains
its existing map, editor and capture contracts through an authenticated local cache.

## Configuration and operation

Use PostgreSQL 18.6 in the 18.x stable series. Configure `CPLAYOUT_DATABASE_URL`,
`CPLAYOUT_OFFLINE_SIGNING_KEY` (a protected 32-byte Ed25519 seed represented as hex),
and `CPLAYOUT_PUBLIC_ORIGIN`. A deployed origin requires HTTPS; ordinary HTTP is
limited to localhost/127.0.0.1. `CPLAYOUT_API_HOST` defaults to loopback and
`CPLAYOUT_API_PORT` to 19040. The reverse proxy must serve the app and `/api/v1`
from the same public origin. Native clients use their explicitly configured HTTPS
service URL.

Apply the retained migration with `npm run migrate -w @cplayout/api`. Create the
first administrator from an interactive local terminal:

```sh
npm run bootstrap -w @cplayout/api -- --username administrator-name --name 'Administrator name' --workspace 'Workspace name'
```

The password is entered twice with terminal echo disabled. There are no default
credentials, public registration or HTTP bootstrap. The command refuses once any
administrator exists, including a disabled administrator. It creates an empty v5
workspace using the lossless prior-version upgrade chain. Start the configured
service with `npm run start -w @cplayout/api`. Startup does not silently migrate or
bootstrap a database.

For a single app/service origin, first export the app and then run
`npx tsx tools/serveProductionApp.ts` from the workspace root. This gateway uses
the configured PostgreSQL service, preserves all authentication middleware, and
serves `apps/mobile/dist` (or explicit `CPLAYOUT_APP_DIST`). It injects only the
public endpoint and derived offline verification key before loading the app.
Asset resolution refuses traversal, hidden files and outside-root symlinks.
No test database, fixture account, migration or bootstrap is selected by this
launcher. Starting an actual deployment remains an explicit operational action.

`CPLAYOUT_ENABLE_RECEIVER_COMPANION=1` enables the existing companion only for
the exact owned localhost HTTP origin. It additionally requires an authenticated
account with field-write access before admitting receiver requests. It opens no
receiver connection at construction and closes owned resources with its server.
HTTPS/shared deployments keep this local companion disabled; their device and
transport integration require separate qualification.

Install the derived public verification key in app configuration as
`EXPO_PUBLIC_CPLAYOUT_OFFLINE_PUBLIC_KEY`; the private signing seed must never
enter the app bundle. A deployment may explicitly set
`EXPO_PUBLIC_CPLAYOUT_API_URL` for native service access. Web uses the same-origin
API by default. Key rotation requires an explicit trusted configuration update;
cached documents and pending commands remain retained if an old key is refused.

## Authentication and authorization

Passwords are Argon2id hashes. Web sessions use HttpOnly, SameSite=Strict cookies
and per-session CSRF tokens; native opaque tokens live in the host SecureStore.
Sessions expire after 24 hours and are checked against the user's disabled state
and access revision on every authenticated transaction. Administrator access
changes revoke server sessions. Mutating browser requests also reject foreign
origins. Sign-in limits apply by username and IP within one service instance;
horizontal deployments require a shared rate-limiting boundary before activation.
Service logging does not emit request bodies, tokens, passwords or database URLs.

Operator accounts perform permitted field and ordinary catalog work. Administrator
accounts additionally manage accounts, workspace memberships and archive/restore.
Support membership alone never grants business data or write access; an explicit
Operator/Administrator role and actual workspace permission are still required.

## Data and offline contracts

- `GET /api/v1/session` supplies current principal and workspace access.
- `POST /api/v1/session/login` and `/logout` create/revoke sessions.
- `GET /api/v1/workspaces/:id` returns exact TEXT, revision and SHA-256.
- `POST /api/v1/workspaces/:id/commands` accepts an idempotent command ID,
  expected revision and validated domain command. It locks one workspace row,
  checks permission/archive state, uses the same pure reducer as the app, and
  commits source, receipt and audit in one transaction.
- `POST /api/v1/workspaces/:id/import` requires administrator access, reviewed
  source hash and an empty revision-matched destination. It preserves the exact
  source without implicit upgrade/merge. A source containing any
  `layout-session-v3` record in its Layout collection is refused: the raw envelope
  cannot establish its original
  workspace association. Retain the recovery source and import those Layout
  sessions individually as reference history; their exact original TEXT is kept,
  finalization is removed, and new station marks are refused.
- `GET /api/v1/workspaces/:id/catalog-metadata` returns the actual customers,
  including customers without projects, and their actual project parents in one
  locked document/archive snapshot. It includes the authenticated `principalId`,
  membership `policyRevision`, workspace ID and revision. The SDK rejects a
  response belonging to another account or policy before Home can publish it.
  Customer folders are database relationships, not physical directories. Home
  selects a customer before listing that customer's projects or starting one.
- Customer/project reads are scoped by workspace membership. Project queries
  support customer filtering. Archived projects are excluded by default.
  Workspace requests from the SDK carry an expected principal header checked
  against the real server session. Responses from a retired account action are
  refused before publication. Retention after workspace, archive and offline-grant
  reads rechecks the captured access owner under the final storage lock. Legacy
  callers without this additive header keep
  the existing response shape and actual server authorization requirements.
- Customer/project archive and restore preserve domain documents and linked
  Survey/Layout evidence. Customer restoration does not restore independently
  archived projects. Archive metadata advances the workspace CAS revision.
  The device retains the actual archive acknowledgment before its follow-up
  status read and retires older archive authority. A failed status read keeps
  exact field documents and the receipt while blocking stale field changes.

`review_survey.completedBy`, `append_layout_mark.recordedBy`, and the nested
creation/finalization lock `recordedBy` fields are bound to the authenticated
principal by the service and the local admission adapter. A new V3 Layout requires
a completed matching Survey and a current owned RTK Fixed capture. Finalization
requires a fresh owned lock and an admitted station within the operator's entered
tolerance for every frozen target point. Older V1/V2 sessions remain history;
copy/import never inherits official V3 status. Receiver captures first commit into the
actual guarded local store together with their outbox entry. Server synchronization
is an import of retained evidence, not a claim that a historical receiver position
remained fresh during HTTP transport. Server-side validation does not establish
physical equipment identity, measured precision or OEM installation suitability.

A signed 24-hour offline grant binds account identity/roles, workspace, permitted
projects, field permissions, policy revision and expiry. First sign-in and privileged
administration require online access. Offline grants are checked against a trusted
public key; unsigned account hints only select cache partitions. Clock rollback,
expiry, unknown project scope and unsupported actions refuse new mutations while
retaining evidence. Revocation is checked again on synchronization; immediate
offline revocation is not claimed. Rejected/conflicting entries and subsequent
payloads remain retained. Native live capture is disabled until its host supplies
a qualified transactional final-admission store; the file cache is not mislabeled
as native SQLite proof.

## Validation

`npm test -w @cplayout/api` runs isolated injectable service tests. The real
PostgreSQL test additionally requires `CPLAYOUT_TEST_DATABASE_URL` pointing to an
owned disposable database. It creates a unique `cplayout_test_…` schema and drops
only that schema after migration/bootstrap/CAS/rollback/TEXT checks. Missing
database configuration is reported as a skipped database test, never PostgreSQL
qualification. `src/testHarness.ts` is imported only by synthetic test runners;
production startup cannot select a memory database or seeded credentials through
configuration.

Implementation sources: [Fastify server reference](https://fastify.dev/docs/latest/Reference/Server/),
[node-postgres transactions](https://node-postgres.com/features/transactions),
[parameterized queries](https://node-postgres.com/features/queries), and
[node-argon2](https://github.com/ranisalt/node-argon2). Package versions were checked
against the npm registry on 2026-10-11; source or fixture tests alone do not prove
deployment, device behavior or production operator acceptance.
