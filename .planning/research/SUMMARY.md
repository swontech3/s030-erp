# Project Research Summary

**Project:** SwonBiz ERP
**Domain:** Korean coworking-space (공유오피스) operations ERP — internal tool for a single operator (에스원비즈), multi-tenant only in the sense that 입주사 (tenant companies) log in and see a scoped slice of data. Next.js App Router frontend + separate Fastify backend + Supabase-hosted PostgreSQL (`s030_*` schema, shared instance with 삐용's `s020_*` and future `s040_*`), identity federated from an external Spring Boot system (삐용/bbiyong).
**Researched:** 2026-09-01
**Confidence:** MEDIUM-HIGH

## Executive Summary

SwonBiz ERP is a category-standard coworking-space operations tool (contract lifecycle → room/meeting-room master data → booking → occupancy), and the four research passes largely *confirm* the shape already decided in `PROJECT.md`/`doc/SWONBIZ_PROJECT_STRUCTURE.md` rather than overturning it. The core value — taking a tenant from registration through a `confirmed`, printable contract — matches how OfficeRnD/Nexudus/Cobot all model the category, and the project's own schema instincts (generic contract line items, deposit tracking, distinct 이용계약/전대차계약 types) are validated as correct rather than gold-plating. The two genuinely hard problems are (1) federating identity from a system this project cannot modify (삐용, Spring Boot, unknown JWT algorithm) and (2) enforcing multi-tenant data isolation with 100% code discipline in a stack that has no framework-level tenant guardrail (plain Fastify + Postgres, no Supabase Auth, no ORM-level scoping).

The recommended approach is: **token exchange** at login (ERP verifies 삐용's JWT once, server-to-server, and mints its own short-lived local session — the browser never sees 삐용's token, which also makes the `swonbiz.com` vs `s-wontech.co.kr` cross-domain cookie problem disappear by construction); **application-layer tenant scoping via one shared, mandatory query-helper layer** as the actual enforcement mechanism (not Postgres RLS, which this stack cannot cleanly use without extra plumbing this project isn't doing — see Resolved Conflicts); and a small number of **schema-forcing decisions that must be made in a dedicated pre-build spec pass, before any migration is written** — generic contract line items with a type discriminator, `billing_start_date` split from `contract_start_date`, deposit + refund-status fields, a per-contract snapshot of 사업자등록번호, a booking overlap constraint (`EXCLUDE USING gist` + `btree_gist` + `tstzrange`), and a server-side contract state-transition guard independent of the UI.

The biggest risk is not technology choice but two classes of silent, hard-to-detect failure: (a) tenant-isolation leaks that fail one endpoint at a time (a forgotten `WHERE org_id = ...` on a search/autocomplete route built in a hurry) rather than one big bug, and (b) auth code that "verifies" a token structurally (signature checks out) but not semantically (wrong algorithm accepted, no `iss`/`aud` check, epoch-seconds-vs-milliseconds bug) — both are the kind of mistake that survives code review under deadline pressure and is expensive to retrofit once dozens of screens assume the session/tenant context is trustworthy. Both are addressed by making the enforcement mechanism structurally hard to bypass (one shared verify function, one shared tenant-scoped repository layer) rather than relying on convention.

## Key Findings

### Recommended Stack

Next.js 16.3.x (App Router, React 19.2.x) and Fastify 5.12.x are fixed by constraint; everything else is chosen to fit them. `jose@6.2.x` is the JWT library for all verification (works identically in Node and Next.js Edge middleware, unlike `jsonwebtoken`). Zod + `fastify-type-provider-zod` is preferred over TypeBox specifically because the same Zod schemas can validate the heavy 20-user/10-item contract form on both `react-hook-form` (client) and Fastify (server) without drift. Drizzle ORM + `drizzle-kit generate` produces migration SQL that is copied into `supabase/migrations/` and applied via the Supabase CLI — never `drizzle-kit push`, because the Postgres instance is shared with `s020_*`/`s040_*` and a schema-owning tool would clobber or ignore other teams' migrations. CSS Modules (not Tailwind) match the "migrate the `.dc.html` templates as-is" constraint. The booking grid is hand-built from the existing templates, not a third-party scheduler library, to preserve pixel fidelity to the fixed design system.

**Core technologies:**
- `typescript@5.9.3` (pinned explicitly) — `npm install typescript`/`latest` currently resolves to the Go-native TS 7.x rewrite, which `typescript-eslint` does not yet reliably support.
- `jose@6.2.x` — verifies JWTs; the only library that works in both Node (Fastify) and Edge (Next.js middleware) runtimes.
- Drizzle ORM + drizzle-kit + Supabase CLI — schema definition and migration generation, applied through one shared, ordered SQL migration history for the whole shared database.
- Zod (both sides) + `fastify-type-provider-zod` — one validation source of truth for the contract form's dynamic item/user rows.
- Postgres `btree_gist` extension + `tstzrange` — database-enforced booking overlap prevention.

### Expected Features

**Must have (table stakes) — matches PROJECT.md's Active scope, validated against OfficeRnD/Nexudus/Cobot:**
- Contract as first-class entity with a defined lifecycle, driving occupancy/renewal/document-print.
- Generic `contract_item` rows (type discriminator, not fixed room+addon columns) — required because real coworking contracts bundle parking/lockers/virtual-office/signage as priced line items, not just a room.
- Deposit amount + refund-status field, and `billing_start_date` distinct from `contract_start_date` (Korean 무상기간 free-rent period) — both are schema-forcing: unrecoverable later if omitted, because retroactively reinterpreting which historical contracts had a free period or what their true deposit status was is not reliably possible.
- Per-contract snapshot of 사업자등록번호/business-registration details — Korean 세금계산서 is legally tied to buyer info *as of the transaction*, and a company's registered details can change between signing and a later renewal.
- Contract type (이용계약 vs 전대차계약) as an explicit, validated, operator-chosen field — legally distinct obligations, not paperwork nuance.
- Building/floor/room/meeting-room master data, meeting-room booking with conflict prevention, kiosk display, occupancy/vacancy view, multi-tenant masking of other tenants' bookings and contract data.

**Should have (near-zero-cost, worth pulling into v1):**
- Expiring-contract filter/sort on the existing contract list — no new schema (uses existing `end_date`), high operational value (missed renewals cost revenue directly).
- A `renewed_from_contract_id` self-referencing FK on contract, even if the UI only creates a new row in v1 — otherwise renewal history is unrecoverable later.

**Defer (v2+), correctly:**
- Full billing/invoicing (v3) — but the v1 schema (line items, deposit, billing_start_date, biz-reg snapshot) must already be shaped to support it without rework; billing itself should be an append-only snapshot/ledger, never a live join over mutable contract rows.
- Recurring bookings, check-in/no-show tracking, revenue analytics, external/guest booking approval queue (already blocked on policy decisions).

**Anti-features (do not build even though the category has them):** CRM/sales pipeline, community feed, door-access hardware integration, visitor management, perks marketplace, native mobile apps, and — explicitly verified as actively harmful here — **two-way external calendar sync (Google/Outlook)**, which OfficeRnD's own docs confirm leaks masked booking titles/details once synced to a calendar the operator doesn't control, directly undermining the hard multi-tenant masking constraint.

### Architecture Approach

Browser talks only to `erp.swonbiz.com` (Next.js). All calls to 삐용 (`bbiyong.s-wontech.co.kr`, a different registrable domain — cookie sharing is structurally impossible) are server-to-server, confined to Next.js Route Handlers under `/api/auth/*`. Next.js middleware performs only a cheap, non-authoritative structural check (cookie present, not expired, read role for redirect) using `jose` on the Edge runtime; Fastify is the actual authorization boundary and independently re-verifies identity, role, and tenant scope on every request, because Next.js middleware has a documented history of being bypassable (CVE-2025-29927) and cannot protect Fastify if it's ever reachable by another path.

**Major components:**
1. **Next.js Route Handlers (`/api/auth/*`)** — the only code that ever calls 삐용; performs the login-exchange (verify 삐용's JWT once) and mints/refreshes ERP's own httpOnly session cookie.
2. **`s030_org_member` mapping table** — joins "who they are" (삐용's `member_id` + the `external_org_id` chosen at 삐용's 2-step login) to "what they can do here" (ERP's `tenant_id` + `role`), resolved once at exchange time and baked into ERP's own session JWT claims.
3. **Fastify domain services + a shared tenant-scoped repository layer** — the single mandatory code path through which every tenant-scoped query must pass; takes `tenantId`/`role` only from the verified local session, never from client input.
4. **Postgres (`s030_*`, shared instance)** — `EXCLUDE USING gist` constraint for booking overlap prevention; contract state-transition guard and status-history table; append-only billing snapshot shape reserved (unbuilt) for v3.

### Critical Pitfalls

1. **JWT verified structurally but not semantically** — decode-without-verify, no `algorithms:` allowlist, missing `iss`/`aud`/`exp` checks, epoch-seconds-vs-milliseconds bugs. Fix: a single `lib/auth/verifyToken.ts` that every other file is forbidden (by lint/review) from bypassing, with a Zod-validated claim schema and an explicit, hardcoded expected algorithm.
2. **Multi-tenant leaks via forgotten WHERE clauses, IDOR, and client-side-only masking** — the highest-likelihood, highest-blast-radius bug class, because it fails one endpoint at a time (search/autocomplete added later is the classic miss) rather than once. Fix: one shared repository helper per entity that every route (including search) must call; server-side masking that omits fields entirely (not empty-string placeholders); uniform 404 for "not found" and "not yours."
3. **Middleware-only route protection** — treating the Next.js middleware redirect as if it protects Fastify too. Fix: Fastify independently re-verifies every request; middleware is UX only.
4. **Contract state machine and money totals enforced only in the UI** — direct API calls could confirm a contract twice, terminate a `draft`, edit a locked section post-`confirmed`, or leave a stale `total_amount` after a post-confirm line-item edit. Fix: a server-side `canTransition(from, to)` guard and a trigger-maintained/generated total, both independent of which buttons the UI renders.
5. **Booking double-booking, interval, and timezone bugs** — check-then-insert races, closed- vs half-open-interval mistakes, cancelled rows still blocking a slot, host-process default timezone (not `Asia/Seoul`) silently shifting displayed times by 9 hours. Fix: the `EXCLUDE`/`tstzrange`/`'[)'`/partial-predicate pattern, `timestamptz` storage with explicit `Asia/Seoul` formatting at the presentation layer only.

## Resolved Conflicts

The four research passes disagreed or partially overlapped on four points. Resolved as follows — these resolutions, not the individual research files, are the ones to build against.

**1. Postgres RLS — use it or not?**
Not actually contradictory in mechanism: Supabase's `auth.uid()`/`auth.jwt()` helpers are unusable here (no Supabase Auth), but session-variable-driven RLS (`current_setting('app.tenant_id')` set via `SET LOCAL`) still works technically. The resolution is to **not build RLS in v1.** The real cost of doing so is high relative to the benefit here: every scoped query would need to run inside an explicit, short-lived transaction that issues `SET LOCAL` (never plain `SET`, which leaks across tenants under Supavisor's transaction-mode pooler since a physical connection can be handed to an unrelated tenant's request on the very next transaction); Fastify's main data-access path would need a non-`service_role` DB role, since `service_role`/superuser credentials bypass RLS entirely and would otherwise create false confidence that protection exists when it doesn't; and since Fastify is the *only* thing that ever talks to Postgres (never the browser, never PostgREST), RLS isn't closing a gap the application code doesn't already fully control. **Decision: application-layer tenant scoping is the sole enforcement mechanism for v1; RLS is not implemented.** What would change this answer: a second, less-trusted DB client being introduced later (a BI tool, a direct PostgREST exposure, a future service that isn't Fastify) — at that point RLS-as-backstop becomes worth the `SET LOCAL`/session-mode-connection/non-service_role plumbing cost, and should be revisited explicitly, not defaulted into.

**2. Which layer owns tenant isolation, and what is the un-forgettable enforcement mechanism?**
One concrete pattern, combining both researchers' proposals rather than choosing between them: `s030_org_member` resolves *identity* (삐용's `member_id` + the `external_org_id` picked at 삐용's 2-step login → ERP's own `tenant_id` + `role`), done once at login/refresh and baked into ERP's local session JWT claims so it costs nothing per request. The *enforcement* mechanism — the thing that must never be forgotten — is a **shared, mandatory tenant-scoped query/repository helper** (e.g. `getContractsForTenant(tenantId, ...)`, `getBookingsForViewer(viewerTenantId, role, ...)`) that every route, including ones built later in a hurry (search, autocomplete, exports), is required to call; no tenant-scoped table may be queried through any other code path. `tenantId`/`role` are read only from `request.identity` (derived from the verified JWT), never from client-supplied input.

**3. Identity approach — token exchange vs. `jose` verifying 삐용's JWT directly.**
Not a conflict — `jose` is the verification *tool*, used at two different points for two different tokens, exactly as the token-exchange architecture requires: (a) **once, per login/refresh**, a Next.js Route Handler uses `jose` to verify **삐용's JWT** (server-to-server, Node runtime) as the input to minting ERP's own session; (b) **on every request**, Fastify (and optionally, as a cheap UX-only check, Next.js middleware) uses `jose` to verify **ERP's own locally-minted session JWT** (HS256, ERP-only secret — no external trust boundary, since ERP is both issuer and verifier of this token). The browser never holds or forwards 삐용's token. **삐용's actual signing algorithm (HS256 vs RS256) remains unverified by both researchers and is the single top blocking unknown** — it changes only how step (a) imports its verification key (shared secret vs. public key), not the architecture itself.

**4. Build order.**
`doc/SWONBIZ_PROJECT_STRUCTURE.md` §6's 9-step order predates the decision to pull booking (and 기준관리) into v1 and has no booking step at all. Reconciled order (see Implications for Roadmap below): insert an explicit **Auth & Schema Spec** pass before any scaffolding (this is where the JWT/claim-shape, `s030_org_member`, tenant-scoping-helper, contract state-machine/audit, and booking-overlap-constraint decisions are made — schema decisions, not app-code decisions, so getting them wrong later means a migration + data-fix, not a code change), then keep the original 9-step sequence largely intact but **insert a dedicated Booking phase** after Tenants+Contracts and before Occupancy/Dashboard, since booking has its own schema-forcing decision (the exclusion constraint) and its own masking-enforcement surface, and does not naturally fall out of any of the original 9 steps.

## Must-Carry-Forward Facts (feed directly into schema design)

- `billing_start_date` (separate from `contract_start_date`, for 무상기간) — schema-forcing, add now even though billing UI is v3.
- Deposit amount + refund-status enum (held/refunded/withheld/partially withheld) — schema-forcing.
- Per-contract snapshot of 사업자등록번호/business-registration details — schema-forcing; do not rely on the mutable tenant-company record for historical tax-invoice accuracy.
- `contract_item` rows must be generic (item-type discriminator + description + qty + unit price + tax flag), not fixed room-only columns.
- Booking overlap prevention: `EXCLUDE USING gist` + `btree_gist` extension + `tstzrange(start_at, end_at, '[)')` + a partial predicate excluding `status = 'cancelled'` rows — must be decided together with the master booking/room schema, not retrofitted after data exists.
- `swonbiz.com` and `s-wontech.co.kr` are different registrable domains — no cookie can ever be shared between them; all 삐용 calls are server-to-server, never browser-initiated.
- Next.js middleware is a non-authoritative UX gate only (CVE-2025-29927 demonstrated it is bypassable); Fastify must independently verify every request regardless of what middleware already checked.
- `typescript@5.9.3` must be pinned explicitly — unpinned/`latest` resolves to the Go-native TS 7.x line, which lacks confirmed `typescript-eslint` support as of this research date.
- `jose@6.2.x` is the JWT library, chosen specifically because it runs identically in Node (Fastify) and Edge (Next.js middleware) runtimes.
- Migrations flow one direction only: Drizzle schema (`s030_*` tables only) → `drizzle-kit generate` → resulting SQL copied into `supabase/migrations/` → applied via Supabase CLI. Never `drizzle-kit push` against the shared production database.
- Two-way calendar sync (Google/Outlook) is an anti-feature, not a deferred feature — it leaks masked booking details even in category-leading products, directly undermining the multi-tenant masking constraint.
- The expiring-contract filter is a near-zero-cost v1 addition (uses existing `end_date`) worth pulling forward from v1.x.

## Implications for Roadmap

Based on combined research, the reconciled build order (superseding the un-updated 9-step list in `doc/SWONBIZ_PROJECT_STRUCTURE.md` §6):

### Phase 0: Auth & Schema Spec
**Rationale:** Every pitfall ranked "most expensive to retrofit" (JWT verification gaps, tenant-isolation mechanism, contract state-machine enforcement, booking overlap constraint, billing-schema shape) is a *schema or contract decision*, not an app-code decision — getting it wrong later means a migration + data-fix, not a code change. This must be settled and written down before any table is created.
**Delivers:** Documented JWT claim contract (Zod schema) for both 삐용's intermediate and final tokens; `s030_org_member` table shape; the tenant-scoped-query-helper pattern (no RLS, per Resolved Conflicts); full `s030_contract`/`s030_contract_item`/`s030_contract_status_history` schema including deposit, billing_start_date, biz-reg snapshot, and the `canTransition()` guard design; `s030_booking` schema with the `EXCLUDE`/`btree_gist`/`tstzrange` constraint; the (unbuilt but versioned) `s030_billing`/`s030_billing_item` snapshot-ledger shape.
**Addresses:** All schema-forcing features from FEATURES.md.
**Avoids:** Pitfalls 1, 2, 4, 5, 7, 8, 9, 10 (all of PITFALLS.md's "Critical" schema/auth-shaped items).

### Phase 1: Scaffolding + design tokens
**Rationale:** Zero backend dependency; unblocks parallel frontend work immediately.
**Delivers:** Project scaffolding, `styles/tokens.css` lifted from the `.dc.html` templates.

### Phase 2: Design system components (15)
**Rationale:** Pure UI, buildable against static/mock data; must exist before any screen is ported or later screens force one-off inline components that drift from the DS.
**Delivers:** `components/ds/*`. Add the green-color lint rule here so it protects every subsequent screen automatically.

### Phase 3: `lib/auth` (삐용 integration) + middleware
**Rationale:** Implements the Phase 0 spec. Blocked on the top blocking unknown (삐용's signing algorithm) for the *real* login; use a mock 삐용 login/refresh endpoint so Phases 4–9 aren't blocked on 삐용 environment/credential availability.
**Delivers:** Token-exchange Route Handlers, `verifyToken.ts`, single-flight refresh, middleware UX gate.
**Uses:** `jose@6.2.x`.
**Avoids:** Pitfalls 1, 2, 3, 6.

### Phase 4: `(auth)` screens
**Rationale:** Depends on Phase 3; can build/test against the mock.
**Delivers:** Login (2-step: account confirm → org select).

### Phase 5: `(erp)` shell
**Rationale:** Depends on 3/4 for role-based nav; does not depend on tenant/contract schema — build against a stubbed identity object.
**Delivers:** Layout, sidebar, role-based route gating driven by `lib/screens.ts`.

### Phase 6: Master data (buildings/floors/rooms/meeting rooms)
**Rationale:** Operator-only, no tenant-visibility rules to get right yet — the lowest-risk place to prove the full plumbing (auth → tenant claim → Fastify → tenant-scoped helper) end to end before jumping into tenant-scoped data.
**Delivers:** 기준관리 screens and API.
**Implements:** The shared tenant-scoped repository helper pattern from Phase 0, exercised for the first time.

### Phase 7: Tenants + Contracts
**Rationale:** Now that the plumbing is proven on lower-risk data, build the heaviest and highest-value screen (contract form: 4 sections, 5 states, ≤10 items, ≤20 users).
**Delivers:** 입주사 registration, contract create/edit/state-transition, document preview/print (both 이용계약서 and 전대차계약서), status-history audit trail, server-recomputed totals.
**Addresses:** Core value from PROJECT.md; all contract-related table-stakes features from FEATURES.md.
**Avoids:** Pitfalls 4 (tenant leaks on tenant/contract endpoints), 7 (state-machine bypass), 8 (missing audit trail/stale totals), 12 (design-migration drift, hardcoded 이정희/강남 삼성점, print CSS regressions), 13 (modal focus-trap regressions).

### Phase 8: Booking (previously missing from the 9-step order)
**Rationale:** Has its own schema-forcing decision (the overlap-exclusion constraint, decided in Phase 0) and its own masking-enforcement surface distinct from contracts; inserting it here reconciles PITFALLS.md's flag that the original 9-step order has no booking step.
**Delivers:** Meeting-room booking (month/week views, create/edit/cancel), kiosk/door-display board.
**Avoids:** Pitfalls 4 (masking must be server-side field omission, not string substitution — Pitfall 11), 10 (double-booking races, interval/timezone bugs), 14 (the missing-booking-phase gap itself).

### Phase 9: Occupancy views + dashboard
**Rationale:** Read-only aggregation over everything built so far; build last so it has real data to aggregate and its tenant-scoping can be validated against the already-proven helper pattern.
**Delivers:** Occupancy/vacancy screen, operator dashboard.
**Avoids:** The "unscoped `COUNT(*)` that leaks tenant-wide aggregates if reused on a tenant-facing view later" performance/security trap.

### Phase Ordering Rationale

- Schema/auth decisions (Phase 0) come first because they are the hardest and most expensive to reverse once screens are built on top of them (PITFALLS.md's own ranking principle).
- Frontend-only phases (1–2) can start immediately in parallel with Phase 0's spec work, since the DS/scaffolding has no backend dependency — but Phase 3 (real auth wiring) must wait for Phase 0's claim-shape decision to land.
- Master data (Phase 6) is deliberately sequenced before Tenants/Contracts (Phase 7) not just because of data dependency (rooms must exist before a contract can reference one) but because it's a strictly lower-risk place to validate the tenant-scoping plumbing end-to-end, before that plumbing is trusted with actual multi-tenant-sensitive data.
- Booking (Phase 8) is sequenced after Contracts, not before, because it is independent of the contract schema but its overlap-constraint and masking decisions were already made in Phase 0 — no benefit to building it earlier, and building it after Contracts means the tenant-scoping helper pattern is already battle-tested on a real, high-stakes screen (contracts) before being applied to booking's own masking rules.
- Occupancy/dashboard (Phase 9) is last because it's pure read-aggregation with nothing to build until the underlying data exists.

### Research Flags

Phases likely needing deeper research during planning (`--research-phase`):
- **Phase 0 (Auth & Schema Spec):** blocked on the 삐용 signing-algorithm unknown and exact claim shapes — needs direct confirmation from the 삐용 team before the auth portion can be finalized, not just more research.
- **Phase 3 (lib/auth):** single-flight refresh-token architecture across Node-runtime Route Handlers and Edge-runtime middleware has real edge-runtime constraints (no Node crypto) worth a focused pass once 삐용's actual TTL/refresh-rotation behavior is confirmed.
- **Phase 8 (Booking):** the `EXCLUDE`/`btree_gist` pattern itself is standard and well-documented (do not re-research the SQL pattern), but the masking-response-shape work (`BookingFull` vs `BookingMasked` as genuinely distinct types) deserves a phase-specific check against however the shared query helper evolved by Phase 7.

Phases with standard, well-documented patterns (skip research-phase):
- **Phase 1–2 (scaffolding, DS components):** mechanical port of existing `.dc.html`/CSS, no open technical questions.
- **Phase 6 (Master data):** CRUD over a simple hierarchy, no novel pattern.
- **Phase 9 (Occupancy/dashboard):** pure read-aggregation, no novel pattern once the tenant-scoping helper exists.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Package versions verified live against npm registry and official docs (Next.js, Fastify, Supabase, jose). The one open item — 삐용's JWT algorithm — is explicitly flagged as unverified rather than guessed-and-hidden. |
| Features | MEDIUM | HIGH for Western product feature sets (verified against OfficeRnD/Nexudus/Cobot official help centers); MEDIUM-LOW specifically for Korean-operator internal practice, since 패스트파이브/스파크플러스 don't publish operator-side tooling — Korean legal/tax findings are sourced from legal-explainer sites and one tax-ruling excerpt, not the operators' own docs. |
| Architecture | MEDIUM-HIGH | Federated-identity and multi-tenant-Postgres patterns are well-established industry practice (RFC 8693, RFC 8725, documented Postgres exclusion-constraint patterns). Specifics of 삐용 itself (signing algorithm, JWKS/introspection availability, exact `token010` semantics) are unverified because that system's docs/API were not available to this research. |
| Pitfalls | MEDIUM-HIGH | JWT/OWASP/Postgres pitfall patterns are HIGH confidence, well-established. Supabase pooler specifics verified via web search at MEDIUM-HIGH. Project-specific extrapolations (hardcoded values, missing booking step) are HIGH confidence because they cite exact facts already present in the repo's own docs. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **삐용's JWT signing algorithm (HS256 vs RS256) is unverified** — top blocking unknown, see below. Does not block Phases 1–2 or Phase 0's non-auth schema work, but blocks finalizing Phase 3's real (non-mocked) implementation.
- **Exact claim names/shapes** for `memberId`, org id, and role across both the intermediate (org-selection) token and the final session token are unconfirmed — needed for `s030_org_member` resolution logic and the Zod claim-validation schema.
- **삐용's access-token TTL and refresh-token rotation policy** (`token010` semantics — single-use? concurrent-refresh-tolerant?) is unconfirmed — needed to size ERP's own session TTL and the single-flight refresh design (Pitfall 6).
- **Whether 삐용's `external_org_id` can be deterministically matched to an ERP `s030_tenant` record for auto-provisioning** on first 입주사 login, or whether `s030_org_member` rows must be manually pre-seeded — affects Phase 0/Phase 7 schema and onboarding flow design.
- **Three unresolved 사업자/개인 policy questions** from `HANDOVER_T7_ErpApplyForm.md` (business-vs-individual tenant handling, which contract type/VAT treatment applies to non-business individuals, contract-form field semantics) — already correctly flagged as blocking the deferred 온라인 신청 폼, but also touches `contract_type` validation rules that Phase 7 will implement even without the form.
- **Whether a single 입주사 can hold multiple concurrent contracts** — open question already flagged in the project structure doc; affects contract/tenant schema cardinality decided in Phase 0.

## Top Blocking Unknowns

Prioritized — answer these before schema/auth code is written (Phase 0):

1. **삐용's JWT signing algorithm.** Decode the `alg` header of a real issued token (no secret needed to read this) or ask the 삐용 team directly. Determines whether Fastify/Route-Handler verification uses `jose.importJWK`/shared-secret (HS256) or `jose.importSPKI`/public-key (RS256). Flagged independently by both STACK.md and ARCHITECTURE.md as the single top open item.
2. **Whether 삐용 will share the raw HS256 secret or RS256 public key, and through what secure channel.** No JWKS or introspection endpoint exists today; without this, local verification isn't implementable at all and the fallback (calling a 삐용 "validate token" endpoint per request) makes Fastify's availability depend on 삐용's.
3. **Exact claim names/types for `memberId`, org id, and role**, on both the intermediate (org-selection) token and the final session token — needed to write the Zod claim-validation schema and the `s030_org_member` resolution logic.
4. **삐용's access-token TTL and refresh-token rotation/concurrency policy** (`token010` semantics) — needed to size ERP's own session TTL and avoid the refresh-storm/refresh-loop failure modes in Pitfall 6.
5. **Whether 삐용's `external_org_id` can be matched to an ERP `s030_tenant` automatically**, or whether `s030_org_member` requires manual pre-provisioning per 입주사 — affects both Phase 0 schema and the first-login provisioning flow.
6. **Whether a 입주사 can hold multiple concurrent contracts** — affects contract/tenant table cardinality; must be settled before the `s030_contract` schema is finalized in Phase 0.
7. **The three 사업자/개인 policy decisions from `HANDOVER_T7_ErpApplyForm.md`** — lower urgency than 1–6 (the online application form itself stays out of scope), but `contract_type` validation rules in Phase 7 touch the same underlying business/individual distinction, so a partial answer is needed before Phase 7, even if the full form-field policy isn't resolved until later.

## Sources

### Primary (HIGH confidence)
- npm registry live version lookups (Next.js, Fastify, TypeScript, jose, Drizzle, Zod, etc.)
- nextjs.org/blog/next-16, nextjs.org/docs — Next 16 async-API changes, CVE-2025-29927 middleware bypass
- github.com/panva/jose — verification API shape
- Supabase official docs (Supavisor pooling modes, service_role/RLS bypass, Drizzle+Supabase CLI migration workflow)
- PostgreSQL docs — range types / exclusion constraints
- RFC 6265, 7662, 8693, 8725 (cookie domain matching, token introspection, token exchange, JWT best practices)
- OfficeRnD Flex Help Center, Nexudus Help Center, Cobot Help Center — official product docs for contract/booking/occupancy feature sets
- OWASP JSON Web Token Cheat Sheet

### Secondary (MEDIUM confidence)
- Supabase/Supavisor GitHub discussions on `SET LOCAL`/transaction-mode pooling behavior
- Community coverage of TypeScript 7.0 GA and `typescript-eslint` compatibility gaps
- Korean legal/tax explainer sources (easylaw.go.kr, lawtalk.co.kr, modusign.co.kr) on 전대차/이용계약, 원상복구, 관리비 VAT
- Comparison roundups (archieapp.co, coworks.com) for Optix/Cobot/andcards feature summaries
- Spring Boot/jjwt community pattern for HS256-by-default internal auth services (used only to estimate likelihood, not as a confirmed fact about 삐용)

### Tertiary (LOW confidence, needs validation)
- Whether 삐용 issues HS256 or RS256 tokens — unverified, top blocking unknown
- Exact 삐용 claim names/TTL/refresh semantics — unverified
- Korean coworking-operator-specific internal tooling practice (스파크플러스/패스트파이브 internal ops) — inferred from public-facing tenant docs and legal/tax secondary sources, not operator product docs

---
*Research completed: 2026-09-01*
*Ready for roadmap: yes*
