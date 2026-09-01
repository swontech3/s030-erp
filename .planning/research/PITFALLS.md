# Pitfalls Research

**Domain:** Multi-tenant coworking-space ERP — Next.js (App Router) + Fastify + Supabase Postgres, external JWT auth (삐용/bbiyong, Spring Boot)
**Researched:** 2026-09-01
**Confidence:** MEDIUM-HIGH (JWT/OWASP/Postgres patterns are HIGH confidence, well-established; Supabase pooler specifics verified via web search MEDIUM-HIGH; Next.js caching-default specifics verified for current major version MEDIUM; project-specific extrapolations from `doc/SWONBIZ_PROJECT_STRUCTURE.md` and `doc/SWONBIZ_MODAL_COMPOSITION_P1.md` are HIGH confidence because they cite exact hardcoded values and structure already in the repo)

Ranked by cost-to-fix-later. Auth and schema decisions are hardest to reverse once screens are built on top of them — they come first.

---

## Critical Pitfalls

### Pitfall 1: JWT verified structurally but not semantically (alg confusion, `alg:none`, missing `iss`/`aud`/`exp`, decode-without-verify)

**What goes wrong:**
Code that calls `jwt.decode()` (no signature check) to read `memberId`/role out of the token "just for routing," or a verify call that accepts whatever algorithm the token header claims (`alg: none`, or HS256 when an RS256 key was expected), or that checks the signature but never checks `iss`, `aud`, or `exp`. Any of these lets a forged or stale token pass.

**Why it happens:**
bbiyong is Spring Boot/Java; ERP is Node. Two different JWT stacks almost never agree by default on which claims are mandatory. It's also tempting to grab claims in `middleware.ts` with a one-line decode because "we just need the org id for routing" — and that code has a habit of never getting the verify step added later.

**How to avoid:**
- Verify with `jose` (Edge-compatible) or `jsonwebtoken`/`fast-jwt` (Node runtime only), always specifying the **exact expected algorithm** (`algorithms: ['HS256']` or `['RS256']`, never both, never derived from the token header).
- Explicitly check `iss` (bbiyong's issuer string), `aud` (should identify ERP as the intended audience — confirm bbiyong actually sets a distinct `aud`; if it doesn't, this is a cross-service token confusion risk worth raising with the bbiyong team now), and `exp`.
- Never call a bare `decode()` anywhere in the codebase without a verify step in the same function. Wrap verification in a single `lib/auth/verifyToken.ts` and forbid any other file from importing `jose`/`jsonwebtoken` directly (enforce via lint rule or code review checklist).
- Confirm with the bbiyong team whether the signing algorithm is HS256 (shared secret, most likely given `.env`-only JWT secret constraint) or RS256/JWKS. If HS256, the same literal secret string must exist in both codebases — treat it as a shared credential with rotation coordination, not an ERP-owned config value.

**Warning signs:**
- Any `jwt.decode(` in the codebase not immediately followed by a `jwt.verify(`.
- A verify call without an explicit `algorithms:` allowlist.
- No test/fixture for "expired token," "wrong issuer," "wrong audience," "tampered signature."

**Phase to address:** Auth & Schema Spec phase (pre-roadmap / Phase 0), before any `(erp)` route is built. This is the single most expensive-to-retrofit item — every downstream screen assumes the session is trustworthy.

---

### Pitfall 2: Claim-shape and clock drift between the Java issuer and the Node verifier

**What goes wrong:**
`exp`/`iat`/`nbf` in JWT are Unix epoch **seconds**. A common Node bug is treating them as milliseconds (`new Date(exp)` instead of `new Date(exp * 1000)`), which makes every token look either already-expired or expiring in the year 2255. Separately, if bbiyong ever renames a claim (`memberId` → `userId`, or adds/removes `orgId` shape on the two-step-login token vs. the final token), ERP silently breaks or — worse — silently treats a different field as the tenant/org identifier. Clock skew between the Java host and the Node host (even a few seconds) can cause `exp`/`nbf` checks to intermittently reject valid tokens right at boundary times.

**Why it happens:**
No shared contract/schema for the JWT payload exists between two independently-deployed codebases in two languages. Nobody owns "the JWT shape" as a versioned artifact.

**How to avoid:**
- Write down the exact claim shape (names, types, units) for both the **temporary org-selection token** and the **final session token** as a literal TypeScript type + a Zod/valibot schema that the verifier validates against, not just the signature. Fail closed (401) if an expected claim is missing or has the wrong type — don't fall back to `undefined` and continue.
- Add a small `clockTolerance` (e.g., 5–10s) to the JWT library's exp/nbf check to absorb minor clock skew, and separately confirm both hosts run NTP-synced clocks.
- Ask the bbiyong owners for a changelog/versioning promise on the claim shape, or add a `ver`/schema-version claim if they'll add one.

**Warning signs:**
- Users randomly logged out near token expiry boundaries (clock skew).
- A field read as `payload.orgId` when the two-step-login intermediate token might use a different field name than the final session token.

**Phase to address:** Auth & Schema Spec phase, alongside Pitfall 1. Document the claim contract before writing `lib/auth/`.

---

### Pitfall 3: Trusting middleware-only route protection ("we'll just decode the token in Next.js middleware")

**What goes wrong:**
`middleware.ts` checks the JWT and redirects unauthenticated UI requests to `/login` — but the actual data endpoints (Next.js Route Handlers, or the Fastify API they proxy to) don't independently re-verify the token. Anyone who calls `/api/contracts/:id` or the Fastify service directly (curl, another origin, a misconfigured internal network route) gets data with zero auth check, because "the middleware already handled it."

**Why it happens:**
Middleware feels like a central choke point, so it's tempting to treat it as the only enforcement layer. But Next.js middleware runs only in front of the Next.js app; it does not — and cannot — protect the Fastify service if that service is reachable on its own network path (local dev, container-to-container calls, a future mobile client, a debugging tool hitting the API port directly).

**How to avoid:**
- Treat middleware as a **UX optimization** (fast redirect to `/login`, avoid rendering a flash of protected UI) — never as the security boundary.
- Every Fastify route and every Next.js Route Handler independently verifies the JWT (same `lib/auth/verifyToken.ts` logic, or a shared package) and independently checks role/tenant scope. No "internal network is trusted" assumption.
- Middleware also runs on the **Edge runtime**, which has no Node.js `crypto`/`jsonwebtoken` support — use `jose` there specifically, and don't assume the same verification code path automatically works in both middleware and a Node-runtime Route Handler without checking runtime compatibility.

**Warning signs:**
- Fastify routes with no auth check because "middleware already gates it."
- Any route handler reachable without going through `(erp)` layout/middleware (e.g., an API route under `app/api/` that isn't covered by the middleware `matcher` config).

**Phase to address:** Auth & Schema Spec phase for the pattern/contract; enforced screen-by-screen starting at Phase 3 (auth integration) and re-verified at every subsequent phase that adds an API route (Phases 6–9 and booking).

---

### Pitfall 4: Multi-tenant leaks via forgotten WHERE clauses, IDOR, and over-fetch-then-filter

**What goes wrong:** This is the highest-likelihood, highest-blast-radius bug class for this project, and it fails in many small ways rather than one big way:
- A list/detail query forgets `WHERE org_id = :tenantOrgId` on one endpoint (contracts, bookings, tenant search/autocomplete) while getting it right everywhere else.
- `/api/contracts/:id` fetches by primary key only, no ownership check → any authenticated 입주사 user can read any contract by guessing/incrementing an ID (IDOR).
- A list endpoint returns full booking objects (org name, headcount, title) for **all** rooms including other tenants' bookings, and the client-side React component decides whether to render "예약됨" or the real title. The masking is cosmetic — the real data already crossed the wire and is visible in devtools/network tab.
- Search/autocomplete endpoints (tenant name search, room search) are built later, in a hurry, and skip the tenant filter that the "real" list endpoint has.
- Error messages differ for "doesn't exist" vs. "exists but not yours" (e.g., 404 vs 403 with a message naming the other org), letting a client enumerate other tenants' contract/booking IDs by observing which error comes back.
- List endpoints leak aggregate info even when individual records are hidden (e.g., "37 bookings this month" total count includes other tenants' bookings, revealing occupancy).

**Why it happens:** Fastify + plain Postgres (no ORM-level tenant scoping, no RLS enforced by default) means tenant isolation is 100% a discipline problem — there is no framework guardrail unless one is deliberately built. Masking logic naturally gets written in the React layer because that's where the "예약됨" display requirement is described (a UI spec), and it's easy to forget it's actually an authorization requirement.

**How to avoid:**
- **Server-side masking, not client-side.** The API for booking lists must return already-masked objects for other tenants' bookings (e.g., `{ id, start, end, status: 'booked' }` with no `title`/`orgName`/`headcount` keys present at all — not empty strings, not null placeholders that still leak the field existence pattern). The 운영사 (full-visibility) endpoint and the 입주사 (masked) endpoint should go through the same query with a role-based projection applied server-side before serialization, never after.
- Build one shared query helper/repository function per entity (`getContractsForTenant(orgId, ...)`, `getBookingsForViewer(viewerOrgId, role, ...)`) that every route — including search/autocomplete — is required to call. Do not let any new endpoint write its own raw query against `s030_contract`/`s030_booking` without going through it.
- Use consistent 404-for-both semantics: "not found" and "not yours" return the same 404 with the same message. Never 403-with-detail.
- For counts/aggregates, compute them from the same tenant-scoped query, not a separate unscoped `COUNT(*)`.
- If Postgres RLS is adopted (see Pitfall 5) treat it as **defense in depth**, not a replacement for the WHERE-clause discipline above, since this stack's primary access path (Fastify with the service role or a superuser-ish app user) may not go through RLS-enforcing roles at all.

**Warning signs:**
- Any repository/query function that takes no `orgId`/`viewerRole` parameter.
- A code review where a new list/search endpoint doesn't visibly reuse the shared tenant-scoped helper.
- Masking logic that lives in a `.tsx` file instead of a route handler or service function.
- Network tab (devtools) on a 입주사 login showing full data for "예약됨" rows.

**Phase to address:** Design the tenant-scoping helper and masking contract in the Auth & Schema Spec phase (define the pattern once). Enforce at every phase that adds a list/detail/search endpoint — tenants (Phase 6), contracts (Phase 7–8), booking (booking phase). This is the pitfall most worth a dedicated review checklist per phase, since it recurs per-endpoint rather than being fixable once.

---

### Pitfall 5: RLS misconfiguration under a transaction-mode pooler, and service_role as false confidence

**What goes wrong:** If the team adopts Postgres Row-Level Security keyed on a custom claim (e.g., `current_setting('app.org_id')` set via `SET LOCAL` per request) to get defense-in-depth tenant isolation, and the app connects through Supabase's pooled connection (transaction-mode pooler, port 6543 / PgBouncer), two things break silently:
- **Transaction-mode pooling does not support session-persisting `SET`** — only `SET LOCAL` scoped to a single transaction survives correctly, and if the app issues `SET app.org_id = ...` as a plain session `SET` (common mistake, works fine against a direct connection in dev, breaks in pooled prod), a *different* tenant's request can reuse the same underlying connection and inherit the wrong `org_id`.
- Prepared statements are not supported in transaction mode; ORMs/drivers that cache prepared statements by default (node-postgres with certain settings, Prisma without `pgbouncer=true`) will throw or, worse, intermittently reuse a stale plan.
- Separately, if the Fastify backend connects using the Supabase `service_role` key (or an equivalent superuser DB role) for convenience, **RLS is bypassed entirely** for every query that connection makes — meaning RLS policies can look correct in review and in isolated testing (using the anon/authenticated role) while the actual production traffic path never touches them, since Fastify is a trusted server, not a browser-side Supabase client. This produces false confidence: "we have RLS" while the real enforcement is 100% the WHERE-clause discipline from Pitfall 4.

**Why it happens:** Supabase's own quick-start docs push the service_role key for server-side code, which is correct for *some* server operations but gets copy-pasted into the main data-access layer for convenience. RLS + PgBouncer transaction-mode interactions are undocumented gotchas that only show up under concurrent load, not in local single-connection dev.

**How to avoid:**
- Decide explicitly, in the Auth & Schema Spec phase: does Fastify connect as a tenant-scoped Postgres role enforcing RLS per-request, or does it connect as a trusted backend that does all scoping in application code? Given this stack (Fastify owns all data access, no browser-side Supabase client, auth is external JWT not Supabase Auth), the **simpler and more honest model is application-level scoping as the primary control** (Pitfall 4's helper functions), with RLS — if used at all — as an explicit, tested second layer using `SET LOCAL` inside the same transaction as the query, on a **direct (session-mode / port 5432) or Supavisor session-mode connection**, not the transaction-mode pooler, for any code path relying on `SET LOCAL` claims.
- If using Prisma or another pooled client against the transaction-mode pooler for general CRUD, disable prepared statement caching per the driver's documented flag (e.g., Prisma's `?pgbouncer=true`) to avoid the "prepared statement already exists" class of production-only errors.
- Never let the primary application data-access path use `service_role`/superuser credentials as a substitute for tenant filtering — reserve elevated credentials for specific, reviewed admin operations only.

**Warning signs:**
- `SET app.org_id = ...` (no `LOCAL`) anywhere in query code.
- Fastify's Postgres client configured with the pooled connection string (port 6543) while also relying on `SET LOCAL`/session variables for tenant context.
- RLS policies exist in migrations but the app's DB user is `service_role` or a role with `BYPASSRLS`.
- Intermittent "prepared statement does not exist" or "prepared statement already exists" errors under load that don't reproduce locally.

**Phase to address:** Auth & Schema Spec phase — this is a connection-architecture decision, not a per-screen one. Must be settled before the first migration is written.

---

### Pitfall 6: Refresh-token races, refresh loops, and mid-form token expiry

**What goes wrong:**
- **Refresh storm:** several components/tabs independently notice an expiring token and each fire a refresh call at once; bbiyong's `token010` session table may not tolerate concurrent refresh of the same session (single-use refresh tokens are common), so the second refresh fails, and that failure is (incorrectly) treated as "session invalid" → forced logout even though the first refresh actually succeeded.
- **Refresh loop:** if the refresh endpoint itself returns 401 for a genuinely-expired session, and the client's fetch-wrapper's "on 401, refresh and retry" logic doesn't distinguish "access token expired, refresh available" from "refresh token also expired," it can loop indefinitely or bounce the user between `/login` and back.
- **Mid-form data loss:** a user fills out most of the 4-section, up-to-20-user contract form, the access token silently expires mid-session, and the very next save/autosave call gets a 401 — if the UI's response to 401 is an immediate redirect to `/login`, the in-progress form state is lost with no recovery path.
- **Edge runtime limits:** if refresh logic is attempted inside `middleware.ts` (Edge runtime), it cannot use Node-only crypto/HTTP client assumptions some libraries make, and cannot easily set an httpOnly cookie *and* continue the original request in one pass without extra plumbing — this pushes teams toward hacky workarounds (double round-trips, or refreshing in the response headers of a redirect).
- **TTL disagreement between the two systems:** if ERP's own idea of "session valid" (e.g., a cached expiry in a cookie) drifts from bbiyong's actual `token010` TTL/refresh policy, ERP can either log users out early (bbiyong session still valid) or keep serving pages with a token bbiyong has already revoked.

**Why it happens:** Refresh is inherently a cross-cutting, stateful concern, and it's being coordinated across two independently-deployed systems with no shared session store.

**How to avoid:**
- Implement refresh as a **single-flight** operation: one in-flight refresh promise shared across all concurrent callers in the same client (dedupe by session id), so simultaneous requests don't each trigger a separate refresh call.
- Do refresh in a Node-runtime Route Handler (not `middleware.ts`), so full Node APIs and normal cookie-setting semantics are available; middleware's job is only to check token presence/freshness and redirect to that Route Handler or the login page, not to perform the refresh network call itself.
- On 401, distinguish "access expired, refresh token still valid" (silently refresh + retry once) from "refresh also failed" (only then redirect to login) — get bbiyong's actual error contract for this distinction confirmed early, don't guess.
- For the contract form specifically: autosave drafts locally (e.g., debounced write to browser storage or a draft endpoint) *before* attempting any auth-sensitive action, so a 401 during save can recover into "please re-authenticate, your draft is preserved" rather than silent data loss. At minimum, never navigate away from an unsaved form purely because a background auth check failed — surface a re-auth prompt in place.
- Get bbiyong's session/refresh TTL values explicitly (this is called out as unresolved in `doc/SWONBIZ_PROJECT_STRUCTURE.md` section 8: "세션 만료 기본값이 삐용 JWT TTL과 일치하는지") and encode them as a single constant sourced from bbiyong's actual config, not re-guessed in ERP.

**Warning signs:**
- More than one refresh network call visible in devtools within the same second from the same browser tab.
- Users report being logged out while actively typing in the contract form.
- No distinction in the fetch-wrapper code between "retry after refresh" and "redirect to login."

**Phase to address:** Auth & Schema Spec phase for the TTL/contract questions and the single-flight/refresh architecture; implemented in Phase 3 (auth integration); the mid-form-loss mitigation specifically must land before or during Phase 8 (contract form), since that's the form long enough for a token to expire mid-session.

---

### Pitfall 7: Contract state machine enforced only in the UI

**What goes wrong:** The "상태 전이 확인" modal (`s0300200040p2`) correctly hides buttons for impossible transitions per the spec ("불가능한 전이는 버튼을 렌더링하지 않는다"), which is good UX — but if the actual transition (`draft → confirmed`, `confirmed → terminated`, etc.) and the section-2 lock-after-confirmed rule are enforced *only* by which buttons are rendered and which form fields are disabled in React, then a direct API call (`PATCH /api/contracts/:id`) from a script, a replayed request, or a bug elsewhere in the app can: confirm a contract twice, terminate a `draft` contract (skipping `confirmed`), or edit section-2 fields on an already-`confirmed` contract.

**Why it happens:** The state machine is *specified* as a UI/UX concept (which buttons appear, which sections are editable) in `doc/SWONBIZ_MODAL_COMPOSITION_P1.md`, so it's natural for the first implementation pass to only implement it where it's specified — in the components.

**How to avoid:**
- Implement the transition table (`draft→confirmed`, `draft→cancelled`, `confirmed→terminated`, and no others) as a server-side guard — a small pure function `canTransition(from, to): boolean` used by the API route/service layer, rejecting any other request with 409 Conflict, independent of and in addition to the UI hiding buttons.
- Enforce the section-2-locked-after-`confirmed` rule at the same layer: the update endpoint must check current status server-side and reject (or silently ignore) writes to section-2 fields once `confirmed`/`terminated`/`cancelled`, not merely disable the inputs client-side.
- Treat `cancelled` and `terminated` as true terminal states enforced by the same guard — no transition out of them, checked server-side.

**Warning signs:**
- A PATCH/update endpoint for contracts that doesn't read the current `status` before applying changes.
- No 409/422 test case for "attempt to edit section 2 after confirm via direct request."

**Phase to address:** Phase 8 (contract form) — but the transition-table function itself should be designed once at the Auth & Schema Spec phase alongside the `s030_contract` schema, since it needs to be shared between the API layer and possibly a DB constraint/trigger.

---

### Pitfall 8: No audit trail for state changes, and derived totals stored without a recomputation strategy

**What goes wrong:**
- Confirming or terminating a contract changes a `status` column in place with no record of *who* did it, *when*, or *why* — but the confirm/terminate modals already collect a reason and (for termination) an end date per the spec. If that data isn't persisted to a history table, it's lost the moment the modal closes, and there's no way to answer "who confirmed this contract" later (a near-certain audit/compliance question for a Korean B2B lease-like contract).
- If the contract's total amount is computed client-side from up to 10 line items and then **stored** as a column (rather than derived on read, or recomputed transactionally on every item write), any later edit to a line item (sections 1/3 remain editable after confirm) that doesn't also re-run the total calculation leaves the stored total silently wrong — and that stale total is exactly what appears on the printed 계약서.

**Why it happens:** State-transition metadata (actor, reason, timestamp) is an easy thing to leave off a first schema pass because it's not "the contract data" — it's an operational side-effect. Derived totals get stored directly because it's simpler than recomputing on every read, especially once contract-document printing wants a stable number.

**How to avoid:**
- Add a `s030_contract_status_history` (or similarly named) table: `contract_id`, `from_status`, `to_status`, `reason`, `actor_member_id` (from the verified JWT, never from client-supplied body), `actor_org_id`, `changed_at` (server clock, never client-supplied). Write to it in the same transaction as the status update.
- Recompute the contract total server-side, inside the same transaction as any item insert/update/delete (a DB trigger recalculating a `total_amount` column, or a computed/generated column, or a view) rather than accepting a client-computed total. Never let the browser be the source of truth for money totals that get printed on a legal document.
- Decide soft-delete vs. hard-delete explicitly per table now, at the Auth & Schema Spec phase — contracts and contract items almost certainly want soft-delete (`deleted_at`) given the audit/reprint requirement, but this must be a deliberate schema decision (with all read queries filtering `deleted_at IS NULL` consistently — another place Pitfall 4's "shared query helper" discipline applies) rather than discovered mid-build when someone needs to "undo" a cancel.

**Warning signs:**
- `status` column updates with no corresponding insert into a history/audit table.
- A `total_amount` column with no trigger/generated-column definition, populated only from application code.
- Any `DELETE FROM s030_contract...` in application code (vs. an `UPDATE ... SET deleted_at`).

**Phase to address:** Auth & Schema Spec phase (schema shape), enforced in Phase 8 (contract form) and any earlier phase touching contract items.

---

### Pitfall 9: Billing schema designed now, against undetermined requirements, without an evolution strategy

**What goes wrong:** `s030_billing`/`s030_billing_item` are being schema-designed in Phase 1 while payment-method policy and PG integration are explicitly undetermined (per PROJECT.md Out of Scope). If the schema takes a naive shape — e.g., a billing row that live-joins to current contract/contract-item rows to compute what's owed — then the fact that contract items remain editable in sections 1/3 even after `confirmed` (Pitfall 7's context) means a later edit to a line item can retroactively change what a *already-issued* historical invoice "shows," which is both a bookkeeping and (for a real business) a legal problem.

**Why it happens:** It's tempting to design billing as a thin computed layer over the contract because "the data's already there," which minimizes schema work now — but that couples billing correctness to contract mutability, and contract mutability is a deliberate feature of this system (sections 1/3 stay open post-confirm).

**How to avoid:**
- Design billing as an **append-only ledger/snapshot model** from the start: a billing period row captures a snapshot of the contract items/amounts *as they were* at billing time (e.g., a JSON snapshot column or a `s030_billing_item` row copied from `s030_contract_item` at generation time), not a live foreign-key join recomputed on every read. This is the standard pattern for "historical invoice must not change when the underlying record changes" and it's far cheaper to build this way now than to migrate a live-join design later once real invoices exist.
- Keep the billing tables genuinely unused (no reads/writes from application code) in this milestone, but version them as real migrations from day one so Phase 3 (billing UI/API) is additive, not a schema rewrite.
- Explicitly flag in the schema design doc which billing fields are guesses pending PG-policy decisions (e.g., payment method enum, partial-payment support) so Phase 3 knows what's provisional.

**Warning signs:**
- A billing schema with foreign keys directly into mutable `s030_contract_item` rows and no snapshot/copy mechanism.
- No `deleted_at`/versioning concept on billing rows despite contracts being mutable post-confirm.

**Phase to address:** Auth & Schema Spec phase (this milestone explicitly schemas billing without building it — get the shape right once).

---

### Pitfall 10: Booking double-booking races, interval math, and timezone handling

**What goes wrong:**
- **Double-booking race:** two users book the same room/slot within milliseconds of each other; a naive "check for overlap, then insert" (two round trips) has a race window where both checks pass before either insert commits.
- **Off-by-one interval overlap:** if bookings are compared with closed intervals (`start <= x <= end` on both sides) instead of half-open (`[start, end)`), a booking ending at 11:00 and another starting at 11:00 will incorrectly register as overlapping (or, with the opposite mistake, back-to-back-but-actually-overlapping bookings won't be caught).
- **Cancelled bookings still blocking slots:** if the overlap check doesn't filter `status != 'cancelled'`, a cancelled booking permanently locks that slot.
- **Recurring bookings as one row:** a single row with a recurrence rule can't be individually cancelled/moved for one occurrence, can't be indexed/queried efficiently for a month view, and can't participate in a DB-level overlap constraint.
- **Timezone drift:** Korea has no DST, but that doesn't mean timezone bugs can't happen — storing `timestamp without time zone` values that are implicitly assumed to be KST, then having the kiosk display device, a server process, or a browser with a non-KST OS timezone (a real risk for a Vercel/cloud-hosted Node process, which may run with `TZ=UTC` by default) interpret/format those raw values as if they were already in the viewer's local zone, silently shifting all displayed times by 9 hours.
- **Month-view queries scanning everything:** fetching all bookings for a room/center and filtering to the visible month in JavaScript, rather than filtering by date range in the query, degrades as booking volume grows and defeats any index.

**Why it happens:** Booking/scheduling overlap logic is one of the few genuinely tricky algorithmic pieces in an otherwise CRUD-heavy app, and it's easy to under-invest in it because "it's just a calendar."

**How to avoid:**
- Enforce non-overlap **at the database level**, not just in application code: use a Postgres exclusion constraint with the `btree_gist` extension, e.g. `EXCLUDE USING gist (room_id WITH =, tsrange(start_at, end_at) WITH &&) WHERE (status <> 'cancelled')`. This makes double-booking impossible regardless of race conditions or which code path inserts the row, and is the standard Postgres pattern for this exact problem.
- Model intervals as half-open (`[start, end)`) consistently everywhere — in the DB range type, in application comparisons, and in any manual overlap-check fallback.
- Store all booking times as `timestamptz` (UTC under the hood), and do all local-time formatting/parsing explicitly against `Asia/Seoul` in the presentation layer (e.g., via `Intl.DateTimeFormat` with an explicit `timeZone`, or `date-fns-tz`), never relying on the host process's default timezone.
- Model recurring bookings as a `booking_series` (the recurrence definition) plus individual `booking_occurrence` rows (one row per actual instance, each independently cancellable/movable and each participating in the exclusion constraint) rather than a single row with an RRULE string.
- Query month/week views with an indexed date-range `WHERE` clause (`start_at >= :rangeStart AND start_at < :rangeEnd`, indexed on `(room_id, start_at)`), never "fetch all, filter in JS."

**Warning signs:**
- Overlap logic implemented as a `SELECT` followed by an `INSERT` in separate statements/transactions with no DB constraint backing it up.
- Any `<=`/`>=` (closed-interval) comparison in overlap-check code.
- A `recurrence_rule` text column directly on the main booking table with no child-occurrence table.
- Kiosk display or booking screen showing times that are off by exactly 9 hours in any environment.

**Phase to address:** Booking phase (not currently one of the 9 listed dev-order steps in `doc/SWONBIZ_PROJECT_STRUCTURE.md` §6 — see Pitfall 14 below; this is itself a scope/process gap worth flagging in the roadmap). The exclusion-constraint and timestamptz decisions belong in the Auth & Schema Spec phase since they're schema-level.

---

### Pitfall 11: Server-side masking implemented as string substitution instead of field omission (and other tenant-leak-adjacent JSON payload mistakes)

**What goes wrong:** Even when the team correctly moves booking masking to the server (per Pitfall 4), a subtle version of the same bug remains if the masked response still includes the real fields with placeholder values (e.g., `title: "예약됨"` as a *string value* alongside a still-present but empty `orgName: ""`) instead of omitting the keys — this is lower risk than the full-leak version but still an anti-pattern: it invites a future refactor to "just read `orgName` since it's already there," accidentally reintroducing the leak, and it's inconsistent with how a masked vs. unmasked object should look structurally (client code has to special-case on content instead of on a clear `visibility: 'masked' | 'full'` flag with a genuinely different shape).

**Why it happens:** It's a smaller code change to keep the same object shape and swap in placeholder strings than to define two distinct response types.

**How to avoid:** Define two distinct TypeScript/Zod response shapes — `BookingFull` and `BookingMasked` — where `BookingMasked` structurally does not have `title`/`orgName`/`headcount` fields at all, and have the server pick which one to serialize per row based on `viewerOrgId === booking.orgId || role === 'operator'`. This makes the omission a type-level guarantee, not a convention that can be forgotten in the next endpoint.

**Warning signs:** A single `Booking` type used for both masked and full views with optional/nullable sensitive fields.

**Phase to address:** Booking phase, designed alongside Pitfall 4's shared query helper.

---

### Pitfall 12: Design-template migration drift — redesigning while porting, and the known hardcoded values

**What goes wrong:**
- **Silent redesign:** because the templates are static HTML/CSS and the target is React, every port involves *some* decision (how to structure state, how to break markup into components) — and it's easy for those decisions to bleed into small visual/interaction changes ("this spacing looks off, let me adjust it") that drift from the `.dc.html` source of truth over many small PRs, none of which look like a redesign individually.
- **Reinventing DS components:** a screen-specific need (e.g., a slightly different badge in the booking screen) gets built as a one-off inline component instead of extending `components/ds/Badge.tsx`, and over time the "15 DS components" stop being the actual source of every badge/button/tag in the app.
- **The known hardcoded values ship as-is:** `ErpContractForm.dc.html`'s contract-preview modal has "이정희" (담당자명) and "강남 삼성점" (센터명) hardcoded in the markup. `doc/SWONBIZ_MODAL_COMPOSITION_P1.md` already specifies the correct lookup order (지점 담당자 → 조직 기본 담당자) — the risk is that the *markup* gets ported faithfully (as instructed — "이관, not 새로 설계") but the hardcoded strings get carried along literally because nobody wires up the lookup, and it isn't caught because the preview *looks* correct for whichever contract happens to belong to 강남 삼성점.
- **Print CSS dropped or broken by componentization:** the `@media print` rules in the original static HTML assume a particular DOM structure. If the modal shell becomes a React `Dialog` component that renders its children into a portal (common pattern for accessible modals), the print stylesheet's selectors (scoped to the original document flow) can silently stop matching, and `window.print()` output regresses (extra chrome printed, or content cut off) without it being visible in normal on-screen testing.
- **Contract document text embedded in JSX:** the spec explicitly warns about this — "계약서 문안은 docs/ 에 별도 텍스트로 분리하고 치환 변수로 채운다. JSX에 문안을 직접 쓰지 말 것" — if this is skipped for expedience, every future legal-text edit becomes a code change reviewed by engineers instead of a text-file edit reviewable by whoever owns the actual contract wording.

**Why it happens:** "Migrate, don't redesign" is easy to say and hard to enforce without a mechanical check; hardcoded placeholder values in a design mockup look like real content and are easy to miss because the preview renders successfully either way.

**How to avoid:**
- Diff against the `.dc.html` source visually (side-by-side screenshot comparison) at the end of each screen's port, not just "does it look reasonable."
- Grep the ported codebase for the known literal strings ("이정희", "강남 삼성점") before considering the contract-preview modal done — their presence anywhere outside a documented fallback/seed-data context is a bug.
- Actually implement the 지점 담당자 → 조직 기본 담당자 fallback lookup as part of the same task as porting the preview modal, not a follow-up ticket (the spec calls out the order specifically because it's a real business rule, not a nice-to-have).
- Test `window.print()` on the ported contract-preview modal specifically, after componentization — not just visual review on-screen. Verify the print stylesheet's selectors still match the portal-rendered DOM.
- Extract contract document wording (이용계약서/전대차계약서 body text) into plain text/markdown files with named placeholders from the start, per the spec's own instruction — don't let it land as JSX template literals "temporarily."
- Add a lint/stylelint rule banning green color values (`bg-green-*`, `text-green-*`, `#..` values matching common green hexes) repo-wide, since "no green anywhere, even success states" is a rule that's easy to violate accidentally (copy-pasted Tailwind snippet, browser default `<progress>`/`<meter>` styling, a third-party component's default success color) and expensive to catch by review alone across dozens of screens.

**Warning signs:**
- Any component whose Tailwind classes/CSS don't trace back to a corresponding class/rule in the source `.dc.html`.
- A grep for "이정희" or "강남 삼성점" returning hits outside of documented seed/fixture data.
- No print-preview test step in the definition of done for the contract-preview modal.
- Contract document body text living in a `.tsx` file.

**Phase to address:** Ongoing from Phase 1 (tokens.css) through every screen port, but the hardcoded-value and print-CSS issues specifically must be resolved by end of Phase 8 (contract form), and the green-color lint rule should be added as early as Phase 2 (DS components) so it protects every subsequent screen automatically.

---

### Pitfall 13: Focus-trap and accessibility regressions when hand-written modals become React components

**What goes wrong:** The original `.dc.html` templates are static, hand-written HTML/CSS/JS. The five ported popups (`s0300200030p1/p2`, `s0300200040p1/p2`, `s0300000010p1`) route through a shared `components/ds/Dialog.tsx` per the composition spec — which is good — but the risk is in the *content* each modal wraps: the contract-preview modal has a large scrollable body inside a fixed-height (`92vh`) shell with a fixed header/footer, and the state-change confirmation modal needs autofocus behavior that differs by which of the 3 actions triggered it (e.g., a required 취소 사유/종료 사유 textarea should likely receive focus for the destructive-with-reason variants). If focus-trap, Escape-to-close, return-focus-to-trigger, and scroll containment aren't each explicitly verified per popup (not just "the Dialog component handles it in general"), regressions are easy to introduce per-instance — e.g., a long contract-preview body that traps page scroll instead of just modal-body scroll, or a confirm modal where Tab cycles out of the dialog into the page behind it.

**Why it happens:** "The Dialog component has a focus trap" is true in general but doesn't guarantee every specific modal instance composes correctly with it (e.g., an autoFocus element inside content that renders asynchronously after the dialog opens, or nested scrollable regions confusing trap boundaries).

**How to avoid:** Manually verify, per popup instance (not just once for the Dialog primitive): Tab cycles only within the modal, Escape closes it, focus returns to the triggering element on close, and only the modal body (not the page) scrolls when content overflows. Do this explicitly for the contract-preview modal (large content, print button) and the destructive state-change modal (reason textarea) given they're the two most complex instances.

**Warning signs:** Keyboard Tab from the last focusable element in a modal landing on page content behind it; page scroll moving when a modal with overflowing content is open.

**Phase to address:** Phase 8 (contract form popups) and wherever `s0300200030p1/p2`/`s0300000010p1` are built (Phases 4, 6–7).

---

### Pitfall 14: Booking domain missing from the stated 9-step build order, and constants/screen-map drift

**What goes wrong:** `doc/SWONBIZ_PROJECT_STRUCTURE.md` §6 lists a 9-step 1차 development order (scaffolding → tokens → DS → auth → auth screens → shell → tenants list/detail → tenants/contracts master-detail → contract form → dashboard) that does not mention 회의실 예약 (booking) or the kiosk board at all, even though both are Active requirements in `PROJECT.md` and 회의실 예약/기준관리 were explicitly pulled forward from 2차 to 1차 per the Key Decisions table. If the roadmap is built directly from that 9-step list without reconciling it against the actual Active requirements, booking either gets silently dropped from the near-term plan or gets bolted on at the end without its own schema/design-review pass. Separately, `lib/screens.ts` is specified as the single source of truth for screen-ID↔route↔role mapping, and the middleware is supposed to read `role: 'operator'` from it — but nothing enforces that every new route folder actually gets a corresponding entry; a forgotten entry for a new operator-only route is a security gap, not just a documentation gap. Likewise, `lib/constants.ts` is meant to centralize undetermined values (요금, QR URL, 예약 시간) including ones with per-room overrides ("회의실별 재정의가 있으면 그 값이 우선") — if some code reads the raw constant instead of a resolver function that checks for a room-level override first, the override feature silently doesn't work for whichever code path skipped the resolver.

**Why it happens:** The 9-step order predates the Key Decision that moved booking into 1차 scope, so the two documents are already inconsistent as written. Central mapping tables (`screens.ts`) and constant files degrade over time unless something other than developer memory enforces their use.

**How to avoid:**
- When building the roadmap, explicitly insert a booking-domain phase (and reconcile it against the 9-step list) rather than assuming the 9 steps are exhaustive for 1차.
- Add an automated check (a small script or test) that every route directory under `app/(erp)/` has a matching entry in `lib/screens.ts`, and that the middleware's role-check logic is generated from `screens.ts` rather than hand-duplicated.
- Require any code needing a booking-domain constant with a stated per-room override (fees, time windows) to go through a single resolver function (e.g., `getEffectiveBookingRule(room)`) rather than importing the raw constant, and make that resolver the only place `lib/constants.ts`'s booking values are read from directly.

**Warning signs:**
- A roadmap draft with no explicit booking phase.
- A new `(erp)` route added without a corresponding `lib/screens.ts` entry.
- Direct imports of `BOOKING.OVERAGE_FEE_PER_30MIN`-style constants inside UI components instead of through a resolver.

**Phase to address:** Roadmap creation itself (this is exactly what this research feeds) for the missing-booking-phase issue; ongoing process discipline from Phase 1 onward for the screens.ts/constants issues.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Decoding JWT claims in multiple places instead of one `verifyToken.ts` | Faster to write one-off checks | Verification logic drifts; one call site forgets `iss`/`aud`/`exp` | Never |
| Client-side "예약됨" masking with full data fetched | Ships the UI requirement fastest | Real tenant-leak vulnerability, wire-visible in devtools | Never |
| Storing contract `total_amount` as a plain column set from the browser | Simple, no trigger to write | Silently stale total after any item edit post-confirm; wrong number on printed legal document | Never |
| Using `service_role`/superuser DB credentials in Fastify for convenience | No need to design a scoped app role | RLS (if any) becomes meaningless; every query is one bug away from cross-tenant access | Never for the main data path; acceptable only for isolated, reviewed admin scripts |
| Billing schema as a live join over mutable contract tables | Less schema work now | Historical invoices change when contracts are later edited | Never — snapshot/ledger model instead |
| Skipping the DB exclusion constraint for booking overlap, relying on app-level check-then-insert | Faster to ship v1 | Double-booking under concurrent load, hard to reproduce/debug later | Acceptable only in a throwaway prototype, never in the shipped booking phase |
| Inline one-off badge/button styles instead of extending `components/ds/*` | Faster for a single screen | Visual drift, green-color rule violations creep in, DS stops being the source of truth | Only for a genuinely one-off element that will never repeat, and even then prefer extending DS with a variant |
| Contract document text as JSX template literals "for now" | Faster initial port | Every legal-text edit requires an engineering PR; text scattered across component files | Never — spec explicitly calls this out |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|-----------------|-------------------|
| 삐용 (bbiyong) JWT | Decode without verify "just to route"; assume claim names/units are stable forever | Single verified `lib/auth/verifyToken.ts` with a Zod-validated claim schema; treat claim shape as a versioned contract |
| 삐용 refresh/session (`token010`) | Each client independently triggers refresh on 401, causing storms; TTL guessed on the ERP side | Single-flight refresh; source TTL directly from bbiyong config, not re-derived |
| Supabase Postgres via pooler | Using the transaction-mode (6543) pooled connection for code that relies on `SET LOCAL`/session state or prepared statements | Use session-mode/direct connection for anything needing session state; disable prepared-statement caching for pooled connections (e.g., Prisma `pgbouncer=true`) |
| Supabase `service_role` key | Used in the main Fastify data-access path "because it's easier" | Reserve for isolated, reviewed admin operations only; main path uses a scoped role and/or app-level tenant filtering |
| Next.js middleware ↔ Fastify API | Assuming middleware's redirect-to-login protects the API too | Fastify (and any Next Route Handler) independently verifies the JWT and tenant scope on every request |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Month-view booking queries fetching all rows then filtering in JS | Booking/kiosk screens slow down as booking history grows | Indexed date-range `WHERE` on `(room_id, start_at)`, never client-side filtering of the full table | Noticeable once a center accumulates a few thousand bookings (well within year 1) |
| App-level check-then-insert for booking overlap under load | Occasional double-bookings that "shouldn't be possible," worse during peak booking times (e.g., start of business day) | DB exclusion constraint (`EXCLUDE USING gist`) | Any concurrent booking traffic, not a scale threshold — it's a correctness bug, not a scale one |
| Recomputing contract totals on every read via a live join across up to 10 items × 20 users | Slower contract list/detail pages as item/user counts grow | Trigger-maintained or generated `total_amount` column, computed once per write | Noticeable once contract list pages show totals for many contracts at once (dashboard, tenant list) |
| Unscoped `COUNT(*)`-style aggregate queries for dashboard stats | Dashboard numbers technically correct today but architecturally leak tenant-wide counts if reused for a tenant-facing view later | Always compute aggregates via the same tenant-scoped query path, even for operator-only screens today | Breaks the moment a "count" value is reused on any screen visible to 입주사 |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Trusting `alg` from the JWT header at verify time | Algorithm confusion attack (HS256/RS256 mixup, `alg: none`) forges valid-looking tokens | Hardcode the expected algorithm in the verify call; never derive it from the token itself |
| Same error shape/message for "not found" vs "not yours" not enforced | Attacker enumerates other tenants' contract/booking IDs via error-message differences | Uniform 404 for both cases across all resource endpoints |
| Secrets or DB credentials reachable from a "shared" util imported by both server and client components | JWT secret or connection string bundled into client-side JS | Mark server-only modules with the `server-only` package so the build fails if client code imports them |
| Module-level/global mutable variables holding "current tenant"/"current user" in a long-lived Node/Fastify process | Concurrent requests interleaving on async boundaries leak one request's tenant context into another's response | Always thread tenant/user context through function parameters or a proper request-scoped context (e.g., AsyncLocalStorage), never a module-level `let currentOrg` |
| Booking masked fields present-but-empty in JSON instead of omitted | Encourages future code to read the "empty" field, reintroducing the leak | Distinct `Full`/`Masked` response types with genuinely different shapes |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Redirect straight to `/login` on any 401 while mid-contract-form | User loses up to 20 users' / 10 items' worth of unsaved input on a routine token refresh hiccup | Distinguish recoverable auth expiry from real session death; preserve draft state and prompt in-place re-auth |
| Disabling (rather than hiding) impossible state-transition buttons | Users click a greyed-out "종료" button and file a support ticket asking why it's disabled | Per the existing spec: don't render buttons for transitions that aren't currently possible |
| Kiosk/booking screens showing times off by 9 hours in some deployment environments | Front-desk staff or visitors see wrong meeting times on the physical display | Explicit `Asia/Seoul` formatting everywhere, verified in a non-KST-default hosting environment before launch |
| Contract preview modal print output visually broken (extra chrome, cut content) after componentization | Operator prints a legal contract document that looks unprofessional or is missing content | Explicit print-preview verification step per the componentized modal, not just on-screen review |

## "Looks Done But Isn't" Checklist

- [ ] **JWT verification:** Often missing algorithm pinning, `iss`/`aud` checks, and a schema-validated claim shape — verify with an expired-token test, a wrong-issuer test, and a tampered-signature test, not just a happy-path login.
- [ ] **Booking masking:** Often implemented as client-side string substitution — verify by inspecting the raw network response as a 입주사 user, not just the rendered UI.
- [ ] **Contract state transitions:** Often enforced only via which buttons render — verify by attempting a direct API call (e.g., curl with a valid token) to make an out-of-order transition or edit a locked section.
- [ ] **Contract-preview modal:** Often missing the 지위 담당자→조직 기본 담당자 fallback (hardcoded 이정희/강남 삼성점 ships instead) and/or has broken `@media print` output post-componentization — verify by grepping for the literal hardcoded strings and by actually printing.
- [ ] **Contract total amount:** Often stored from a client-computed value with no server-side recompute — verify by editing a line item after `confirmed` and checking the stored/displayed total updates.
- [ ] **Multi-tenant list/search/autocomplete endpoints:** Often the tenant filter is present on the "main" list endpoint but missing on search/autocomplete added later — verify every endpoint that returns contract/booking/tenant data, not just the primary list view.
- [ ] **Audit trail:** Often the confirm/terminate reason typed into the modal is discarded after the status update — verify a history/audit row is actually persisted with actor and timestamp.
- [ ] **Booking overlap prevention:** Often "prevented" only by an app-level check with no DB constraint — verify by firing two concurrent booking requests for the same slot and confirming exactly one succeeds.
- [ ] **Green-color rule:** Often violated by a copy-pasted component or third-party default — verify by grepping rendered CSS/Tailwind classes across all screens, not just the ones consciously designed for "success" states.
- [ ] **`lib/screens.ts` coverage:** Often drifts as routes are added ad hoc — verify every `(erp)` route folder has a matching entry and that the middleware's role-gating is actually driven by it.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|------------------|
| Tenant-leak found in a shipped list/search endpoint | MEDIUM | Patch the query to add the missing filter; audit logs/access records for any actual cross-tenant reads during the exposure window; add the endpoint to the shared tenant-scoped helper so the class of bug can't recur there |
| Contract total drift discovered (stored total ≠ recomputed total) | MEDIUM | Backfill-recompute all existing `total_amount` values in a one-off migration; add the trigger/generated column so it can't drift again; audit any printed/issued documents that used the stale total |
| RLS found to be silently bypassed by `service_role` usage | MEDIUM–HIGH | Re-architect the connection to use a scoped role for the main data path; treat the "RLS is protecting us" assumption as false until re-verified with a test using the actual production credential path |
| Billing schema needs reshaping once real payment/PG requirements land | HIGH if built as a live join over contracts; LOW if built as a snapshot/ledger from the start | If snapshot-based: additive migration only. If live-join based: full backfill into a new snapshot table plus reconciliation against any already-issued invoices |
| Double-booking incident found in production | LOW–MEDIUM | Add the DB exclusion constraint retroactively (requires resolving any existing overlapping rows first); manually resolve the conflicting bookings with affected tenants |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| JWT verification gaps (alg confusion, missing claims, decode-without-verify) | Auth & Schema Spec (Phase 0) | Unit tests for expired/wrong-issuer/tampered-signature tokens against `verifyToken.ts` |
| Claim-shape/clock drift with bbiyong | Auth & Schema Spec (Phase 0) | Documented claim schema (Zod) reviewed against actual bbiyong token samples |
| Middleware-only route protection | Auth & Schema Spec (Phase 0) pattern; Phase 3 (auth integration) implementation | Attempt direct API calls bypassing the Next.js UI for at least one protected endpoint |
| Multi-tenant leaks (WHERE clause, IDOR, masking, search) | Auth & Schema Spec (Phase 0) for the shared-helper pattern; every phase adding a list/detail/search endpoint (6, 7, 8, booking phase) | Inspect raw network responses as a 입주사-role test user for every new endpoint |
| RLS/pooler/service_role misconfiguration | Auth & Schema Spec (Phase 0) | Load-test the pooled connection path for prepared-statement errors; confirm which DB role Fastify actually connects as |
| Refresh races / mid-form token loss | Auth & Schema Spec (Phase 0) for TTL contract; Phase 3 for single-flight refresh; Phase 8 for form-draft resilience | Simulate concurrent refresh calls; simulate token expiry mid-contract-form-edit |
| Contract state machine server-side enforcement | Auth & Schema Spec (Phase 0) for the transition table; Phase 8 for enforcement | Direct API attempt at an out-of-order transition returns 409 |
| Missing audit trail / derived-total drift | Auth & Schema Spec (Phase 0) schema; Phase 8 enforcement | Confirm a history row appears per status change; edit an item post-confirm and confirm total updates |
| Billing schema premature-coupling | Auth & Schema Spec (Phase 0) | Schema review confirms snapshot/ledger shape, not live joins to mutable contract tables |
| Booking overlap/timezone/recurrence | Auth & Schema Spec (Phase 0) for schema (exclusion constraint, timestamptz); booking phase for implementation | Concurrent double-booking attempt test; timezone display check in a non-KST-default environment |
| Design-template drift / hardcoded values / print CSS | Ongoing from Phase 1; hard checkpoint at Phase 8 | Grep for hardcoded strings; visual diff against `.dc.html`; manual print test |
| Focus-trap/accessibility regressions in ported modals | Phases 4, 6, 7, 8 (wherever each popup is built) | Manual keyboard-only walkthrough per modal instance |
| Missing booking phase / screens.ts / constants drift | Roadmap creation itself | Roadmap explicitly lists a booking-domain phase; CI check for `screens.ts` coverage |

## Sources

- OWASP JSON Web Token Cheat Sheet (algorithm confusion, `alg:none`, claim validation) — well-established, HIGH confidence from training data, consistent with all current JWT library documentation (jose, jsonwebtoken).
- [Jose vs jsonwebtoken (2026) — edge runtime compatibility](https://www.pkgpulse.com/compare/jose-vs-jsonwebtoken) — verified Edge Runtime cannot use Node `crypto`-dependent `jsonwebtoken`; `jose` is the edge-compatible choice.
- [Next.js Middleware Edge Runtime limitations](https://medium.com/@shuhan.chan08/authentication-in-next-js-middleware-edge-runtime-limitations-solutions-7692a44f47ab) — confirms Node module restrictions in `middleware.ts`.
- [Supabase connection pooling / PgBouncer transaction-mode limitations](https://github.com/orgs/supabase/discussions/28239) and related — confirms prepared statements and session-persisting `SET` are unsupported in transaction-mode pooling; `SET LOCAL` within a transaction is the supported pattern.
- [Supabase service_role key bypasses RLS](https://supabase.com/docs/guides/troubleshooting/why-is-my-service-role-key-client-getting-rls-errors-or-not-returning-data-7_1K9z) — confirms service_role always bypasses RLS regardless of policy content.
- [Next.js App Router caching defaults and authenticated-data leak risk](https://medium.com/@mzajbe/next-js-defaults-can-leak-your-data-25499fc0249b) — confirms fetch/Route Handler caching is no longer cache-by-default starting Next.js 15, but explicit `force-cache`/`unstable_cache` usage on tenant-scoped data remains a live risk regardless of version.
- PostgreSQL exclusion constraints with `btree_gist` for range-overlap prevention — standard documented Postgres pattern (`CREATE EXTENSION btree_gist`, `EXCLUDE USING gist`), HIGH confidence, widely used for booking/scheduling overlap prevention.
- `doc/SWONBIZ_PROJECT_STRUCTURE.md` and `doc/SWONBIZ_MODAL_COMPOSITION_P1.md` (project repo) — source of the specific hardcoded-value, dev-order, and screen-mapping facts cited throughout.

---
*Pitfalls research for: Multi-tenant coworking-space ERP (SwonBiz ERP)*
*Researched: 2026-09-01*
</content>
