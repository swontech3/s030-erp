/* 부문별 기간 조회 · [엑셀 내려받기] · 올린 파일에서 이동 (2026-10-24)
   엑셀은 표준 양식 칸 그대로 — 실제는 ERP 공통 「엑셀 내려받기」 부품 */

/* ── 기간 거르기: 기본 작업할 달, 「기간 직접 지정」으로 바꿀 수 있음 ── */
const perOf = (sc) => (S.ui.per = S.ui.per || {})[sc] || (S.ui.per[sc] = { mode: "m", from: S.month + "-01", to: S.month + "-30" });
const isoOf = (md) => "2026-" + md.replace(".", "-");
const perOk = (sc) => (r) => { const p = perOf(sc); if (p.mode === "m") return true; const d = isoOf(r.date); return (!p.from || d >= p.from) && (!p.to || d <= p.to); };
function perBar(sc) {
  const p = perOf(sc);
  return `<span class="row" style="gap:8px;flex-wrap:nowrap"><span class="sm">기간</span><select class="select" style="height:32px;width:auto" data-chg="per-mode" data-s="${sc}"><option value="m" ${p.mode === "m" ? "selected" : ""}>작업할 달 (${mLabel(S.month)})</option><option value="c" ${p.mode === "c" ? "selected" : ""}>기간 직접 지정</option></select>${p.mode === "c" ? `<input type="date" class="input" style="height:32px;width:150px" value="${p.from}" data-chg="per-f" data-s="${sc}" data-k="from" aria-label="시작"><span class="sm">~</span><input type="date" class="input" style="height:32px;width:150px" value="${p.to}" data-chg="per-f" data-s="${sc}" data-k="to" aria-label="끝">` : ""}</span>`;
}
CHG["per-mode"] = (d, el) => { perOf(d.s).mode = el.value; render(); };
CHG["per-f"] = (d, el) => { perOf(d.s)[d.k] = el.value; render(); };
const xlsBtn = (name, n) => `<button class="btn btn--sm" data-act="xls" data-n="${esc(name)}" data-c="${n}">${ic("download", 14)}엑셀 내려받기</button>`;
ACT.xls = (d) => toast(`「${d.n}」 ${d.c}줄을 표준 양식 엑셀로 내려받습니다 (시안)`);

/* ── 파일로 걸러 보는 중 띠 ── */
const fileName = (id) => (id === "pp" ? "삐용 경비" : (S.files.find((f) => f.id === id) || {}).name || "");
const fileBand = (id, n, act) => `<div class="note note--info" style="align-items:center">${ic("filter")}<span style="flex:1"><b>「${esc(fileName(id))}」 파일로 들어온 ${n}줄만 보는 중</b></span><button class="btn btn--sm" data-act="${act}">모두 보기</button></div>`;

/* ── 거래 분류: 보기 「확인할 줄만 / 전체」 ── */
const CKINDS = [["all", "전체"], ["매입", "매입"], ["매출", "매출"], ["카드", "카드"], ["현금", "현금"], ["삐용 경비", "삐용 경비"], ["은행", "은행(짝 없는 줄)"]];
const viewSeg = () => `<span class="chips" style="margin-right:12px">${[["left", "확인할 줄만"], ["all", "전체"]].map(([k, l]) => `<button class="chip ${(S.ui.cview || "left") === k ? "on" : ""}" data-act="c-view" data-v="${k}">${l}</button>`).join("")}</span>`;
ACT["c-view"] = (d) => { S.ui.cview = d.v; if (d.v === "left") S.ui.cfile = null; render(); };
ACT["c-kind"] = (d) => { S.ui.ckind = d.k; render(); };
ACT["c-allfile"] = () => { S.ui.cfile = null; render(); };
function allTx() {
  const tg = clsTargets(), tgId = new Set(tg.map((t) => t.id));
  const st = (id, item) => (tgId.has(id) ? (clsDone(id) ? { item: S.cls[id].item } : { need: true }) : { item });
  return [
    ...D.txInv.map((r, i) => ({ id: "iv" + i, file: r.file, kind: r.kind, date: r.date, desc: r.desc, amt: r.amt, dir: r.kind === "매출" ? "in" : "out", ...st("iv" + i, r.item) })),
    ...D.txCard.map((r, i) => ({ id: "cd" + i, file: "f3", kind: "카드", date: r.date, desc: r.desc, amt: r.amt, dir: "out", ...st("cd" + i, r.item) })),
    ...S.cash.map((c) => ({ id: c.id, file: "f8", kind: "현금", date: c.date, desc: c.desc, amt: c.amt, dir: "out", ...st(c.id, c.item) })),
    ...S.ppiyong.map((e) => ({ id: e.id, file: "pp", kind: "삐용 경비", date: e.date, desc: `${e.who} · ${e.desc}${e.st === "cancelled" ? " (삐용에서 취소)" : ""}`, amt: e.amt, dir: "out", item: e.pay === "card" ? "카드 줄에 증빙 연결" : "정산 이체와 짝" })),
    ...tg.filter((t) => t.src === "bank" || t.src === "rest").map((t) => ({ id: t.id, file: S.files.find((f) => (f.org || "").includes(accName(t.acc).split(" · ")[1]))?.id, kind: "은행", date: t.date, desc: t.desc, amt: t.amt, dir: t.dir, ...st(t.id) })),
  ];
}
function clsAll() {
  const u = S.ui, base = allTx().filter(perOk("cls")).filter((r) => !u.cfile || r.file === u.cfile);
  const k = u.ckind || "all", list = base.filter((r) => k === "all" || r.kind === k).sort((x, y) => (x.date < y.date ? 1 : -1));
  const cnt = (kk) => base.filter((r) => kk === "all" || r.kind === kk).length;
  return ctx() + head("거래 분류", "전체 보기 — 그 달 매입 · 매출 · 카드 · 현금 · 삐용 경비 · 은행(짝 없는 줄)을 모두 봅니다. 항목은 「확인할 줄만」 보기에서 붙입니다.") +
    (u.cfile ? fileBand(u.cfile, base.length, "c-allfile") : "") +
    `<div class="card"><div class="card-pad" style="padding-top:14px;padding-bottom:14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">${viewSeg()}<span class="chips">${CKINDS.map(([kk, l]) => `<button class="chip ${k === kk ? "on" : ""}" data-act="c-kind" data-k="${kk}">${l} <b>${cnt(kk)}</b></button>`).join("")}</span></div>
      <div class="tbar">${xlsBtn("거래 분류 · " + (CKINDS.find(([kk]) => kk === k) || [0, "전체"])[1], list.length)}${perBar("cls")}<span class="sm">지금 걸린 거르기 결과만 내려받습니다</span></div>
      <table class="tbl" style="border-top:1px solid var(--border)"><colgroup><col style="width:64px"><col style="width:110px"><col><col style="width:120px"><col style="width:220px"></colgroup>
      <thead><tr><th>날짜</th><th>자료</th><th>내용</th><th class="num">금액</th><th>항목 · 상태</th></tr></thead>
      <tbody>${list.map((r) => `<tr><td class="tnum">${r.date}</td><td class="mut">${r.kind}</td><td class="ell" title="${esc(r.desc)}">${esc(r.desc)}</td><td class="num">${r.dir === "in" ? "+" : ""}${won(r.amt)}</td><td>${r.need ? `<span class="badge b-doing b-sm">분류 필요</span>` : r.item ? `<span${clsDone(r.id) ? ' style="font-weight:700"' : ""}>${esc(r.item)}</span>` : `<span class="mut">—</span>`}</td></tr>`).join("") || `<tr><td colspan="5" class="mut" style="text-align:center;padding:32px">해당하는 줄이 없습니다</td></tr>`}</tbody></table></div>` + next("classify");
}
const clsMain = SCREENS.classify;
SCREENS.classify = () => (S.month === D.DEFAULT_MONTH && S.ui.cview === "all" ? clsAll() : clsMain().replace('<div class="chips">', viewSeg() + '<div class="chips">'));

/* ── 은행 짝 맞추기: 파일 띠 ── */
ACT["m-allfile"] = () => { S.ui.mfile = null; render(); };

/* ── 부가세: 신고 기간 선택 + 매입 · 매출 명세 엑셀 ── */
function vatBar() {
  const opts = corp() ? ["2026년 3분기 예정 (7~9월)", "2026년 2분기 확정 (4~6월)", "2026년 1분기 예정 (1~3월)"] : ["2026년 2기 확정 (7~12월)", "2026년 1기 확정 (1~6월)"];
  return `<div class="row" style="gap:8px"><span class="sm">신고 기간</span><select class="select" style="height:32px;width:auto" data-chg="vat-per">${opts.map((o, i) => `<option value="${i}" ${(S.ui.vper || 0) == i ? "selected" : ""}>${o}</option>`).join("")}</select>${xlsBtn("부가세 매입 · 매출 명세 · " + opts[S.ui.vper || 0], 23)}<span class="sm">매입 · 매출 명세를 표준 양식으로 내려받습니다</span></div>`;
}
CHG["vat-per"] = (d, el) => { S.ui.vper = Number(el.value); render(); if (S.ui.vper) toast("시안 데이터는 첫 신고 기간만 있습니다"); };

/* ── 올린 파일 [보기] — 그 자료를 보는 화면으로, 그 파일 줄만 ── */
const TAX_TABS = { ntax: "국세", ltax: "지방세", social: "4대보험", loan: "대출" };
ACT["f-view"] = () => {
  const id = S.ui.fsel[0];
  if (id === "pp") { S.ui.cview = "all"; S.ui.cfile = "pp"; S.ui.ckind = "all"; go("classify"); return; }
  const f = S.files.find((x) => x.id === id); if (!f) return;
  if (TAX_TABS[f.kind]) { toast(`세금 · 보험 납부 · 대출 화면(${TAX_TABS[f.kind]} 탭)으로 이동합니다 — 시안 없음`); return; }
  if (f.kind === "bank") { const a = S.settings.accounts.find((x) => (f.org || "").includes(x.alias)); if (a) S.ui.acc = a.id; S.ui.mfile = f.id; S.ui.mf = "all"; go("match"); return; }
  S.ui.cview = "all"; S.ui.cfile = f.id; S.ui.ckind = "all"; go("classify");
};

/* ── 세무사 전달: 기간 선택 (기본 작업할 달 · 직접 지정 · 신고 기간 바로 고르기 — 선택지는 코드 표) ── */
const ymd = (s) => s.replace(/-/g, ".");
const perLabel = (sc) => { const p = perOf(sc); return p.mode === "m" ? mLabel(S.month) : `${ymd(p.from)} ~ ${ymd(p.to)}`; };
const sendFiles = () => { const p = perOf("send"); if (p.mode === "m") return S.files; const m0 = S.month + "-01", m1 = S.month + "-30"; return p.from <= m1 && p.to >= m0 ? S.files : []; };
const sendRows = () => sendFiles().reduce((n, f) => n + f.rows, 0);
const QUICK = () => [["vat", corp() ? "부가세 3분기 예정 (7~9월)" : "부가세 2기 (7~12월)", "2026-07-01", corp() ? "2026-09-30" : "2026-12-31"], ["wh", "원천세 하반기 (7~12월)", "2026-07-01", "2026-12-31"]];
const sendPer = () => `<div class="card card-pad row" style="gap:12px">${perBar("send")}<span class="row" style="gap:8px"><span class="sm">신고 기간 바로 고르기</span><select class="select" style="height:32px;width:auto" data-chg="send-quick"><option value="">고르기</option>${QUICK().map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></span><span class="sm">기간을 바꾸면 보낼 파일 · 건수가 그 기간으로 바뀝니다</span></div>`;
CHG["send-quick"] = (d, el) => { const q = QUICK().find(([k]) => k === el.value); if (!q) return; Object.assign(perOf("send"), { mode: "c", from: q[2], to: q[3] }); render(); };
