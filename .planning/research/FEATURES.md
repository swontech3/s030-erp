# Feature Research

**Domain:** Coworking / flexible-office (공유오피스) operations management — internal ERP for a single Korean operator (에스원비즈), not a multi-tenant SaaS product
**Researched:** 2026-09-01
**Confidence:** MEDIUM overall (HIGH for Western product feature sets, verified against official help centers; MEDIUM–LOW for Korean-operator-specific practice, which is documented mostly through legal/tax secondary sources rather than product docs, since 패스트파이브/스파크플러스 are tenant-facing brands and do not publish their internal operator tooling)

## Sources Consulted

- OfficeRnD Flex Help Center (help.officernd.com, help-flex.officernd.com) — contract statuses/stages, resource types, meeting room booking features, booking policies, Data Hub / occupancy analytics, calendar integration limitations. **HIGH confidence**, official docs.
- Nexudus Help Center (help.nexudus.com, legacydocs.nexudus.com) — contracts-generated-from-plans model, resource types, time credits, billing/proration/tax handling. **HIGH confidence**, official docs.
- Cobot Help Center (helpcenter.cobot.me) — cancellation period, min/max booking duration, external/visitor bookings. **HIGH confidence**, official docs.
- Third-party vendor comparison roundups (archieapp.co, coworks.com) for Optix / Cobot / andcards(now Spacebring) feature summaries. **MEDIUM confidence** (comparison content, not primary docs, but consistent across independent sources).
- Korean legal/tax secondary sources (easylaw.go.kr, lawtalk.co.kr, modusign.co.kr, hapt.co.kr, casenote.kr NTS ruling excerpts) for 전대차 vs 이용계약, 원상복구, 관리비 부가세, 사업자등록. **MEDIUM confidence** (legal-explainer sites and one tax-authority ruling excerpt, not the operators' own product docs).
- 스파크플러스 public site — confirmed locker (사물함) is a separate paid add-on via a members' app, and parking is only available with an office contract, not with a day/lounge pass — i.e. add-ons can be conditional on contract type. **MEDIUM confidence** (marketing/help pages, not admin-side docs).
- No usable data found on WeWork's internal operations tooling — it is proprietary and undocumented publicly. Treated as a gap, not a finding.
- Do not infer year-specific pricing or claims beyond what sources state; publication dates on the roundup articles were current (2026) at time of search.

---

## Feature Landscape

### Table Stakes (Operator Cannot Run the Business Without These)

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| Tenant company registration (사업자등록번호, 상호, 대표자, 담당자 연락처) | Every product (OfficeRnD "Company", Nexudus "Customer") treats the company as the billable/contracting entity, separate from individual members | LOW | Already in v1 scope (`s030200010`/`020`). Capture 사업자등록번호 as a structured, validated field, not free text — it is reused for tax invoices later (see Korea section). |
| Contract as a first-class entity with defined term, room assignment, and status lifecycle | Nexudus: "a new contract is generated every time a customer signs up to a plan." OfficeRnD: the contract drives occupancy, billing, and renewal tracking. It is the object every other screen (occupancy, billing, portal) joins against. | HIGH | Already the stated core value of this project (PROJECT.md). Confirmed as the correct modeling choice against category practice. |
| Contract line items beyond the room itself (room + 주차/parking + 사물함/locker + 가상오피스/virtual office + extra members + signage) | Nexudus "Plans" and OfficeRnD "Resource Types" both generalize a contract to a set of priced items, not a single room reference. 스파크플러스 confirmed selling lockers and parking as separate add-on SKUs, with parking conditional on office-contract type (not available with a day pass). | MEDIUM–HIGH | **Schema-forcing.** PROJECT.md already caps this at "계약 항목 최대 10행" — confirms a `contract_item` child table is required in v1, even though pricing/tax per item ships with billing in v3. Model as generic rows (item type + description + qty + unit price + tax flag), not fixed room+3-addon columns, or v3 billing forces a migration. |
| Contract renewal (재계약) as a distinct, traceable action, not a silent edit | OfficeRnD gives renewal its own lifecycle stage ("Up for renewal" → new contract term); the term is standardized across the category. PROJECT.md's own modal spec already names "계약 등록 (신규·재계약)" as one composed action. | MEDIUM | **Schema-forcing.** Add a self-referencing nullable FK on the contract table (e.g. `renewed_from_contract_id`) in v1, even though the UI today only needs to create a new contract row. Without it, renewal history ("how many times has this tenant renewed, at what terms each time") is unrecoverable later without back-filling from documents. |
| Contract termination captured distinctly from cancellation, with reason/date | Every product distinguishes "never became active" (cancelled/void) from "was active, then ended" (terminated/expired) — different accounting and legal consequences. PROJECT.md already models this correctly: `draft → cancelled` vs `confirmed → terminated`. | LOW | Already correct in v1 design. Recommend also capturing a termination reason (coded or free text) and an "effective termination date" distinct from "request date" — Korean 전대차 practice expects a notice period, and deposit/원상복구 disputes hinge on the exact vacate date (see Korea section). Not required for v1 workflow logic, but the column should exist now, not be retrofitted after the first real termination dispute. |
| Deposit (보증금) amount + refund status on the contract | Universal in the category (Nexudus: "Deposits will apply if you've added a deposit product... Financial accounts can be created for deposits") and standard in Korean commercial-space practice, where deposit refund is explicitly conditioned on 원상복구 (restoration) per case law. | LOW–MEDIUM | **Schema-forcing.** Store deposit amount and a refund-status enum (held / refunded / withheld / partially withheld) on the contract even though no payment processing exists yet. Pure data capture today (operator tracks it manually) — but the field must exist now or deposit history for early contracts is unrecoverable when v3 billing needs it. |
| Rent-free / 무상기간 (fit-out period before billing starts) | Standard in Korean coworking/commercial leasing — a negotiated free period (move-in prep, waiting on prior tenant's vacate) before the paid term begins. Confirmed as standard commercial-lease practice in Korean legal sources. | LOW | **Schema-forcing.** Add a `billing_start_date` distinct from `contract_start_date` (or explicit free-period start/end pair) now. If these are collapsed into one field in v1, separating them later means re-interpreting historical data unreliably. This affects both printed 계약서 templates (a 무상기간 clause is common) and v3 billing, which must not invoice during the free period. |
| Contract type distinguishing 이용계약 (service/usage contract) vs 전대차계약 (sublease) | Legally distinct in Korea: 이용계약 conveys no real-estate rights (no 권리금, no further subletting — pure service contract); 전대차계약 requires landlord (임대인) consent and gives the sub-tenant (전차인) lease-like legal status. Confirmed via Korean legal sources (easylaw.go.kr, lawtalk.co.kr): "일반 부동산은 건물주와 임차인이 임대차 계약을... 공유오피스는 운영자와 임차인이 전대 형식으로 계약." | MEDIUM | Already scoped correctly (PROJECT.md: preview/print for both forms). Confirms `contract_type` must be a first-class, validated field driving which template renders — not inferred from other fields — because the legal obligations differ, not just the document copy. |
| Room/floor/building master data (건물·층·호실) as a structured hierarchy | Every product surveyed (OfficeRnD, Nexudus, Cobot) has an explicit space hierarchy that contracts, bookings, and occupancy views all join against. | MEDIUM | Already in v1 scope. This is the dependency root for occupancy view, contract room assignment, and meeting-room inventory — correctly sequenced early in PROJECT.md's 1차 개발 순서. |
| Meeting room calendar view (day/week/month) with create/edit/cancel | Core feature of every product surveyed; OfficeRnD names "Contracts and Memberships, Meeting Room Bookings, and Reporting & Analytics" as its three pillars. | MEDIUM | Already in v1 scope. Month view (operator-only) / week view (tenant-only) per PROJECT.md is a reasonable internal-ops restriction of *who sees what*, not a capability gap versus the category — real products expose both views to everyone by default, but nothing here contradicts standard practice. |
| Booking conflict prevention (no double-booking a room) | Baseline requirement across all booking software, not coworking-specific. | LOW–MEDIUM | Must be enforced server-side (overlapping time-range check per resource), not merely disabled slots in the UI, once concurrent bookings are possible. |
| Booking cancellation with a cutoff/cancellation window | Cobot: "Members can cancel a booking until the number of hours you specify... Visitors can see a resource's cancellation period before booking." Standard across the category. | LOW | Not explicitly named in PROJECT.md's Active requirements, but cheap: a single configurable hours value fits the project's existing pattern of centralizing unconfirmed constants in `lib/constants.ts` ("예약 시간·요금"). Recommend including in v1. |
| Capacity / max-attendee limit per meeting room | Standard attribute on every "resource" object in the category. | LOW | Simple integer field on room master data; implied by "회의실 등록·수정." |
| Kiosk / door-display board (표시 전용) | Common companion fixture to meeting-room booking across the category (comparable to Robin/Joan-style room-tablet displays, which coworking vendors also bundle). | MEDIUM | Already in v1 scope. Correctly scoped as read-only with QR handoff to the authenticated booking screen, rather than duplicating booking logic on the kiosk — matches standard practice for room-tablet displays generally. |
| Multi-tenant data isolation / masking of other companies' bookings and contract data | Explicit requirement across every multi-tenant coworking platform surveyed — tenants must never see another tenant's booking title, headcount, or contract terms. | MEDIUM–HIGH | Already a hard constraint in PROJECT.md ("타사 예약은 '예약됨'으로만 표시... 제목·조직명·인원을 마스킹"). This is an authorization/query-filtering concern, not a UI concern — the API layer must never send masked fields to the client at all (not just hide them client-side). Given the Supabase/Postgres stack, Row Level Security is a natural enforcement point worth evaluating explicitly, not left to per-endpoint filtering discipline alone. |
| Occupancy / vacancy view (per room, per floor, per building) | Every product treats this as a first-class screen, not a widget — OfficeRnD ships a dedicated "Occupancy Overview Dashboard" inside its analytics module, separate from its general dashboard. | MEDIUM | Already in v1 scope as its own screen (호실 점유·공실 현황), separate from the operator dashboard (`s030000060`) — consistent with category practice of treating occupancy as a dedicated view. |
| Expiring-contract visibility (계약 만료 예정 표시) | OfficeRnD models this as a dedicated contract *stage* ("Up for renewal," triggered automatically ahead of the notice period), not merely an ad-hoc filter — it is one of the most operationally important views for a space operator, since a missed renewal deadline directly costs revenue. | LOW–MEDIUM | **Not currently in v1 Active scope** but flagged as near-zero-cost: contract `end_date` already exists to drive the state machine, so a filtered/sorted view ("만료 30일 이내") on the existing 입주사·계약 master-detail screen needs no new schema. Recommend pulling a minimal version into v1 — the cost of adding a sort/filter now is far lower than the operational cost of missing a renewal before v2 ships. |

### Differentiators (Valuable, But Correctly Deferred or Chosen Deliberately)

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Recurring/repeating meeting-room bookings (e.g. "every Tuesday 10–11") | Common in mature products (OfficeRnD: "recurring bookings" listed among cancellation-policy features) and genuinely useful for standing internal meetings. | MEDIUM | Not in v1 Active scope. Reasonable to defer — it multiplies edge cases (editing/cancelling one occurrence vs. the series) disproportionate to a single-operator internal tool's early needs. Revisit once single-booking flow is stable. |
| Free-minutes/credit allowance per contract with usage-based overage | Nexudus's "Time Credits" model (minutes granted by plan, consumed by bookings, converted to money-credit charges on overage) is the category-standard way meeting-room usage ties into billing. Korean coworking contracts commonly bundle a monthly included-hours allotment. | MEDIUM–HIGH | Correctly deferred with billing to v3 — but **schema-forcing now**: v1 should log booking duration against the contract/org at time of booking (naturally available via room+time+org join) so that when v3 billing arrives, historical usage for overage calculation does not need to be reconstructed from booking-table joins retroactively. No new table required in v1 — just don't discard booking-to-contract linkage. |
| Check-in / no-show tracking for meeting rooms | Increasingly common in the category as an operational-efficiency feature (reduces "ghost bookings" holding rooms unused). | MEDIUM | Reasonable to defer — requires either a kiosk check-in action or a time-based auto-release rule, neither of which is in v1 scope. Not costly to add later since it only needs a status field on the existing booking row. |
| Calendar integration (Google Calendar / Outlook / ICS feed) | Commonly requested; OfficeRnD supports it but its own docs flag real limitations ("room privacy or team restrictions... are not enforced in Outlook," "hides meeting titles... even after the booking is accepted"). | HIGH | Correctly out of v1 scope. Note the verified caveat: even category leaders cannot fully preserve masking/privacy rules once a booking syncs to an external calendar. If this is ever added, treat it as a privacy-policy decision, not just an integration task — syncing internal bookings to tenant-controlled calendars risks leaking exactly the masked information PROJECT.md requires hiding. |
| Buffer time between bookings (e.g. 10-minute gap for cleaning/reset) | Category-standard configurable policy; useful for physical room turnover. | LOW–MEDIUM | Not in v1 scope. Cheap to add later as a single configurable duration on room settings — no schema dependency risk if deferred. |
| Revenue per sqm / per desk, projected revenue reports | OfficeRnD Data Hub ships "revenue distribution reports, projected revenue reports" as dedicated analytics. | HIGH | Correctly deferred — this requires priced contract-item data (v3 billing) and area/desk-count master data (partially present via 호실 in 기준관리). Revisit once billing exists; do not attempt a stand-in "revenue" number sourced from contract line items before pricing/tax rules are settled, or it will need rework. |
| Move-in / move-out pipeline view (upcoming onboarding/offboarding) | Common operator-facing view in the category, distinct from raw occupancy percentage — surfaces "who is arriving/leaving in the next N days" as an actionable list. | LOW–MEDIUM | Not in v1 scope but low-cost to add later: derivable entirely from existing contract `start_date`/`end_date`/status without new schema. Good v1.x candidate once the base contract/occupancy screens are validated in real use. |
| Approval workflow for bookings requested by non-tenants (외부 예약 승인 큐) | Standard in the category when a space accepts public/guest bookings (Cobot's "External Bookings" ships visitor-specific pricing, availability, and cancellation rules). | HIGH | Already correctly deferred (2차) in PROJECT.md, and further blocked pending policy decisions documented in `HANDOVER_T7_ErpApplyForm.md`. The booking status model already anticipates this (`requested`/`rejected` states exist in the screen list) — good foresight, no rework needed when this ships. |
| Deep occupancy analytics (prorated vs. beginning-of-month occupancy calculation methods, multi-location comparison) | OfficeRnD computes occupancy two ways ("Prorated and Beginning-of-the-Month") and compares across locations — meaningful once an operator runs many buildings. | HIGH | Correctly out of v1 scope for a single/few-building operator. A simple current-snapshot occupancy view (already planned) is sufficient; do not build multi-method occupancy calculation until the operator actually runs enough locations for the comparison to matter. |

### Anti-Features (Category-Standard, But Wrong for This Internal ERP)

| Feature | Why It Exists in the Category | Why Problematic Here | Alternative |
|---|---|---|---|
| CRM / sales pipeline (lead → tour → proposal → signed) | Multi-tenant SaaS products (Optix explicitly ships "CRM and communication tools") sell to space operators who run active sales funnels across many prospects. | This is a single-operator internal ERP whose core value is *processing an already-decided tenant through to a signed contract* — not sourcing or nurturing leads. Building a CRM pipeline duplicates the already-separate landing-page 상담 문의 flow and the deliberately-deferred 온라인 신청 폼, and adds a stage model (lead status, follow-ups, conversion tracking) with no stated business need. | Keep 상담 문의 (landing lead capture) and later 온라인 신청 폼 as simple, separate lead-intake forms feeding manually into tenant/contract registration — no pipeline/stage tracking. |
| Community feed / member social feed / event broadcasting | Optix and andcards/Spacebring both foreground this — "community feed for broadcasting announcements," "event communication" — because their business model depends on tenant retention and cross-tenant community as a selling point. | Not this project's core value, and actively in tension with the multi-tenant masking constraint: a community feed *wants* tenants to see each other, while this ERP's hard constraint is that tenants must not see each other's data. Building both invites contradictory product requirements. | If announcements are needed, use a simple one-way operator-to-all-tenants notice, not a social feed with cross-tenant visibility. |
| Door access / keycard hardware integration | Common integration point in mature platforms (access-control tie-ins are standard once a space has hundreds of members needing physical entry automation). | High complexity, hardware/vendor dependency, and zero mention anywhere in PROJECT.md's scope. Building this speculatively before an actual access-control vendor is chosen risks integrating against the wrong hardware API. | Leave physical access management as a manual/offline operator process until a specific hardware vendor and requirement exists. |
| Visitor management / guest QR check-in at reception | Standard in Optix, Cobot, andcards — all ship "visitor management" as a named feature, since public-facing coworking spaces need front-desk guest tracking. | Out of scope for this internal tool; overlaps with the already-deferred external booking flow and adds a whole new actor type (anonymous visitor) the auth model (삐용 JWT reuse) isn't designed to support. | Defer indefinitely unless the operator's front-desk process becomes a stated requirement; the existing kiosk board already covers the "who's using which room right now" visibility need without visitor accounts. |
| Marketplace / member perks & discounts | Optix/스파크플러스-style "멤버십몰" perks marketplaces exist to increase member retention and monetize partnerships. | Irrelevant to an internal operations tool; adds a whole commerce surface (partner catalog, redemption tracking) with no connection to the stated core value (processing contracts end-to-end). | Not needed; if perks exist operationally, handle them outside the ERP (e.g. a shared doc or the operator's existing marketing channel). |
| Native mobile apps (iOS/Android) | Optix "has set the standard for how mobile member apps should be" — mobile-first is a competitive axis for multi-tenant SaaS trying to win operator contracts. | PROJECT.md explicitly fixes the design to 1440px desktop with only two responsive screens (booking status board, kiosk). Building native apps contradicts the stated design constraint and roughly doubles delivery surface for zero stated v1 need. | Responsive web only, per the two screens already flagged in PROJECT.md's constraints; revisit mobile only if tenant self-service usage patterns demand it post-launch. |
| Two-way external calendar sync (Google/Outlook) as a v1/v2 feature | Category-standard convenience feature. | Verified (via OfficeRnD's own docs) to leak masked booking details once synced to an external calendar the operator doesn't control — directly undermines the multi-tenant masking hard constraint. | If ever built, treat as a privacy-review gated feature, not a routine integration — see Differentiators section. |
| Automated payment retry / dunning workflows | Standard once a billing+payment system exists (Nexudus ships this as part of automated billing). | Payment integration (PG) is explicitly out of scope through v3+; building dunning logic before payment collection itself exists is pure waste. | Defer entirely until v3 billing and a chosen PG are both live. |
| Interactive visual floor-plan editor (drag-and-drop desk/room layout) | OfficeRnD and Optix both offer floor-plan visualizations as a premium differentiator for larger, multi-location operators. | High build cost for a benefit that scales with building count/complexity; PROJECT.md's own note on 센터 관리 explicitly defers a tree/visual UI ("트리 UI는 센터가 실제로 늘어날 때 도입"). | Building-select + floor-tab + table (already the stated v1 design) is sufficient at current scale. |

---

## Multi-Tenant Member Portal — What Tenants Can/Cannot See

Verified pattern across OfficeRnD, Nexudus, and Cobot member portals, cross-referenced against PROJECT.md's own explicit constraint:

**Tenants (입주사 members) can typically self-serve:**
- View their own company's contract summary (term, room, status) — read-only, not editable by the tenant in any product surveyed
- View and manage (create/cancel) their own meeting-room bookings, within policy limits (cancellation window, capacity)
- See a shared calendar of room availability, with other tenants' bookings shown only as busy/occupied, never with identifying detail
- (Once billing exists) view their own invoices/payment history — explicitly out of v1 scope here, correctly deferred with billing

**Tenants cannot see, in any product surveyed, and must not see here:**
- Other tenants' contract terms, pricing, or company details
- Other tenants' booking titles, organizer names, or attendee counts (PROJECT.md: "제목·조직명·인원을 마스킹" — this project's requirement matches category norms exactly, it is not an unusual restriction)
- Occupancy/vacancy analytics, revenue reports, or any cross-tenant aggregate data — these are operator-only in every product surveyed
- Ability to edit contract terms, line items, or status transitions — contract lifecycle actions are operator-only everywhere surveyed

This confirms PROJECT.md's existing masking requirement is not a project-specific invention but standard category practice, and validates scoping the tenant role as strictly read/self-service-booking only in v1, with no tenant-side contract editing anywhere on the roadmap.

---

## Billing (청구) — Deferred to v3, But Schema Must Not Foreclose It

Even though 청구 ships in v3, the standard shape across Nexudus/OfficeRnD is consistent enough to state as the target model, so v1's contract/contract-item schema does not need reworking later:

1. **Plan/template → contract instantiation → recurring invoice.** Nexudus: "the plan acts as a template that defines the settings of the contracts such as the billing period, pricing, deposits, and assigned desks... customers will be invoiced based on the billing cycle defined in their plan." The v1 `contract_item` rows should already carry enough shape (unit price, billing frequency hint, item type) to later drive invoice-line generation without redesigning the item table — only the invoice/payment tables are new in v3.
2. **Proration on start/end and mid-cycle changes.** Both Nexudus and OfficeRnD automate proration for partial-period starts, terminations, and mid-cycle add-on changes. This is why capturing precise `billing_start_date` (distinct from `contract_start_date`, per the 무상기간 finding above) matters now — proration math in v3 needs an unambiguous billing-start anchor per contract.
3. **One-off charges** (초기 설정비, 원상복구비, 위약금 등) — modeled as ad-hoc invoice lines outside the recurring plan in every product surveyed. No v1 schema action needed beyond ensuring the future invoice-line table isn't hard-wired 1:1 to `contract_item` rows (one-off charges won't map to a pre-existing item).
4. **Overage rollup from meeting-room bookings.** Nexudus's time-credit model is the standard shape: allowance consumed per booking, overage converted to a billable charge at invoice time. As noted in Differentiators, v1 booking rows should retain their contract/org linkage so this rollup is a query against existing data in v3, not a data-migration problem.
5. **Tax handling — Korean 세금계산서 context.** See Korea section below; this is the one area where the Western product pattern ("automated tax calculation... default tax rate... assign tax rates to items") needs a Korea-specific substitution, not a direct port.

**Schema-forcing conclusion:** v1 should snapshot 사업자등록번호 and business-registration details (상호, 대표자명, 사업장주소, 업태/종목) on the contract itself (or a contract-linked "biller info" record), not only on the tenant-company master record. Tax invoices are legally tied to the buyer information *as of the transaction*, and a company's registered details can change between contract signing and a later renewal — if v1 only stores this on the mutable company record, v3 tax-invoice issuance for older contracts will use whatever the company record says *today*, which may be wrong. This is a real risk if not addressed now, since retrofitting historical snapshots after the fact is not reliably possible.

---

## Korea-Specific Expectations

| Topic | What a Korean operator expects | Confidence | Schema/Design Implication |
|---|---|---|---|
| 사업자등록번호 handling | Structured 10-digit business registration number, validated at entry, tied to 상호/대표자명/사업장주소/업태·종목 | MEDIUM (legal/tax secondary sources) | Store as structured fields on the tenant-company record; snapshot onto the contract per the billing note above. Validate format (10 digits) even in v1 UI, since it is collected there regardless of billing timing. |
| 세금계산서 (tax invoice) issuance | Legally required for B2B transactions above thresholds; commonly automated via third-party e-invoice APIs (팝빌/바로빌/이지빌 or direct 국세청 홈택스 연동) rather than built in-house — this is a strong, consistent pattern across Korean SaaS billing integrations generally. | MEDIUM (pattern inferred from Korean tax-compliance norms and vendor prevalence; not verified against SwonBiz's specific vendor choice, which is undecided) | **Schema-forcing for v3, informative for v1:** if a third-party e-invoice API is the likely integration path, the future invoice table should be designed to hold an external tax-invoice reference/status field (issued/pending/failed) rather than assuming in-house tax-document generation. Not a v1 action item, but worth flagging now so v3 scoping isn't surprised by this near-universal integration requirement. |
| 전대차 vs 이용계약 legal distinction | Confirmed real distinction (see Table Stakes) — not a paperwork nuance. 전대차 requires landlord consent and gives the tenant lease-like protections; 이용계약 is pure service contract with no realty rights. Which one applies changes both the printed document and the legal remedies available at termination/dispute. | MEDIUM-HIGH (multiple consistent Korean legal-explainer sources) | `contract_type` as an explicit, validated enum — already planned. Do not let it be inferred implicitly from other fields (e.g. from tenant business status), since PROJECT.md itself notes this exact business/individual distinction is still an open policy question (see the T7 온라인 신청 폼 blockers) — keep it as a direct operator choice, not a derived value, until that policy is settled. |
| 관리비 (building management fee) treatment | In traditional Korean commercial leasing, 임대료 (rent) and 관리비 are commonly itemized separately, and NTS treats 관리비 collected by a building's management body as subject to VAT with input-tax-credit implications for business tenants. Coworking operators, by contrast, often bundle everything into a single all-in service fee rather than breaking out 관리비 as its own line — this is a real divergence from traditional office leasing that a Korean tenant may notice if their contract doesn't clarify it. | LOW-MEDIUM (general Korean commercial-lease tax practice, not confirmed against a specific coworking operator's invoice format) | The `contract_item` schema (already planned as generic line items) should be flexible enough to represent 관리비 as either a bundled component of the room fee or a separate item row, since this is a per-operator/per-deal choice, not a fixed structural rule. Do not hard-code "room + fixed add-on types" if 관리비 might need to appear as its own line in some contracts. |
| VAT (부가가치세) on business contracts | Standard 10% VAT applies to B2B service contracts; treatment for non-business individual tenants is a genuinely separate question. | MEDIUM | This directly overlaps the already-identified open policy blocker in PROJECT.md ("예비창업자/개인사업자/법인 구분", "개인(비사업자) 회원의 계약서 종류" — from `HANDOVER_T7_ErpApplyForm.md`). No new finding beyond confirming this blocker is correctly identified as consequential — VAT treatment is one more reason those three policy decisions need resolving before the online application form (and eventually billing) can proceed correctly. |

---

## Feature Dependencies

```
Building/Floor/Room master data (기준관리)
    └──requires──> nothing (foundation layer)

Contract (계약)
    └──requires──> Tenant company registration
    └──requires──> Room master data (room assignment)
    └──enables──> Occupancy/vacancy view (room status derives from active contracts)
    └──enables──> Expiring-contract visibility (derives from contract end_date)
    └──enables──> Contract renewal (requires renewed_from_contract_id link)

Contract line items (contract_item)
    └──requires──> Contract
    └──enables (future)──> Billing v3 invoice-line generation
    └──enables (future)──> Overage/credit rollup (if virtual-office/parking items carry usage terms)

Deposit + billing_start_date fields on Contract
    └──enables (future)──> Billing v3 proration and deposit-refund workflow
    └──conflicts if omitted with──> accurate v3 invoicing for contracts signed in v1 (no retroactive fix possible)

Contract type (이용계약/전대차)
    └──requires──> Policy resolution on business-vs-individual tenant handling (currently blocked, per HANDOVER_T7_ErpApplyForm.md)
    └──drives──> which of the two printed contract templates renders

Meeting room master data
    └──requires──> Room master data (floor/building context)
    └──enables──> Meeting room booking

Meeting room booking
    └──requires──> Meeting room master data
    └──requires──> Multi-tenant masking (booking visibility rules)
    └──enables──> Kiosk/door-display board (reads booking state, adds nothing)
    └──enables (future)──> Overage billing (if booking rows retain contract/org linkage)

Multi-tenant data isolation
    └──requires──> Auth/org resolution from 삐용 JWT (org selection step)
    └──enables──> Tenant portal (safe to show tenant-scoped views only once isolation is enforced)

External/guest booking + approval queue (deferred)
    └──requires──> Booking `requested`/`rejected` states (already present in schema per screen list)
    └──requires──> Policy resolution on external booking payment/PG (currently deferred)

Billing v3
    └──requires──> Contract + contract_item (must already exist correctly shaped)
    └──requires──> Deposit fields, billing_start_date (must already exist)
    └──requires——> 사업자등록번호 snapshot per contract (must already exist)
    └──requires (external)──> Tax-invoice issuance path (likely third-party e-invoice API), PG integration
```

### Dependency Notes

- **Contract requires Room master data and Tenant company registration:** confirmed correct sequencing already reflected in PROJECT.md's 1차 개발 순서 — building/floor/room and 입주사 registration must exist before contract creation is testable.
- **Deposit + billing_start_date fields conflict if omitted:** this is the single highest-leverage schema-forcing finding in this research. If v1 ships without these fields, every contract created before v3 billing lands will have unreliable or unrecoverable proration/deposit data. This should be treated as a must-fix-before-launch schema decision, not a "nice to have."
- **Contract type requires policy resolution:** this dependency is already correctly identified as a blocker in the project's own documentation (T7 handover). Nothing in this research contradicts that; it reinforces that the blocker is real and touches billing (VAT), not just the application-form UI.
- **Multi-tenant isolation enables the tenant portal, not the reverse:** isolation logic (query filtering / RLS) must be proven correct before any tenant-facing view ships, since a masking bug is a data-leak, not a cosmetic defect.

---

## MVP Definition

### Launch With (v1) — Matches PROJECT.md's Active Scope, Confirmed Correct Against Category Practice

- [x] Building/floor/room/meeting-room master data — foundation for everything else
- [x] Tenant company registration with structured 사업자등록번호 — required for both contracts and future tax invoicing
- [x] Contract create/edit with 5-state lifecycle (`draft → confirmed → terminated`, `draft → cancelled`) — core value; category-validated as the right entity model
- [x] Contract line items (up to 10 rows) as generic priced items, not fixed columns — schema-forcing for v3 billing
- [x] Deposit amount + refund-status field, billing_start_date distinct from contract_start_date — schema-forcing, must not be deferred even though billing UI is deferred
- [x] Contract document preview/print (이용계약서/전대차계약서) — legally meaningful distinction, correctly scoped
- [x] Meeting room booking (month/week views, create/edit/cancel) — table stakes
- [x] Kiosk/door-display board, display-only — table stakes companion to booking
- [x] Occupancy/vacancy view as its own screen — table stakes, correctly separated from general dashboard
- [x] Multi-tenant masking of bookings and contract data — non-negotiable, enforce server-side/RLS, not client-side only

### Add After Validation (v1.x / v2) — Deferred With Good Reason, Low Regret Cost

- [ ] Expiring-contract filter/sort on the existing contract list — trigger: first time an operator nearly misses a renewal deadline; cost to add is near-zero given `end_date` already exists
- [ ] Move-in/move-out pipeline view — trigger: operator asks "who's arriving/leaving soon" repeatedly via ad-hoc means; derivable from existing contract dates, no schema change
- [ ] Renewal history display (using the `renewed_from_contract_id` link) — trigger: operator wants to see a tenant's full renewal chain, not just the current contract
- [ ] Check-in/no-show status on bookings — trigger: ghost-booking complaints from tenants about rooms appearing busy but unused
- [ ] Booking cancellation-window enforcement — cheap enough to include earlier if time allows; not a hard MVP blocker but should not slip past v1.x

### Future Consideration (v2+/v3+) — Correctly Out of Scope Now

- [ ] Recurring/repeating meeting-room bookings — defer until single-booking flow is proven stable
- [ ] Free-minutes/credit allowance and overage billing — tied to v3 billing; log booking-contract linkage now so this isn't a data problem later
- [ ] Calendar integration (Google/Outlook) — defer indefinitely unless masking-safe sync is specifically designed; verified privacy leakage risk in the category leader
- [ ] Revenue-per-sqm/desk analytics, projected revenue reports — requires v3 pricing data; do not build a placeholder version now
- [ ] External booking approval queue — already correctly blocked pending policy decisions
- [ ] Full billing/invoicing (청구) — v3, as already decided; this research validates the deferral and specifies what v1 must not omit to make v3 tractable

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---|---|---|---|
| Contract lifecycle (create/edit/state transitions) | HIGH | HIGH | P1 |
| Contract line items (generic, up to 10 rows) | HIGH | MEDIUM | P1 |
| Deposit + billing_start_date fields | HIGH (future-facing) | LOW | P1 |
| Contract document preview/print (2 forms) | HIGH | MEDIUM | P1 |
| Building/floor/room/meeting-room master data | HIGH | MEDIUM | P1 |
| Meeting room booking (create/edit/cancel, month/week) | HIGH | MEDIUM | P1 |
| Multi-tenant masking | HIGH | MEDIUM–HIGH | P1 |
| Occupancy/vacancy view | HIGH | MEDIUM | P1 |
| Kiosk display board | MEDIUM | MEDIUM | P1 |
| Expiring-contract filter | HIGH | LOW | P2 |
| Renewal history display | MEDIUM | LOW (given FK exists) | P2 |
| Move-in/move-out pipeline | MEDIUM | LOW | P2 |
| Check-in/no-show tracking | LOW-MEDIUM | MEDIUM | P3 |
| Recurring bookings | MEDIUM | MEDIUM-HIGH | P3 |
| Calendar sync (Google/Outlook) | MEDIUM | HIGH (+ privacy risk) | P3 |
| Overage/credit billing | HIGH (eventually) | HIGH | P3 (tied to v3) |
| Revenue analytics | MEDIUM | HIGH | P3 |
| Full billing/invoicing | HIGH (eventually) | VERY HIGH | P3 (v3, already scoped) |

**Priority key:**
- P1: Must have for launch (matches PROJECT.md Active scope)
- P2: Should have, add when possible (v1.x, low cost given v1 schema decisions above are made correctly)
- P3: Nice to have, future consideration (v2+/v3+, already or newly recommended for deferral)

---

## Competitor Feature Analysis

| Feature | OfficeRnD Flex | Nexudus | Cobot | Our Approach (SwonBiz v1) |
|---|---|---|---|---|
| Contract model | Contract with Draft/Active/Up-for-renewal/Notice-served/Expired/Terminated stages | Contract auto-generated from a Plan template | Membership/plan-based | 5-state simplified lifecycle (draft/confirmed/terminated/cancelled) — deliberately simpler; add renewal-link and richer termination metadata to keep the door open without building the full stage machine now |
| Contract line items | Resource Types (desk/office/parking/locker/custom) attached to billing plans | Plan-defined items including deposits | Desk/room/resource bookings tied to membership | Generic `contract_item` rows, max 10 — matches the category's generalized-item pattern |
| Meeting room booking | Full calendar, recurring, check-in, buffer, capacity, cancellation policy | Resource booking + time credits + overage | Calendar + min/max duration + cancellation window | Month(operator)/week(tenant) views, create/edit/cancel, masking — v1 deliberately omits recurring/check-in/buffer, matches category MVP subset |
| Occupancy view | Dedicated Data Hub dashboard, prorated vs. beginning-of-month calculation | Reporting module | Reporting for revenue/space usage | Single dedicated occupancy/vacancy screen — simpler calculation appropriate for current scale |
| Tenant portal masking | Privacy settings (Enterprise-tier "hide past bookings"); Outlook/Google sync known to leak titles | White-label member portal | White-label member portal | Server-enforced masking (title/org/headcount) for all tenants by default, no tier-gating — stricter than the category default, appropriate given this is an internal single-operator tool, not a configurable multi-tenant SaaS product |
| Billing | Automated recurring billing, proration, tax rates per item | Automated invoicing, time-credit rollup, location-based tax | Automated charging/invoicing | Deferred to v3; v1 schema captures deposit, billing_start_date, and 사업자등록번호 snapshot so v3 doesn't require rework |
| Community/CRM/marketplace | Present in adjacent products (Optix, andcards) | N/A (billing-focused) | N/A | Deliberately excluded — see Anti-Features |

---

## Sources

- OfficeRnD Flex Help Center: help.officernd.com, help-flex.officernd.com — contract statuses/stages, resource types, meeting room booking features, booking policies, Data Hub/occupancy dashboards, calendar sync limitations
- Nexudus Help Center: help.nexudus.com, legacydocs.nexudus.com — Plans/Contracts model, Resource Types, Time Credits, billing/proration/tax
- Cobot Help Center: helpcenter.cobot.me — cancellation period, booking duration limits, external/visitor bookings
- Comparison roundups (archieapp.co, coworks.com, softwareadvice.com, g2.com) for Optix/Cobot/andcards(Spacebring) feature summaries
- Korean legal/tax sources: easylaw.go.kr (임대차 승계, 임차권의 양도 및 전대차), lawtalk.co.kr (전대차계약 권리·의무, 원상복구 분쟁), modusign.co.kr (공유오피스 임대차/상주계약 실무), hapt.co.kr and cafe.daum.net/transtax (관리비 부가가치세), casenote.kr (국세청 유권해석 발췌)
- 스파크플러스 public site (sparkplus.co) — locker/parking add-on structure
- Project-internal documents: `.planning/PROJECT.md`, `doc/SWONBIZ_SCREEN_LIST.md`

---
*Feature research for: Korean coworking-space operations ERP (SwonBiz)*
*Researched: 2026-09-01*
