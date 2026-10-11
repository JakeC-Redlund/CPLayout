# Optional host review adapter

`tools/reviewHostAdapter.cjs` is host-only. The local review engine remains usable
without it. Generated schemas are pinned to locally inspected Codex **0.157.1**;
schema hashes and version are checked before a stdio launch. Regenerate with
`codex app-server generate-json-schema --out <new-directory>`, review the relevant
contracts, and update tests before supporting another version.

The host supplies synchronous durable, product-owned journal persistence and binds each
request to a session ID, evidence identity digest, thread, turn and request ID.
After independently verifying the local review session and its current evidence,
the host passes acknowledged answers to `submit`. Browser pages never receive
the transport, shell execution, process handles or control credentials. A browser
submission or imported answer still has unverified authorship; panel decisions
and agent observations are rejected as operator submissions.

Persistence happens before transport send. Submitted/uncertain entries are never
automatically resent after reconnect; server resolution or host reconciliation is
required. Pending entries need an identical replay before answering. Cancellation
is recorded locally and requires host-owned turn interruption/resolution: the
Codex user-input response schema has no elicitation-style cancel action. No empty
answers are manufactured to stand in for decline, cancellation or panel decisions.

`launchStdio` creates an owned process and initializes it without starting a model
turn. Callers must keep it in their resource lease and stop/verify that process
when finished. It is optional and is not wired into the browser server. Schema and
synthetic transport tests are not live request/response proof in a Codex turn.

On 2026-09-27 the installed 0.157.1 process completed the stdio initialize
handshake and its owned process exit was observed. No model turn was started.
Live questionnaire submission/reconnect inside a turn remains unverified.

MCP adapters currently provide capability negotiation and distinct accept,
decline/cancel result mapping. A full elicitation transport or MCP Apps rendering
host is an explicit readiness gap; no universal host support is claimed.

Sources checked 2026-09-27: [Codex app-server](https://learn.chatgpt.com/docs/app-server),
[MCP elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation),
[MCP Apps](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html).
