# Stack Research

**Domain:** Korean coworking-space (공유오피스) operations ERP — Next.js App Router frontend + separate Fastify backend + Supabase-hosted PostgreSQL, external JWT auth issued by a Spring Boot service ("삐용")
**Researched:** 2026-09-01
**Confidence:** MEDIUM-HIGH (package versions verified live against npm registry and official docs; the exact JWT algorithm used by 삐용 is unverified — see Open Question below)

> Scope note: Next.js, Fastify, and Supabase/Postgres are fixed constraints (see PROJECT.md). This file only recommends what goes *around* that fixed core.

---

## Recommended Stack

### Core Technologies (fixed, versions to target)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Next.js | **16.3.x** (App Router) | Frontend | Next 16 GA shipped Oct 21, 2025; 16.3.x is the current npm `latest` as of Sep 2026. Async `cookies()`/`headers()`/`draftMode()` are now the *only* form (sync access fully removed in v16, unlike v15 which still shimmed it) — write all server code async-first. Confidence: HIGH (verified via nextjs.org/blog/next-16 and npm registry). |
| React | 19.2.x | UI runtime | Required peer for Next 16. Confidence: HIGH. |
| Fastify | **5.12.x** | Backend API service | v5 is the current major (v4 is in maintenance-only mode). ~5-10% faster routing, better HTTP/2, but ~20 breaking changes from v4 (mostly plugin API and TypeScript generics) — irrelevant for a greenfield project, just don't copy v4-era Fastify tutorials verbatim. Confidence: HIGH. |
| PostgreSQL (Supabase-hosted) | 17.x (Supabase default) | Database | Fixed by constraint. Treat it as "Postgres behind Supavisor," not "Supabase the auth/RLS platform" — see Supabase section below. |
| TypeScript | **5.9.3** (NOT the `latest` npm tag) | Type system | **Important gotcha:** `npm install typescript` currently installs **7.0.2**, a from-scratch Go-native rewrite ("tsgo") that went GA July 8, 2026. It is a different compiler/binary, not a patch release. As of this research date, `typescript-eslint` has explicitly *not* committed to day-one TS7 support and ESLint's own TS-aware tooling is blocked on it; TS 7.1 (the version expected to restore ecosystem compatibility) isn't due until ~Oct 2026. **Pin `typescript@5.9.3` explicitly** in package.json rather than trusting `^` or `latest`. Confidence: HIGH (verified via npm dist-tags + Microsoft's own TS7 GA announcement coverage) — revisit this pin once typescript-eslint ships confirmed TS7 support. |

### Fastify Ecosystem (Question 1)

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `@fastify/cors` | 11.3.0 | Cross-domain CORS (erp.swonbiz.com ↔ Fastify API host, plus bbiyong domain if ever called directly) | Standard, maintained by the Fastify org. Only needed if the browser ever calls Fastify directly (e.g. the public kiosk display, or SSE/websocket endpoints). If Next.js server-side code is the *only* caller of Fastify (recommended BFF pattern, see Q4), CORS can be locked down to a single allowed origin or disabled entirely for most routes. |
| `zod` + `fastify-type-provider-zod` | zod 4.5.x, provider **7.0.0** | Request/response schema validation with TS inference | See "TypeBox vs Zod" decision below. Note the version coupling: `fastify-type-provider-zod` ≥7.x requires **zod ≥4.2** (it uses zod's `.encode()`/`.decode()` APIs added in 4.2 and serializes on `z.output`). Do not mix provider v7 with zod v3. |
| `jose` | **6.2.x** | Verifying the externally-issued 삐용 JWT | See dedicated JWT section (Q2). Do **not** use `@fastify/jwt` or `jsonwebtoken` for this — see "What NOT to Use." |
| `postgres` (postgres.js) as driver + **Drizzle ORM** | postgres.js 3.4.9, drizzle-orm **0.45.x**, drizzle-kit **0.31.x** | Postgres access / query building | See dedicated Supabase section (Q3) for driver choice and migration workflow. |
| `@fastify/swagger` + `@fastify/swagger-ui` | 9.8.1 / 6.1.1 | OpenAPI doc generation | Fastify's schema-first routing (whether TypeBox or Zod-via-provider) feeds this for free — no separate annotation layer needed. Useful given multiple screens will hit the same handful of resource APIs (contracts, bookings, tenants); a browsable spec pays for itself once >~15 routes exist. |
| `@fastify/rate-limit` | 11.2.0 | Abuse/DoS protection | Apply per-route, tighter on `/auth/*`-adjacent verification paths and the kiosk/public routes (unauthenticated, internet-facing). |
| `pino` (built into Fastify) + `pino-pretty` (dev only) | pino 10.3.x bundled with Fastify 5; pino-pretty 13.1.x as devDependency | Structured logging | Fastify ships pino as its default logger — don't add a second logging library. Use `pino-pretty` only in the dev transport; in production emit raw JSON lines for log aggregation. Include `screenId`-style context (matching `lib/screens.ts` IDs) in child loggers for cross-referencing with frontend error reports, per the project's own screen-ID convention. |
| `@fastify/env` or manual `zod`-parsed env | 7.0.0 (fastify/env) | Env var validation at boot | Given the JWT secret/public key and DB connection string are both `.env`-only per the project's security constraint, fail fast on boot if any are missing/malformed rather than discovering it on first request. A hand-rolled `zod` schema for `process.env` parsed once at startup is equally valid and keeps validation logic in one library (zod) instead of two. |
| `@fastify/sensible` | 6.0.5 | HTTP error helpers (`reply.notFound()` etc.) | Small quality-of-life addition, optional. |

**ESM/TypeScript gotchas for Fastify 5:**
- Fastify 5 targets Node ≥20 and ships ESM-first types; if the project's `tsconfig.json` uses `"module": "commonjs"`, some plugin type inference (especially with the Zod/TypeBox type providers) degrades. Recommend `"module": "NodeNext"` / `"moduleResolution": "NodeNext"` and `"type": "module"` in the Fastify service's own `package.json` (it is a separate service from Next.js, so this doesn't affect the frontend's module settings at all).
- `fastify-type-provider-zod` needs the route registered with `.withTypeProvider<ZodTypeProvider>()` and the Fastify instance's `validatorCompiler`/`serializerCompiler` set globally — set this up once in the app factory, not per-route.

**TypeBox vs Zod decision:** Fastify's own docs favor TypeBox because it compiles straight to JSON Schema (Ajv JIT under the hood, materially faster — one benchmark cited ~22x). For a coworking-space ERP with realistic internal traffic (dozens of concurrent staff/tenant users, not a public high-QPS API), that performance gap is immaterial. Zod wins here for a different reason specific to this project: the heaviest screen (contract form, Q5) will use `react-hook-form` + `zodResolver` on the frontend. Using **Zod on both sides** lets you define one validation schema (in a small shared `packages/shared-schemas` or duplicated-but-identical file) for "a contract item row" or "a contract user row" and reuse it in both the browser form and the Fastify route — reducing the chance that frontend and backend validation drift apart on a form with 10 dynamic item rows and 20 dynamic user rows. Confidence: MEDIUM (architectural judgment call, not a hard technical requirement — TypeBox remains a perfectly valid alternative if the team prefers JSON-Schema-native tooling).

### Verifying the 삐용-issued JWT (Question 2)

**What Spring Boot / jjwt typically emits:** The dominant pattern in Spring Security + jjwt tutorials and internal-microservice setups is **HS256 with a shared secret** (`Jwts.builder().signWith(Keys.hmacShaKeyFor(secretBytes), SignatureAlgorithm.HS256)` or the newer `Jwts.SIG.HS256` builder). RS256 (asymmetric, public/private keypair) is more common when the issuer is a multi-tenant identity provider or needs third parties to verify tokens without trusting them with a secret — but 삐용 is a single company's internal login service reused by exactly one other internal app (this ERP), which is the textbook case where teams default to HS256 for simplicity. Confidence: **MEDIUM** — this is the statistically common pattern, not a confirmed fact about 삐용's actual implementation. **This is an open question that must be confirmed directly from the 삐용 codebase or team before implementation** (see Open Question below).

**What the Node verifier needs, per case:**
- **If HS256:** the raw shared secret (same bytes 삐용 uses in `Keys.hmacShaKeyFor(...)`), imported via `crypto.createSecretKey()` or `jose.importJWK()` and passed to `jose.jwtVerify(token, secretKey)`.
- **If RS256:** just the RSA **public key** (PEM/SPKI format) — the private key never leaves 삐용. Import with `jose.importSPKI(pem, 'RS256')`, then `jose.jwtVerify(token, publicKey)`. No JWKS endpoint is required for this — JWKS is a *convenience* for automatic key rotation, not a requirement for verification.

**Which Node library handles both cleanly:** `jose` v6.2.x. It has one call shape (`jwtVerify`) that works for both algorithm families depending only on which key-import function you use, is ESM/Web-Crypto-based (works in Node, and critically also in **Next.js Edge middleware** — see Q4), and is the actively-maintained modern choice. Verified against jose's own repo docs (HIGH confidence on the API shape).

**What to do if 삐용 exposes no JWKS endpoint** (the project docs mention no such endpoint — `token010` table + refresh token, nothing about JWKS): request the raw secret (HS256) or the public key/certificate (RS256) directly from the 삐용 team through a secure channel, and store it as a `.env` value on **whichever service actually needs to cryptographically verify the token**. Per the recommended architecture in Q4, that should be **Fastify only** — see below for why Next.js middleware doesn't need this secret at all. If the 삐용 team will not share the secret/key under any circumstances, the fallback is to call a 삐용-side "get current user / validate token" endpoint on every request instead of local verification — this works but adds a network hop per request and makes Fastify's availability depend on 삐용's, so it should be a last resort, not the default design.

**What NOT to use for JWT verification:**

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| `jsonwebtoken` (the classic `jsonwebtoken` npm package) | Uses Node's `crypto` module directly and has no JWKS/remote-key support built in; more importantly, **it does not run in the Edge runtime**, which is the default runtime for Next.js middleware. If middleware ever needs to verify the token itself, `jsonwebtoken` will fail there even though it works fine inside Fastify. | `jose` — Web Crypto based, runs identically in Node and Edge runtimes, so the exact same verification code can be shared/duplicated between Fastify and Next.js middleware if needed. |
| `@fastify/jwt` as the verification layer for this project | It's designed around Fastify *issuing and managing* its own JWTs (sign + verify + decorators), which doesn't match "verify a token issued by someone else's Spring Boot app." It can technically be pointed at an external secret, but you get none of its sign-side conveniences and still have to hand-write the "is this actually 삐용's token" claim checks. | A small custom Fastify `onRequest`/`preHandler` hook wrapping `jose.jwtVerify()` directly — more explicit and easier to unit test in isolation. |

### Supabase-as-plain-Postgres (Question 3)

**RLS vs application-layer tenant isolation — use application-layer isolation as the primary enforcement mechanism.** Supabase RLS is built around `auth.uid()` / `auth.jwt()`, both of which are populated by **Supabase's own Auth/GoTrue** setting a Supabase-signed JWT as the Postgres session's `request.jwt.claims` — this project's auth is entirely external (삐용/Spring Boot), so `auth.uid()` will always be `NULL` unless you specifically re-sign the 삐용 claims into a Supabase-compatible JWT (a real but nontrivial "JWT exchange" pattern some teams use). Given Fastify is the only thing that talks to Postgres (never the browser directly, never Supabase's PostgREST layer), RLS is not filling a gap that the application code doesn't already control — Fastify decides the tenant (`org_id`)-scoped query on every request based on the verified 삐용 JWT claims. Confidence: MEDIUM-HIGH (Supabase's own docs confirm RLS doesn't require Supabase Auth specifically, but also confirm it needs *some* Supabase-shaped JWT/claims to be useful, which this project doesn't have without extra plumbing).

Recommendation: **enforce tenant isolation in Fastify's query layer** (every tenant-scoped query takes `orgId` from the verified JWT, never from client input), and treat RLS as an optional *defense-in-depth* layer only if/when you decide to invest in the JWT-exchange pattern later — not a Phase 1 requirement. Document this explicitly for the schema-design phase: every `s030_*` table that is tenant-scoped needs an `org_id` (or equivalent) column and every Fastify query/repository function for it must filter by that column — this is now an application-code discipline problem, not a database-config problem.

**Connection pooling (Supavisor):** Supabase's built-in pooler (Supavisor) offers two modes:
- **Transaction mode (port 6543):** connections are handed out per-transaction, which is what makes it scale to many serverless/edge clients — but **prepared statements are not supported by default** in this mode (a client's prepared statement can't be guaranteed to still exist on whatever connection it's handed next). If you need them, Supavisor now supports *named* prepared statements in transaction mode behind a feature flag, but the simpler and more robust path is to just disable prepared statements in the driver.
- **Session mode (port 5432, or use Session pooling explicitly):** behaves like a normal long-lived connection and supports prepared statements normally, at the cost of using one pooled connection per client for its whole session.

Since Fastify is a **long-running Node service** (not a serverless/edge function spinning up per-request), it does not need transaction-mode's scaling properties as urgently as, say, a Vercel Edge Function would. Recommend: **Session mode pooling for Fastify's connection pool**, sized deliberately (e.g. `pg`/`postgres.js` pool max in the 10-20 range, tuned against Supabase's plan connection limits) since it's one persistent backend process, not thousands of ephemeral ones. If you later need transaction mode for cost/connection-limit reasons, disable prepared statements explicitly (`postgres.js`: `{ prepare: false }`; `pg`: avoid `pg`'s automatic named-statement caching, or use `node-postgres`'s `Pool` with `statement_timeout` and no prepared-statement reliance in the ORM layer).

**Migration tooling:** Use **Drizzle** for schema definition and **`drizzle-kit generate`** to produce migration SQL, but land that SQL into the **`supabase/migrations/` directory** and apply it through the **Supabase CLI** (`supabase db push` / `supabase migration up`), rather than using `drizzle-kit push` directly against production. This is Supabase's own documented integration pattern (confirmed via Supabase's official Drizzle guide), and it matters specifically for this project because the Postgres instance is **shared with `s020_*` (삐용) and future `s040_*` (법무/세무) tables** — you want one authoritative, ordered SQL migration history for the whole database (visible in Supabase Studio, diffable, reviewable), not an ORM tool assuming it owns the entire schema. Drizzle's schema file should only declare the `s030_*` tables this project owns; leave `s020_*`/`s040_*` untouched and unmodeled in Drizzle. Confidence: HIGH (Supabase's own docs describe exactly this generate→copy-into-supabase/migrations→push flow); node-pg-migrate (9.0.0) is a reasonable plain-SQL-first alternative if the team prefers hand-written migrations over Drizzle-generated ones, but loses the TypeScript schema/type inference benefit.

### Next.js App Router ↔ Fastify (Question 4)

**Where to keep the token: httpOnly cookie, set by a Next.js Route Handler, never exposed to client JS.** After the 2-step 삐용 login flow completes, a Next.js Route Handler (`app/api/auth/callback` or similar) receives the 삐용 JWT and sets it as an `httpOnly`, `Secure`, `SameSite=Lax` cookie scoped to `erp.swonbiz.com`. This satisfies the requirement that the token be usable in **both** middleware and Fastify calls:
- **In middleware:** `await cookies()` (async in both Next 15 and mandatory-async in Next 16) reads the cookie directly — no network call needed for the redirect/role-gate decision described in `SWONBIZ_PROJECT_STRUCTURE.md` (`(erp)` group session check, `role: 'operator'` redirect).
- **On calls to Fastify:** server-side code (Server Components, Route Handlers, Server Actions — anything running on the Next.js server, never the browser) reads the same cookie and forwards it as an `Authorization: Bearer <token>` header to Fastify. The browser never talks to Fastify directly, which sidesteps most of the cross-domain CORS complexity from Q1 (Fastify only needs to trust requests carrying a valid bearer token from its own network, not arbitrary browser origins) and keeps the token out of reach of any XSS in the React app.

**Split the "verify" concern by trust level, not by convenience:** middleware should do a **cheap, non-cryptographic check** (cookie exists, JWT `exp` claim hasn't passed, base64-decode the payload for the role claim to pick the redirect target) purely for UX/routing — it is not the security boundary. **Fastify performs the real, full cryptographic `jose.jwtVerify()` on every request** and is the actual authorization boundary, since it's the only place actually touching data. This split is what makes it acceptable that the JWT secret/public key only needs to live in Fastify's `.env`, not also in Next.js's — reducing secret sprawl, and sidestepping the open question about 삐용's algorithm mattering less for the frontend (if 삐용 rotates a secret, only Fastify needs updating). If stricter defense-in-depth is wanted later, middleware *can* also run `jose.jwtVerify()` (it works fine in the Edge runtime, unlike `jsonwebtoken`) — but that means the secret must also be present in Next.js's env, which is a tradeoff to make deliberately, not by default.

**Next 15 → Next 16 changes that matter here:**
- `cookies()`, `headers()`, `draftMode()`, and dynamic `params`/`searchParams` are **async-only** in Next 16 — the Next 15 compatibility shim for synchronous access is gone. Since this is a greenfield project starting fresh, this isn't a migration concern, just: **write every server function that touches these as `async` from day one**, including the middleware's cookie read.
- Next 16.3 introduced client-side caching changes for the App Router (per Next's own 16.3 blog post) — worth a second look during the Phase where the booking calendar's client-side navigation/caching behavior is designed, since stale-while-revalidate defaults can affect how "fresh" a room's booking grid looks after a mutation from another user. Flag this for phase-specific research rather than resolving here (LOW confidence on exact current defaults; changelog activity around this area is recent/ongoing as of this research date).

**BFF proxy routes (`app/api/*`):** the project structure doc already anticipates this ("Fastify 프록시 또는 직접"). Recommend defaulting to **direct server-side `fetch()` calls to Fastify from Server Components/Route Handlers/Server Actions**, and only adding an actual Next.js `app/api/*` proxy route for cases where the **browser** needs to reach Fastify-backed data directly (e.g. the public kiosk display polling room status without a logged-in session, or a future websocket/SSE live-update channel) — a full proxy layer for every single resource adds a maintenance tax with no benefit when the caller is already server-side Next.js code.

### Frontend Supporting Libraries (Question 5)

| Concern | Recommendation | Version | Why |
|---|---|---|---|
| **Styling** | **CSS Modules**, with the existing template's CSS custom properties lifted verbatim into `styles/tokens.css` (already the plan in `SWONBIZ_PROJECT_STRUCTURE.md`) | N/A (native Next.js support, zero extra dependency) | The project's own constraint is "이관한다, 새로 설계하지 않는다" (migrate as-is, don't redesign) for 11 hand-built `.dc.html` templates and 15 DS components. Tailwind would require rewriting every element's markup into utility classes — a redesign in disguise, and a poor fit when the visual source of truth is already-written CSS using custom properties. vanilla-extract requires converting styles into TypeScript style objects — real value for large multi-theme design systems, but pure migration overhead here since there's exactly one theme and the CSS already exists. CSS Modules require the least transformation: mostly copy-paste the existing class-based CSS into `.module.css` files per component, which is the fastest and lowest-risk path to pixel-parity with the design templates, and works natively in React Server Components (unlike most CSS-in-JS). Confidence: HIGH — this also matches what the project's own structure doc already committed to. |
| **Heavy form state** (contract form: 4 sections, 5 states, ≤10 items, ≤20 users) | **react-hook-form** 7.87.x + `zodResolver` (`@hookform/resolvers`) + `useFieldArray` for the item/user arrays | react-hook-form 7.87.0 | Mature, uncontrolled-first (fewer re-renders across a form this large), and `useFieldArray` is purpose-built for exactly "up to N dynamic rows with per-row validation." Pairing with the same Zod schemas used server-side (Q1 decision) means one source of truth for "what makes a contract item valid." TanStack Form is a legitimate newer alternative with good array-field support, but it's less battle-tested for this specific shape (conditional section-locking after `confirmed` state, cross-field validation between sections) and there's no other reason in this project to standardize on the TanStack ecosystem for forms specifically. Confidence: MEDIUM-HIGH. |
| **Server state / data fetching** | **Hybrid**: Server Components + direct `fetch()` to Fastify for initial page loads and mostly-static reads (tenant list, facility master data); **TanStack Query** (5.102.x) layered on top specifically for the interactive, client-driven views — the booking month/week grid (frequent client-side date navigation without full page reload) and any live/polling views (kiosk display, room status board) | @tanstack/react-query 5.102.8 | Given Fastify is a separate service (not Next's own API routes/DB), Server Actions provide little extra value beyond "a fetch call with less flexibility," while TanStack Query's cache/invalidation/optimistic-update model is a much better fit for a calendar UI where the user rapidly switches weeks/months and expects instant, cached transitions plus background refresh. Don't reach for Query on pages that only need one read on load (e.g. tenant detail) — that's RSC's job and adds an unnecessary client-side waterfall if done with Query instead. Confidence: MEDIUM (architectural judgment, not a hard technical constraint). |
| **Date/calendar (booking grid)** | **Build it** (as already planned: `components/patterns/TimeGrid.tsx`, `DensityCalendar.tsx`, extracted from the `.dc.html` templates), backed by **`date-fns`** 4.4.x for pure date-math utilities (slot boundaries, week/month range calculation, KST timezone handling) — do **not** adopt a full scheduler UI library (FullCalendar, react-big-calendar, Syncfusion/DevExtreme/Mobiscroll Scheduler, etc.) | date-fns 4.4.0 | Every generic scheduler library ships its own theming system, DOM structure, and interaction model that will actively fight the project's non-negotiable pixel-fidelity constraint (fixed 1440px grid, exact `#4F46E5`/`#22D3EE` tokens, "no green," DS `Icon` component only, custom masked money fields). Overriding a third-party scheduler's CSS to match a hand-built design system typically costs *more* engineering time than building the grid directly from the already-existing, already-pixel-correct `.dc.html` markup — which is exactly what the project structure doc already decided to do. This confirms an existing project decision rather than introducing a new one. `date-fns` (not `dayjs`, not hand-rolled `Date` math) is recommended purely for the underlying date arithmetic (adding weeks, computing month grids, comparing slot overlaps) because it's tree-shakeable, has first-class TypeScript types, and its v4 line has resolved most historical timezone gotchas relevant to Korea-only (single-timezone, KST) date math. Confidence: HIGH on "build, don't adopt a scheduler library" (design-fidelity constraint is explicit and non-negotiable); MEDIUM on `date-fns` specifically vs. `dayjs`/`@internationalized/date` (any of the three would work; date-fns has the largest ecosystem/familiarity edge). |

### Testing / Tooling (Question 6)

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| Vitest | **4.1.11** | Test runner (both Fastify service and Next.js app) | Native ESM/TS support with no transform config needed, fast, and works identically for backend unit tests and frontend component tests — one test runner for the whole monorepo-adjacent setup (two separate apps/services) reduces tooling duplication. `node:test` is a credible zero-dependency alternative for the Fastify service specifically (no watch-mode/coverage ecosystem maturity of Vitest yet), but using two different runners across the two services isn't worth the marginal dependency savings. Confidence: MEDIUM-HIGH (current community consensus per multiple 2026 sources, not a hard technical requirement). |
| `@vitest/coverage-v8` | 4.1.11 | Coverage reporting | Matches Vitest major version — keep them in lockstep. |
| Fastify's built-in `.inject()` | bundled with fastify 5.12.x | API/integration testing for Fastify routes | Zero-overhead in-process request injection, no real TCP socket, no extra dependency (no supertest needed). Pattern: build the Fastify app instance in a test helper, `await app.ready()`, then `app.inject({ method, url, headers, payload })` per test — works cleanly inside Vitest's `beforeEach`/`afterEach`. Confidence: HIGH (Fastify's own official testing docs). |
| Playwright (`@playwright/test`) | **1.62.1** | End-to-end testing | Standard choice for App Router E2E (multi-step login flow, contract-form multi-section flow, booking-grid interaction) — no viable alternative currently contests it for this use case. Confidence: HIGH. |
| TypeScript | 5.9.3 (pinned — see Core Technologies note) | Typecheck | Run `tsc --noEmit` in CI for both services; do not adopt the new `typescript@7` package until `typescript-eslint` confirms support (tracked for ~7.1, expected ~Oct 2026). |
| ESLint | 10.9.1 + `typescript-eslint` 8.69.0 | Lint | Use `eslint-config-next` (matching the installed Next 16.x) for the frontend app's ESLint config layered with `typescript-eslint`'s recommended rules; the Fastify service can use a plain `typescript-eslint` + Node-focused config (no `eslint-config-next` needed there, it's not a Next.js codebase). |

---

## Installation

```bash
# --- Fastify service (separate package.json, ESM) ---
npm install fastify@^5.12 @fastify/cors@^11.3 @fastify/rate-limit@^11.2 \
  @fastify/swagger@^9.8 @fastify/swagger-ui@^6.1 @fastify/sensible@^6.0 \
  fastify-type-provider-zod@^7.0 zod@^4.5 jose@^6.2 \
  postgres@^3.4 drizzle-orm@^0.45

npm install -D drizzle-kit@^0.31 typescript@5.9.3 vitest@^4.1 @vitest/coverage-v8@^4.1 \
  typescript-eslint@^8.69 eslint@^10.9 pino-pretty@^13.1

# --- Next.js app ---
npx create-next-app@latest --typescript --app   # pins to Next 16.x current

npm install react-hook-form@^7.87 @hookform/resolvers zod@^4.5 \
  @tanstack/react-query@^5.102 date-fns@^4.4

npm install -D typescript@5.9.3 vitest@^4.1 @playwright/test@^1.62 \
  eslint@^10.9 eslint-config-next typescript-eslint@^8.69

# --- Supabase CLI (migrations) ---
npm install -D supabase   # or a global/standalone install per Supabase's own docs
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| Zod + `fastify-type-provider-zod` for Fastify schemas | TypeBox + `@fastify/type-provider-typebox` | If raw validation throughput becomes an actual measured bottleneck (unlikely at this project's traffic scale), or if the team wants native JSON Schema output for tooling beyond `@fastify/swagger`. |
| `jose` for JWT verification | `@fastify/jwt` | If 삐용's tokens turn out to need frequent re-verification patterns that `@fastify/jwt`'s decorators genuinely simplify (e.g. if the team also wants Fastify to *issue* its own short-lived internal tokens layered on top of 삐용's — a valid future evolution, not needed for MVP). |
| Drizzle ORM + drizzle-kit-generated SQL applied via Supabase CLI | `node-pg-migrate` (hand-written SQL migrations, no ORM) | If the team prefers not to introduce an ORM abstraction at all and is comfortable hand-writing every migration and query with `pg`/`postgres.js` directly — a valid, arguably simpler choice for a schema this size, at the cost of manual TypeScript type maintenance for query results. |
| Session-mode Supavisor pooling for Fastify | Transaction-mode Supavisor pooling with `prepare: false` | If/when the number of Fastify instances or DB connection pressure grows enough that Supabase's connection-limit becomes a real constraint (unlikely for a single internal ERP's initial scale). |
| react-hook-form for the contract form | TanStack Form | If the team decides to standardize the whole frontend on the TanStack ecosystem (Query + Form + Table) for consistency — a reasonable stylistic choice, just not one with a concrete technical driver in this project. |
| TanStack Query for interactive views + RSC for static reads | Server Actions for all mutations, no TanStack Query | If the booking grid and contract form turn out to need less client-side interactivity than expected (e.g. full-page navigation per week is acceptable UX) — simplifies the stack by removing one dependency, at the cost of a less snappy calendar UI. |
| Build the booking grid from the existing template | `react-big-calendar` (free) or a commercial scheduler (Syncfusion/DevExtreme/Mobiscroll) | If a future phase (e.g. an external-facing booking product, currently Out of Scope per PROJECT.md) needs a fully generic, heavily interactive scheduler where pixel-fidelity to this specific design system stops being the binding constraint. |
| CSS Modules | Tailwind v4 (which now also uses CSS custom properties as its token foundation) | If a *future* redesign (not this migration) intentionally rebuilds screens rather than porting the existing `.dc.html` templates — Tailwind's utility-first model is a fine choice for greenfield screens that don't need to match an existing hand-written CSS source of truth. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| `jsonwebtoken` for any JWT verification that might run in Next.js middleware | Depends on Node's `crypto`/`Buffer` in ways that don't work in the Edge runtime, which is the default for Next.js middleware. Silent/confusing failures if middleware ever needs to verify tokens itself. | `jose` (Web Crypto based, works in Node and Edge identically) |
| `typescript@latest` / unpinned `typescript` in package.json right now | `latest` currently resolves to TypeScript **7.0.2**, the new Go-native compiler — a different binary with known ecosystem gaps (`typescript-eslint`, ESLint core, Vue/Svelte/Astro tooling) as of this research date. | Pin `typescript@5.9.3` explicitly; revisit once `typescript-eslint` confirms TS7 support (tracked for ~7.1) |
| `drizzle-kit push` directly against the shared production Supabase database | The Postgres instance is shared across `s020_*` (삐용), `s030_*` (this ERP), and future `s040_*` schemas — a tool assuming it owns the whole schema risks clobbering or ignoring migrations from other teams/apps, and `push` skips the reviewable/ordered migration history you want across a shared DB. | `drizzle-kit generate` → copy resulting SQL into `supabase/migrations/` → apply via Supabase CLI |
| Relying on Supabase RLS / `auth.uid()` as the primary tenant-isolation mechanism | `auth.uid()`/`auth.jwt()` are populated by Supabase's own Auth service signing the session JWT — this project's auth is 100% external (삐용), so those functions return nothing useful without an extra JWT-exchange step this project isn't doing in Phase 1. | Application-layer tenant scoping in Fastify: every tenant-scoped query filters by `org_id` derived from the verified 삐용 JWT claims, enforced in code/repository-layer, not in Postgres policies |
| A full third-party scheduler UI library (FullCalendar, react-big-calendar, Syncfusion, etc.) for the booking grid | Fighting a generic library's theming/DOM to match an already-pixel-correct hand-built design template costs more than building directly from that template's markup. | Build `TimeGrid`/`DensityCalendar` from the `.dc.html` source (already the project's own plan), `date-fns` for date math only |
| Prepared-statement-reliant query patterns against Supavisor **transaction mode** | Transaction mode reassigns the underlying connection per transaction; prepared statements from a previous transaction may not exist on the next one the client is handed, causing intermittent errors. | Use session-mode pooling (recommended default here), or explicitly disable prepared statements (`postgres.js`: `{ prepare: false }`) if transaction mode is chosen later |

## Stack Patterns by Variant

**If 삐용's JWT turns out to be RS256 (not HS256):**
- Use `jose.importSPKI()` with the public key PEM instead of `jose.importJWK()`/`createSecretKey()` with a shared secret — everything else (the `jwtVerify()` call shape, the Fastify hook structure, the "secret lives only in Fastify's `.env`" pattern) stays identical.
- Because RS256 verification only needs the *public* key, it's actually the easier case to get 삐용's team to hand over (no shared-secret trust concern) — worth asking for this explicitly if given a choice.

**If a public-facing kiosk/booking feature is revisited later (currently Out of Scope):**
- That's the point where `@fastify/cors` needs real configuration (rather than being effectively a no-op behind the BFF pattern) and where a proper `app/api/*` proxy layer for browser-direct Fastify calls becomes worth building out, since the "Next.js server is the only Fastify caller" assumption breaks.

**If the team later wants defense-in-depth JWT verification in middleware (not just expiry/role checks):**
- The 삐용 secret/public key needs to also live in Next.js's `.env` (increasing secret sprawl across two services) — a deliberate tradeoff, not the default recommendation here.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| `fastify-type-provider-zod@7.0.0` | `zod@>=4.2` | v7 of the provider uses zod's `.encode()`/`.decode()` APIs (added in zod 4.2) and serializes on `z.output`, not `z.input`. Provider versions ≥5 <7 target zod v4 (pre-4.2); ≤4.x target zod v3. Do not mix. |
| `typescript@7.0.2` (Go-native) | `typescript-eslint` | **Not yet reliably compatible** as of this research date — `typescript-eslint` has not committed to day-one TS7 support; stay on `typescript@5.9.3` until confirmed (tracked for TS 7.1, ~Oct 2026). |
| `next@16.3.x` | `react@19.2.x` | Next 16 requires React 19; `create-next-app` pins this automatically. |
| Drizzle schema (`s030_*` tables only) | Supabase-shared Postgres instance (`s020_*`, `s040_*` also present) | Drizzle's `schema.ts` should declare only `s030_*` tables. Never point `drizzle-kit` introspection/push at the whole database — it will pick up `s020_*`/`s040_*` tables it doesn't own. |
| Supavisor transaction mode (port 6543) | Prepared statements | Not supported by default; use session mode (port 5432 / explicit session pooling) if the ORM/driver relies on prepared statements, or disable them explicitly. |

## Open Question (flag for phase-specific research / direct confirmation)

**삐용's actual JWT signing algorithm (HS256 vs RS256) is unverified.** This research assigned MEDIUM confidence to "probably HS256 shared secret" based on general Spring Boot/jjwt community patterns for internal single-consumer auth services — it is not a confirmed fact about the 삐용 codebase. Before implementing the Fastify JWT-verification hook, confirm directly (source code review of 삐용, or a direct question to whoever maintains it):
1. Signing algorithm (`alg` header value on an actual issued token — this can also just be decoded from a real token without needing the secret).
2. Whether a shared secret or public key can be obtained at all, and through what channel.
3. Exact claim names for `memberId`/organization/role (needed for the Fastify `org_id`-scoping logic in Q3 and the middleware role-based redirect in Q4).

This does not block starting Phase 1 scaffolding, DS component migration, or schema design for non-auth tables — but it does block writing the actual `jose.jwtVerify()` hook and should be resolved before the "lib/auth 삐용 JWT 연동" step (step 3 of the project's own 9-step development order).

## Sources

- npm registry (`registry.npmjs.org`) — live version lookups for all listed packages, fetched 2026-09-01 (HIGH confidence, primary source for every version number in this document)
- [nextjs.org/blog/next-16](https://nextjs.org/blog/next-16) / [nextjs.org/docs/app/guides/upgrading/version-16](https://nextjs.org/docs/app/guides/upgrading/version-16) — Next 16 GA date, async request API changes
- [nextjs.org/blog/next-16-3](https://nextjs.org/blog/next-16-3) — client-side caching changes referenced as a phase-specific follow-up
- [github.com/panva/jose](https://github.com/panva/jose) — `jwtVerify`/`importSPKI`/`importJWK` API shape (verified via repo docs fetch)
- [supabase.com/docs/troubleshooting/disabling-prepared-statements](https://supabase.com/docs/guides/troubleshooting/disabling-prepared-statements-qL8lEL), [supabase.github.io/supavisor/faq](https://supabase.github.io/supavisor/faq/) — Supavisor transaction vs session mode, prepared statement support
- [orm.drizzle.team/docs/connect-supabase](https://orm.drizzle.team/docs/connect-supabase), Supabase's official `drizzle.mdx` guide (github.com/supabase/supabase) — Drizzle + Supabase CLI migration workflow
- [github.com/turkerdev/fastify-type-provider-zod](https://github.com/turkerdev/fastify-type-provider-zod) — zod v4.2+ version coupling for provider v7
- [betterstack.com/community/guides/scaling-nodejs/typebox-vs-zod](https://betterstack.com/community/guides/scaling-nodejs/typebox-vs-zod/) — TypeBox vs Zod performance/ecosystem tradeoffs (MEDIUM confidence, community benchmark source, cross-checked against Fastify's own docs favoring TypeBox for JSON Schema)
- [fastify.dev/docs/latest/Guides/Testing](https://fastify.dev/docs/v5.4.x/Guides/Testing/) — `.inject()` official testing pattern
- Coverage of TypeScript 7.0 GA (July 8, 2026) and ecosystem-compatibility gaps — multiple 2026 sources (visualstudiomagazine.com, digitalapplied.com, ecorpit.com) cross-referenced against npm's own dist-tags (`latest`/`rc`/`next` all pointing to the 7.x line, with 5.9.3 as the last 5.x release) — MEDIUM-HIGH confidence (npm dist-tag data itself is HIGH confidence/primary source; the "typescript-eslint not supporting it yet" claim is MEDIUM, sourced from community articles rather than an official typescript-eslint statement)
- WebSearch (uncited specific URLs, MEDIUM/LOW confidence, used for directional/ecosystem-consensus findings only, cross-checked where possible): Spring Boot/jjwt HS256-by-default community pattern; react-hook-form vs TanStack Form maturity for dynamic field arrays; scheduler-library landscape (FullCalendar, react-big-calendar, Syncfusion, Mobiscroll)

---
*Stack research for: Korean coworking-space operations ERP (SwonBiz ERP)*
*Researched: 2026-09-01*
