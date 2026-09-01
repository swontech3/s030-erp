# Architecture Research

**Domain:** Multi-tenant coworking-space operations ERP with externally-issued identity (federated auth)
**Researched:** 2026-09-01
**Confidence:** MEDIUM-HIGH (patterns are well-established industry practice; specifics of the external 삐용 system — signing algorithm, whether it can expose a JWKS/introspection endpoint, exact `token010` semantics — are unverified because that system's docs/API were not available to this research. Flagged inline wherever this matters.)

---

## Standard Architecture

### System Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│ BROWSER (erp.swonbiz.com)                                              │
│  - Holds ONE cookie: ERP-local session (httpOnly, Secure, SameSite=Lax)│
│  - NEVER holds a 삐용 token, NEVER calls bbiyong.s-wontech.co.kr        │
└───────────────┬──────────────────────────────────────────────────────┬─┘
                │ same-origin fetch/RSC                                 │
                ▼                                                       │
┌────────────────────────────────────────────────────────────────────┐ │
│ NEXT.JS (erp.swonbiz.com) — App Router                              │ │
│  ┌───────────────┐  ┌────────────────────┐  ┌─────────────────────┐│ │
│  │ Middleware     │  │ Route Handlers      │  │ Server Components   ││ │
│  │ (edge, jose)   │  │ /api/auth/login      │  │ fetch Fastify with  ││ │
│  │ cheap gate:    │  │ /api/auth/refresh    │  │ forwarded cookie    ││ │
│  │ session cookie │  │ (server-to-server    │  │                     ││ │
│  │ present+valid? │  │  calls only)         │  │                     ││ │
│  └───────────────┘  └──────────┬───────────┘  └──────────┬──────────┘│ │
└─────────────────────────────────┼─────────────────────────┼──────────┘ │
                                   │ internal (rewrite / same-domain)     │
                                   ▼                                     │
┌──────────────────────────────────────────────────────────────────────┐│
│ FASTIFY API (api.swonbiz.com or internal, never called from browser  ││
│ across the s-wontech.co.kr boundary)                                 ││
│  ┌────────────┐ ┌───────────────┐ ┌────────────┐ ┌─────────────────┐││
│  │ auth plugin │ │ session store  │ │ tenant     │ │ domain services │││
│  │ verify local│ │ (s030_session) │ │ resolver   │ │ facility/tenants│││
│  │ JWT, attach │ │ + external     │ │ (memberId  │ │ /contracts/     │││
│  │ req.identity│ │ refresh token  │ │  +org →    │ │ bookings        │││
│  └─────┬───────┘ └───────┬────────┘ │  tenant/   │ └────────┬────────┘││
│        │                 │          │  role)     │          │         ││
│        └─────────────────┴──────────┴─────┬──────┴──────────┘         ││
└──────────────────────────────────────────┬─┴────────────────────────┘│
                                            │ server-to-server (Auth hdr) │
                                            │ ONLY on login / refresh     │
                                            ▼                             │
                          ┌─────────────────────────────────────┐        │
                          │ 삐용 (bbiyong.s-wontech.co.kr)        │        │
                          │ Spring Boot, s020_*, token010 sessions│       │
                          │ NOT modified by this project           │      │
                          └─────────────────────────────────────┘        │
                                                                          │
                                            ▼                             │
                          ┌─────────────────────────────────────┐        │
                          │ PostgreSQL (Supabase, via Supavisor  │◄───────┘
                          │ transaction pooler), s030_* tables    │
                          │ app-layer tenant scoping + RLS backstop│
                          └─────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|-------------------------|
| Next.js Middleware | Cheap, non-authoritative route gate (is there a structurally valid local session cookie? which route group?) | Edge runtime, `jose` for signature check, reads `role`/`screen group` claims already embedded in the local JWT — no network/DB call |
| Next.js Route Handlers (`app/api/auth/*`) | The ONLY code that talks to 삐용. Login exchange, refresh, logout. Sets/clears the ERP-local httpOnly cookie | Node runtime (not edge), server-to-server `fetch` to bbiyong with `Authorization` header, never exposes 삐용 token to browser |
| Next.js Server Components | Authenticated data reads for SSR | Forward the local session cookie manually to Fastify (`cookies()` → `Cookie` header on server `fetch`) |
| Fastify `auth` plugin | Verifies the **local** session JWT (ERP mints and owns this — HS256 with an ERP-only secret is fine here, no external trust boundary), decorates `request.identity = {memberId, tenantId, role, orgId}` | `@fastify/jwt` or manual `jose` verify + `onRequest` hook |
| Fastify session/token store (`s030_session`) | Server-side record linking local session → 삐용 refresh token, expiry, revocation flag | Postgres table, or Redis if session volume/latency demands it |
| Fastify tenant resolver | Maps external `memberId` + external `org_id` (chosen at 삐용's 2-step login) → local `tenant_id` + `role` | `s030_org_member` mapping table, queried once per login/refresh, cached in the local session JWT claims for the session's lifetime |
| Fastify domain services | Business logic: facility, tenants, contracts, bookings, occupancy — all tenant-scoped | Repository pattern; every query takes `tenantId` from `request.identity`, never from client input |
| Postgres RLS policies | Defense-in-depth backstop against a forgotten `WHERE tenant_id = ...` | Policies keyed on `current_setting('app.tenant_id', true)`, set via `SET LOCAL` inside the same transaction as the query |
| 삐용 (external, untouched) | Identity, credentials, 2-step org-selection login, JWT issuance, `token010` session/refresh state | Spring Boot — read-only dependency from ERP's perspective |

---

## Q1 — Federated Identity: which trust pattern fits?

**Recommendation: Token exchange at the login boundary (RFC 8693-flavored), not per-request local verification and not per-request introspection.**

| Pattern | Latency per request | Revocation | Blast radius of leaked secret | Coupling to 삐용 |
|---|---|---|---|---|
| (a) Local signature verification of 삐용's JWT on every request | Lowest (no network) | Only at token TTL expiry — a logged-out/revoked `token010` session still "works" until the JWT naturally expires | If it's HS256 with a shared secret, a leak lets an attacker **forge** tokens for *both* systems. If RS256/JWKS, a leak only exposes the *public* key — no forgery risk, only DoS if you can't fetch it | Every Fastify deploy must know 삐용's signing key/algorithm and any rotation |
| (b) Introspection every request (RFC 7662-style call to 삐용, or checking `token010` directly) | Highest — adds a network hop (or query into 삐용's own DB, which you don't own) to every single API call | Immediate/authoritative | None (no secret to leak; 삐용 stays sole authority) | Tightest coupling — ERP availability now depends on 삐용 being up for *every* request, and on 삐용 exposing an endpoint it doesn't currently have |
| (b') Introspection with cache | Amortized low, but adds staleness window equal to cache TTL | Bounded by cache TTL | None | Still requires 삐용 to expose an introspection-shaped endpoint that doesn't exist today |
| **(c) Token exchange: swap 삐용's JWT for a locally-issued session token at login (recommended)** | Low on steady-state requests (local JWT verify only); one 삐용 call at login and at refresh time | Bounded by ERP's own session TTL + explicit check against 삐용's refresh endpoint at refresh time (revocation surfaces the next time a refresh is attempted, not instantly — see caveat below) | A leaked ERP session secret only compromises ERP, never 삐용 (secrets are fully decoupled) | Loosest coupling — 삐용 is only called at two well-defined moments (login, refresh), not on the hot path |

**Why (c) fits this project specifically:**
- 삐용 cannot be modified — it has no introspection endpoint (RFC 7662) or JWKS today, so pattern (b)/(b') require asking the 삐용 team to build something new. Pattern (c) requires nothing new from 삐용 beyond its existing login/refresh endpoints.
- 삐용 already has a session table (`token010`) that is the source of truth for revocation. ERP should not try to duplicate that authority by trusting a long-lived locally-cached copy of the 삐용 JWT forever. Instead, ERP treats the 삐용 refresh token as a capability it holds server-side, and re-asserts it periodically (at ERP's own session refresh cadence). A revoked/logged-out `token010` row will cause the next refresh call to fail, at which point ERP kills the local session. This is the same trade-off OAuth2 Authorization Code + refresh-token clients accept: revocation is "eventually consistent," bounded by refresh interval, not instant — but it is dramatically better than doing nothing until natural JWT expiry, and requires zero changes to 삐용.
- Decoupling secrets matters here because ERP and 삐용 are operated as separate systems with separate deploy cycles. A shared HS256 secret would mean every ERP secret rotation is a cross-team coordination event; token exchange means ERP's signing key is entirely its own.
- This pattern also **directly solves Q5's cross-domain cookie problem** (see below) — since the 삐용 JWT never needs to reach the browser at all, cross-domain cookie sharing is a non-issue by construction.

**Open item requiring verification (LOW confidence — could not confirm with 삐용's actual docs):** confirm whether 삐용's JWTs are HS256 (shared secret) or RS256 (public key). This changes only *how* ERP verifies the 삐용 JWT during the login-exchange call — it does not change the recommended architecture. Regardless of algorithm, **pin the expected algorithm explicitly in verification code** (do not read `alg` from the token header and trust it) — this is the standard mitigation for the "alg confusion" class of JWT vulnerabilities described in RFC 8725 (JSON Web Token Best Current Practices).

---

## Q2 — Authorization layered on external identity

**Recommendation: a single ERP-owned mapping table is the join between "who they are" (삐용) and "what they can do here" (ERP).**

```
s030_org_member
  member_id      -- external, from 삐용 JWT (their principal)
  external_org_id-- external, the org the member selected at 삐용's 2-step login
  tenant_id      -- FK to s030_tenant (ERP's own 입주사 entity) — NULL for operator staff
  role           -- 'operator' | 'tenant' (ERP's own concept, 삐용 has no notion of this)
  status         -- active/inactive (ERP-side deactivation without touching 삐용)
```

- **Multiple orgs per member:** 삐용's 2-step login already forces the user to pick one org per login session (verify account → choose organization). ERP does not need to re-solve "which org is active" — it inherits the answer from that selection. The chosen `external_org_id` is captured during the token-exchange step (Q1) and resolved once against `s030_org_member` to get `tenant_id` + `role`.
- **Where the selection travels:** resolved `tenant_id` + `role` are baked as claims into the ERP-local session JWT at exchange time. Every subsequent request within that session carries them for free — no per-request DB lookup needed for the common case. If the member needs a different org, that requires a fresh 삐용 login (their 2-step flow), which naturally re-triggers ERP's exchange step and re-resolves the mapping. This means **ERP does not need an in-app "switch organization" UI** — it's provided by 삐용's own login flow, matching the milestone's "재로그인으로 조직 전환" implicit assumption.
- **Table ownership:** `s030_org_member` lives entirely in ERP's schema (`s030_*`), keyed by 삐용's external `member_id`/`external_org_id` as opaque foreign strings (not FKs into `s020_*`, since ERP must not assume it can join across schemas owned by a different service/team, even if they're in the same Postgres instance). Treat them as external identifiers, indexed but not referentially constrained into `s020_*`.
- **First-login provisioning:** decide whether `s030_org_member` rows are pre-provisioned by an ERP admin (invite-based, matches the existing `(auth)/invite/[token]` route already in the structure doc) or auto-created on first successful 삐용 login for a known org. Given the milestone explicitly excludes "멤버 관리" (member management) from phase 1, the pragmatic default is: pre-seed operator staff manually, and auto-link 입주사 members to their tenant on first login using the `external_org_id` returned by 삐용 (assuming 삐용's org id can be matched to an ERP tenant's own external-org reference at contract-creation time). This must be confirmed as a schema decision before contract/tenant schema work (see build order).

---

## Q3 — Multi-tenant isolation in Postgres behind Supavisor (transaction mode)

**Recommendation: application-layer scoping as the primary control, Postgres RLS as a backstop — not schema-per-tenant.**

- **Schema-per-tenant: rejected.** It multiplies migrations by tenant count, breaks the operator's "see across all tenants" dashboard/occupancy views (which need cross-tenant aggregation as a first-class use case, not an exception), and adds operational overhead disproportionate to a coworking-space ERP's tenant count (tens to low hundreds of 입주사, not thousands of isolated deployments).
- **Application-layer scoping (primary):** every repository/query function in Fastify takes `tenantId` from `request.identity` (derived from the verified local session — never from a client-supplied header/body field) and applies it as a mandatory filter. This is enforced structurally by never exposing a "raw" query escape hatch from the data-access layer for tenant-scoped tables — the standard safeguard against "forgot the WHERE clause" is *not* code review discipline alone, it's **making the unscoped query impossible to write** (e.g., a query builder/repository base class that requires a `tenantId` argument for every read on tenant-scoped tables, and a lint rule or code-review checklist item flagging any raw SQL/query on those tables that skips it).
- **RLS as backstop, with the Supavisor caveat that actually matters:** Supabase's Supavisor pooler in **transaction mode** multiplexes many logical client connections over few physical Postgres connections, and a physical connection is only bound to one client for the duration of a single transaction (`BEGIN` … `COMMIT`/`ROLLBACK`) — it is returned to the pool immediately after. This means:
  - `SET LOCAL app.tenant_id = '...'` is **safe** under transaction-mode pooling *if and only if* it is set inside the same explicit transaction as the query it's meant to scope, and that transaction is short-lived (open it, set the GUC, run the queries, commit — don't hold it open across a user "think time").
  - Plain `SET` (session-level, not `SET LOCAL`) is **unsafe** and must never be used — because the pooler can hand that same physical connection to a completely different tenant's request on the very next transaction, silently leaking the previous tenant's `app.tenant_id` (or worse, an elevated role) onto someone else's queries. This is the single most important gotcha for this stack.
  - RLS policies should be written to **fail closed**: if `current_setting('app.tenant_id', true)` is NULL/unset, the policy should match zero rows, not all rows. This turns "someone forgot to set the GUC" into "empty result set" instead of "cross-tenant data leak."
- **Net effect:** app-layer filtering catches almost everything and is what you build/test against day to day; RLS with the `SET LOCAL`-inside-explicit-transaction pattern is the safety net specifically for the "someone shipped a repository method without the tenant filter" failure mode, which is exactly the kind of mistake that survives code review under deadline pressure. Both together, neither alone.

---

## Q4 — Next.js App Router + separate Fastify: where's the boundary?

**Recommendation: browser only ever talks to `erp.swonbiz.com`. Fastify sits behind that same origin (via Next.js rewrites, or a subdomain sharing the `swonbiz.com` cookie domain) for ordinary data calls; Next.js Route Handlers are the *exclusive* gateway for anything that touches 삐용.**

- **Token storage:** httpOnly, Secure, `SameSite=Lax` cookie scoped to `swonbiz.com` (host-only or `Domain=.swonbiz.com` if Fastify lives on a subdomain like `api.swonbiz.com`), holding the **ERP-local** session token — never the raw 삐용 JWT. Memory/Authorization-header storage in the browser is unnecessary here and reintroduces XSS-exfiltration risk that httpOnly cookies specifically avoid; there's no cross-origin-to-a-third-party-API need on the browser side once token exchange is in place (see Q1/Q5).
- **Middleware (cheap check, not authoritative):** Next.js middleware runs on the Edge runtime, which cannot use Node-only crypto or hit Postgres. Use `jose` (Edge-compatible, Web Crypto based) to verify the *local* JWT's signature and read its embedded `role`/tenant claims for route-group gating (redirect unauthenticated → `/login`, redirect 입주사 away from `role:'operator'` screens per the existing `lib/screens.ts` mapping). This is fast because it's a pure signature check with no network call.
  - **Do not treat middleware as the security boundary.** Next.js had a real, critical vulnerability (CVE-2025-29927, CVSS 9.1, disclosed March 2025, fixed in 14.2.25 / 15.2.3) where a crafted `x-middleware-subrequest` header let requests skip middleware entirely and reach protected routes/route handlers directly. Two mitigations, both required: (1) pin Next.js to a patched version and keep it current, and (2) **Fastify must independently re-verify the local session token and re-derive `tenantId`/`role` on every request**, never trusting a header or claim forwarded by Next.js as pre-authorized. Middleware is a UX optimization (fast redirect), not the authorization enforcement point.
- **Server Components fetching authenticated data:** Server Components run on the Next.js server, not the browser, so they don't automatically carry the browser's cookies. Read the incoming request's cookie via `cookies()` and forward it explicitly as a `Cookie` header (or translate it into whatever header Fastify expects) on the server-side `fetch` call to Fastify.
- **Token refresh without a thundering herd:** refresh must happen server-side (in the Route Handler/Fastify, never client-driven per-tab), guarded by a single-flight lock keyed on the session id — e.g., an in-memory promise map on the Fastify instance ("if a refresh for session X is already in flight, await that promise instead of starting a second one") plus, if Fastify runs multiple instances, a short-lived advisory lock or a `SELECT ... FOR UPDATE` on the `s030_session` row so concurrent requests across instances serialize on the refresh rather than racing 삐용's refresh endpoint simultaneously (many refresh-token implementations invalidate the old refresh token on use, so a race produces spurious logouts if not guarded).

---

## Q5 — Cross-domain: swonbiz.com vs s-wontech.co.kr

**These are different registrable domains (different eTLD+1) — `swonbiz.com` and `s-wontech.co.kr` share no suffix relationship at all (not even a shared second-level structure), so no cookie `Domain` attribute can ever make a cookie set by one visible to the other.** This is a hard browser platform limit (RFC 6265 cookie domain matching + the Public Suffix List), not a configuration choice — there is no CORS or SameSite setting that changes this fact.

**Standard solution shape:** never let the browser be a party to the swonbiz.com ↔ s-wontech.co.kr relationship at all.
- All calls to 삐용 (login, refresh) are **server-to-server**: Next.js Route Handler or Fastify (both are Node processes, not browsers) call `bbiyong.s-wontech.co.kr` directly with the 삐용 JWT in an `Authorization: Bearer` header. Server-to-server HTTP calls are not subject to CORS at all — CORS is a browser-enforced restriction on `fetch`/`XHR` from a page's JavaScript; it does not apply to server code making outbound requests. This is why the token-exchange architecture (Q1) and the "browser only talks to erp.swonbiz.com" architecture (Q4) aren't just about security — they're what makes the cross-domain problem disappear rather than needing to be solved.
- If the browser ever did call `bbiyong.s-wontech.co.kr` directly (not recommended, and not needed under this architecture), it would require: 삐용 to add CORS headers for `https://erp.swonbiz.com` (a change to a system this project cannot modify), `credentials: 'include'` on the fetch, and would still hit the hard wall that any cookie 삐용 sets on its own domain is invisible to and unusable by `erp.swonbiz.com` JavaScript regardless of CORS — CORS controls whether a response body is readable, it does not grant cookie access across registrable domains. So this path is a dead end even if 삐용 cooperated, and is not recommended as an option.

---

## Q6 — Component boundaries and build order

Confirms and slightly refines the 9-step order already decided in `doc/SWONBIZ_PROJECT_STRUCTURE.md`.

```
1. Scaffolding + tokens.css           — zero backend dependency, build first
2. components/ds (15 components)      — pure UI, buildable against static/mock data
3. lib/auth (삐용 integration) + middleware
   └─ REQUIRES: a decision on token exchange shape (Q1), the s030_org_member
      mapping table shape (Q2), and — since real 삐용 test credentials/environment
      may be scarce — a mock 삐용 login/refresh endpoint so steps 4-9 aren't
      blocked on 삐용 environment availability
4. (auth) screens (login, etc.)       — depends on 3, can use the mock
5. (erp) shell (layout, sidebar)      — depends on 3/4 for role-based nav, NOT on
                                          tenant/contract schema — build against
                                          a stubbed identity object
6. Master data (facility/buildings/floors/rooms)
   └─ Good candidate to validate the full plumbing end-to-end (auth → tenant
      claim → Fastify → RLS) because it's operator-only, no tenant-visibility
      rules to get right yet — lower risk place to shake out the session/tenant
      wiring than jumping straight to tenant-scoped data
7. Tenants + contracts (master-detail, then the heavy contract form)
   └─ REQUIRES SETTLED BEFORE SCHEMA WORK: (a) s030_org_member shape from Q2,
      (b) whether a 입주사 can hold multiple concurrent contracts (open question
      already flagged in the project structure doc), (c) whether contract line
      items are homogeneous (rooms only) or need a type discriminator — this is
      a schema decision, not an app-code decision, and changing it later means
      a migration touching the contract's core tables
8. Bookings
   └─ REQUIRES SETTLED BEFORE SCHEMA WORK: the double-booking prevention
      strategy (Q7) — the EXCLUDE constraint + btree_gist extension + timestamptz
      columns must be decided when the room/booking tables are first created,
      not retrofitted after data exists with ad-hoc overlaps already in it
9. Occupancy views + dashboard         — read-only aggregation over 6-8, build last
```

**What can be built against a stub:** the design system (2), the shell (5), and any screen's static layout can be built before the real Fastify/Postgres layer exists, using a mocked identity/session object shaped exactly like the real one. This lets frontend (design-system-heavy) work proceed in parallel with backend schema/auth work, provided the *shape* of the identity/session object (memberId, tenantId, role, orgId) is frozen early — which is why Q1/Q2's decisions need to land before step 3, even though their full implementation can lag.

**What must be settled before schema work (not deferrable to "later"):** the external-identity mapping table shape (Q2), the tenant-scoping mechanism — app-layer + RLS with `SET LOCAL` (Q3), and the booking overlap-prevention primitive (Q7). All three change table shapes/constraints, not just application code, so getting them wrong means a migration + data-fix later rather than a code change.

---

## Q7 — Booking-domain: preventing double-booking

**Recommendation: a Postgres `EXCLUDE` constraint using `btree_gist` over `(room_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)`, scoped to non-cancelled rows via a partial constraint predicate — with an application-level pre-check purely for UX (fast, friendly error before the round trip), not as the source of truth.**

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE s030_booking (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     uuid NOT NULL REFERENCES s030_room(id),
  tenant_id   uuid NOT NULL REFERENCES s030_tenant(id),
  start_at    timestamptz NOT NULL,
  end_at      timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'confirmed', -- 'confirmed' | 'cancelled'
  CONSTRAINT no_overlap EXCLUDE USING gist (
    room_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (status <> 'cancelled')
);
```

**Why this over the alternatives:**

| Approach | Verdict | Reason |
|---|---|---|
| Application check-then-insert ("query for overlaps, then insert if none") | Reject as sole guard | Classic time-of-check/time-of-use race — two concurrent requests can both pass the check before either commits. Fine as a UX pre-check, unsafe as the only guard |
| Advisory locks (`pg_advisory_xact_lock` on room_id) | Workable but weaker | Correct only if *every* code path that writes bookings remembers to take the lock; it's a convention, not a constraint the schema enforces — a future migration/script/admin tool that forgets the lock silently reintroduces the race. Also serializes all writes to a room even when ranges don't actually overlap |
| `SERIALIZABLE` transactions | Workable but heavier than needed | Correct, but requires the whole booking-write transaction to run at `SERIALIZABLE` isolation and the application to catch and retry serialization failures (`40001`) — reasonable for high-contention systems, but adds retry-loop complexity disproportionate to a single-building meeting-room booking system |
| **`EXCLUDE` constraint (recommended)** | Standard, recommended | Enforced by Postgres itself regardless of which code path inserts a row (app, script, admin backfill) — the database is the single source of truth and cannot be bypassed by an app-layer bug. The tradeoff is a Postgres-specific extension (`btree_gist`, bundled with Postgres/Supabase, no separate install) and a slightly less common SQL construct the team needs to understand |

**Pitfalls to design around:**
- **Timezone:** store `start_at`/`end_at` as `timestamptz` (UTC internally); convert to KST only at the display layer. Storing naive local time is the single most common cause of subtle overlap bugs when DST or client-timezone bugs creep in (Korea doesn't observe DST currently, but client-side `Date` handling bugs are still the most common source of off-by-one-hour errors — don't rely on the client to compute the range boundaries in UTC correctly; do it server-side).
- **Half-open intervals:** use `'[)'` (inclusive start, exclusive end) so a booking ending at 10:30 and one starting at 10:30 are correctly treated as non-overlapping adjacent bookings, not a conflict. This matches how humans read a room schedule and is Postgres's own convention for range types (`tstzrange` defaults to `'[)'` if unspecified, but be explicit).
- **Cancelled rows:** without the `WHERE (status <> 'cancelled')` predicate, cancelling a booking and rebooking the same slot would still be blocked by the old (cancelled) row's ghost presence in the constraint. Use a partial exclusion constraint (Postgres supports a `WHERE` predicate on `EXCLUDE`, same as partial indexes) so cancelled bookings don't occupy the slot. Alternative: physically delete cancelled bookings instead of soft-deleting — rejected here because the milestone likely wants an audit trail of cancellations, so soft-delete + partial constraint is preferred over hard delete.
- **Error surfacing:** a constraint violation raises Postgres error code `23P01` (`exclusion_violation`) — catch this specifically in the Fastify service layer and translate it into a friendly "이미 예약된 시간입니다" (already booked) response, rather than a generic 500.
- **Cross-tenant masking (from PROJECT.md's explicit constraint):** the requirement that other tenants see a booking as "예약됨" only (title/org/attendee masked) is a **read-path, server-side concern** — the Fastify query that serves the shared weekly/monthly booking view must redact those fields for rows not belonging to `request.identity.tenantId` *before* the response leaves the server. This must not be implemented as "send full data, hide it in the UI" — that leaks the masked fields in the network response regardless of what the UI renders.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Browser holds and forwards the 삐용 JWT
**What people do:** store the external system's JWT in `localStorage` or a JS-readable cookie and have the browser attach it directly to calls (to Fastify, or worse, directly to 삐용).
**Why it's wrong:** exposes the external system's token to XSS, and directly collides with the cross-domain cookie limit (Q5) — it cannot even work for calls to `bbiyong.s-wontech.co.kr` from `erp.swonbiz.com` once any cookie-based session is involved on the 삐용 side, and it's an unnecessary XSS blast-radius increase even for calls to your own Fastify.
**Instead:** token exchange (Q1) — browser only ever holds ERP's own httpOnly session cookie.

### Anti-Pattern 2: Relying on Next.js middleware as the authorization boundary
**What people do:** put all role/tenant checks in middleware and assume routes are protected.
**Why it's wrong:** demonstrated exploitable in production (CVE-2025-29927); also architecturally means Fastify (which may be called from places other than this Next.js app — kiosk, future mobile client, etc.) has no independent protection.
**Instead:** middleware for cheap UX redirects only; Fastify independently re-verifies identity/role/tenant on every request.

### Anti-Pattern 3: `SET` instead of `SET LOCAL` for RLS tenant context under a transaction-mode pooler
**What people do:** set the tenant GUC once "per connection" assuming a connection = a user, following Postgres tutorials written before connection poolers were common.
**Why it's wrong:** under Supavisor transaction mode, a physical connection is shared across unrelated requests/tenants between transactions — a session-level `SET` leaks tenant context to the next, unrelated request that happens to land on the same physical connection.
**Instead:** `SET LOCAL` inside the same explicit transaction as the scoped query, every time, with fail-closed RLS policies.

### Anti-Pattern 4: Schema-per-tenant "for isolation"
**What people do:** reach for schema-per-tenant reflexively whenever "multi-tenant" appears in requirements.
**Why it's wrong:** here it actively works against the operator's cross-tenant dashboard/occupancy requirements, and multiplies migration and connection-pooling overhead for a tenant count that doesn't justify it.
**Instead:** shared schema, app-layer scoping + RLS backstop.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| 삐용 (bbiyong.s-wontech.co.kr) | Server-to-server only (Route Handler/Fastify → 삐용 login/refresh endpoints, `Authorization: Bearer` header) | No CORS involved since no browser call; algorithm/JWKS details unverified — confirm before implementing verification code; treat `token010`-driven revocation as eventually-consistent (bounded by ERP's own refresh cadence) |
| Supabase Postgres (via Supavisor, transaction mode) | Fastify uses a Postgres client/ORM that supports explicit transactions with `SET LOCAL` (e.g., raw `pg` transactions, or an ORM that exposes a transaction callback) | Avoid ORMs/patterns that implicitly use session-level `SET` or that pool at the ORM layer in a way that fights Supavisor's transaction-mode connection reuse |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Browser ↔ Next.js | Same-origin fetch, cookies auto-attached | Only `erp.swonbiz.com` is ever contacted from client JS |
| Next.js Route Handlers ↔ 삐용 | Server-to-server HTTPS, `Authorization` header | Confined to `/api/auth/*` — no other Next.js code should call 삐용 |
| Next.js ↔ Fastify | Same-origin (via `next.config` rewrites) or shared-cookie subdomain | Cookie forwarded explicitly in Server Components; browser can also call Fastify directly for client-side data fetching (SWR/React Query) since it's same-origin/same-cookie-domain |
| Fastify ↔ Postgres | Explicit transactions per tenant-scoped request, `SET LOCAL app.tenant_id` | Repository layer is the only code path allowed to open these transactions |

---

## Sources

- RFC 7662 — OAuth 2.0 Token Introspection: https://www.rfc-editor.org/rfc/rfc7662
- RFC 8693 — OAuth 2.0 Token Exchange: https://www.rfc-editor.org/rfc/rfc8693
- RFC 8725 — JSON Web Token Best Current Practices (algorithm confusion, key confusion): https://www.rfc-editor.org/rfc/rfc8725
- RFC 6265 — HTTP State Management Mechanism (cookie domain matching): https://www.rfc-editor.org/rfc/rfc6265
- PostgreSQL docs — Range Types / Exclusion Constraints: https://www.postgresql.org/docs/current/rangetypes.html
- Supabase / Supavisor connection pooling discussion (transaction-mode `SET LOCAL` semantics): https://github.com/orgs/supabase/discussions/47946 and https://github.com/orgs/supabase/discussions/27388 — MEDIUM confidence (community/GitHub discussion, not a formal doc page, but consistent with Postgres's own documented transaction-scoping of `SET LOCAL`)
- CVE-2025-29927 (Next.js middleware authorization bypass): https://www.fastly.com/blog/cve-2025-29927-authorization-bypass-in-next-js and https://www.picussecurity.com/resource/blog/cve-2025-29927-nextjs-middleware-bypass-vulnerability — HIGH confidence, multiple independent security vendors corroborate, matches Next.js's own advisory
- `jose` library (Edge-runtime-compatible JWT verification for Next.js middleware) — referenced in multiple current Next.js auth guides (MEDIUM confidence, community sources, consistent with Next.js's documented Edge runtime constraints on Node.js APIs)
- Project-internal: `.planning/PROJECT.md`, `doc/SWONBIZ_PROJECT_STRUCTURE.md` — the fixed constraints and existing decided directory structure this research builds on

---
*Architecture research for: SwonBiz ERP — multi-tenant coworking-space operations system with externally-issued (삐용) identity*
*Researched: 2026-09-01*
