# CPLayout service setup and operation

This guide describes the implemented launcher and administrator commands. No production deployment was performed for this delivery. Verify the current source-bound checks in [the workflow registry](workflow-registry.json) before deploying an edition; browser, native device and physical receiver qualification remain separate.

## Prepare the service

Use the selected Node 24.21.0/npm 11.19.0 toolchain and PostgreSQL 18.6 in the stable 18.x series. Install the exact lock with `npm ci`; its postinstall guards must pass. Preserve a database backup before applying a migration to an existing installation. Package source checks do not qualify a database backup or rollback process.

The CI PostgreSQL image is separately pinned to an observed official 18.6 digest. [Primary-source verification](evidence/production-workflow-dependencies-20261011/ci-primary-sources.json) establishes tag/digest availability and exact action sources, not Docker execution or deployment. Recheck current official Node/PostgreSQL artifacts and run the affected qualification before platform pin changes; npm dependency automation does not automatically upgrade the database service.

Provide the service environment through a protected operational configuration, rather than committing values or copying them into documentation:

| Setting | Implemented contract |
| --- | --- |
| `CPLAYOUT_DATABASE_URL` | PostgreSQL connection string; required. |
| `CPLAYOUT_OFFLINE_SIGNING_KEY` | Private Ed25519 seed, exactly 32 bytes represented as 64 hexadecimal characters; required. Keep it out of app bundles, logs and command arguments. |
| `CPLAYOUT_PUBLIC_ORIGIN` | Exact public origin; required. HTTPS is required except for HTTP localhost/127.0.0.1. |
| `CPLAYOUT_API_HOST` | Listener host; defaults to `127.0.0.1`. |
| `CPLAYOUT_API_PORT` | Listener port; defaults to `19040`, with valid range 1024–65535. |
| `CPLAYOUT_APP_DIST` | Export directory; defaults to `apps/mobile/dist` relative to the workspace root. |
| `CPLAYOUT_ENABLE_RECEIVER_COMPANION` | Set to `1` only for the explicitly owned loopback HTTP origin. It is disabled by default and does not establish physical receiver qualification. |

Apply the retained, hash-checked migration from the workspace root:

```sh
npm run migrate -w @cplayout/api
```

Create the first administrator from an interactive local terminal:

```sh
npm run bootstrap -w @cplayout/api -- --username administrator-name --name 'Administrator name' --workspace 'Workspace name'
```

The command requests the password twice with terminal echo disabled. It refuses when any administrator already exists, including a disabled administrator. It creates the first empty workspace; it does not import customer or field data. There are no default credentials, public registration or HTTP bootstrap.

## Export and start the app

From the workspace root, export the current app and start the same-origin gateway:

```sh
npm run export:web
npm run start:service
```

The Fastify gateway serves the app export and `/api/v1` through the same listener and PostgreSQL-backed service. It requires a present app export and checks PostgreSQL's reported version before listening. It does not migrate or bootstrap the database at startup. It injects only the derived public offline verification key and same-origin API configuration before the app loads. Asset resolution rejects hidden paths, traversal and files resolving outside the export.

A deployed HTTPS reverse proxy must present the configured public origin consistently for the app and API. `npm run start -w @cplayout/api` starts the API alone; an API-only listener does not serve the exported app. Configure native clients explicitly with `EXPO_PUBLIC_CPLAYOUT_API_URL` and the trusted `EXPO_PUBLIC_CPLAYOUT_OFFLINE_PUBLIC_KEY`; native transport/storage/device proof is still required. The private signing seed never belongs in either public setting.

## Validate operation and preserve evidence

Confirm the exported app opens from its actual public origin, unauthenticated access is refused, the assigned account signs in, its permitted customer/projects appear, and an authorized write survives a service restart. Record the exact source and export identities, PostgreSQL version, tested operator journey and result. These operational checks remain pending until actually performed; injectable tests and disposable-database checks are not a deployment receipt.

The optional local receiver companion additionally requires an authenticated Operator/Administrator with actual field-write workspace permission. Starting the gateway does not open a receiver connection. Shared HTTPS deployment leaves this loopback companion disabled; its device/transport path needs a separately qualified integration.

SIGINT/SIGTERM close the gateway and owned database pool. Retain database, signing-key and app-edition recovery records under the deployment owner's protected retention policy. Signing-key rotation requires a trusted public-key configuration update; a refused old key must not justify deleting cached projects or pending commands. Horizontal service operation also requires a shared rate-limiting boundary before activation, as documented in the [service README](../apps/api/README.md).

Implementation anchors: [gateway](../tools/serveProductionApp.ts), [protected service configuration](../apps/api/src/config.ts), [migration command](../apps/api/src/migrate.ts), [interactive bootstrap](../apps/api/src/bootstrap.ts), [gateway tests](../tools/serveProductionApp.test.ts) and [root scripts](../package.json). These were reviewed directly on 2026-10-11; the source tree remains a candidate until its acceptance gates pass.
