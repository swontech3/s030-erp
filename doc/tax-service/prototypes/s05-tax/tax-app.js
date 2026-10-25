/* 세무 서비스(S05) 시안 — 상태 · 공통 UI · 화면 전환 */
const D = window.TAX_DATA;
const clone = (o) => JSON.parse(JSON.stringify(o));
const $ = (s) => document.querySelector(s);
const won = (n) => (n || 0).toLocaleString("ko-KR");
const ic = (n, s = 16, st = "") => `<i data-lucide="${n}" style="width:${s}px;height:${s}px;${st}"></i>`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* 받침에 따라 조사만 돌려줍니다 — jo("식대", "을/를") → "를", jo("브라이트랩", "으로") → "으로" */
function jo(w, pair) {
  const c = String(w).trim().slice(-1).charCodeAt(0);
  const has = c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
  if (pair === "으로") return has && (c - 0xac00) % 28 !== 8 ? "으로" : "로";
  const [a, b] = pair.split("/");
  return has ? a : b;
}
function freshState() {
  return {
    screen: "home", month: D.DEFAULT_MONTH, type: "corp",
    settings: clone(D.settings), files: clone(D.files), emps: clone(D.emps), empSaved: false, noneKinds: [],
    bank: clone(D.bank), cash: clone(D.cash), cls: {},
    ppiyong: clone(D.ppiyong), ppLast: D.ppiyongLast, vendors: clone(D.vendors),
    wh: { made: false, at: "" }, sends: [], changed: false,
    fees: [], rest: [],
    ui: { big: {}, rpick: {}, whTab: "now", fsel: [], msel: null, draft: null, acc: "a1", mf: "all", open: null, pick: {}, csel: [], cbulk: "", vf: "all", vq: "", vsel: [], to: null, raw: [], modal: null },
  };
}
let S = freshState();

/* ── 화면 · 단계 ── */
const SCREENS = {};
const TITLES = {
  home: "이번 달 할 일", upload: "자료 올리기", match: "은행 짝 맞추기",
  classify: "거래 분류", vendors: "거래처", wh: "원천세", pl: "월별 손익", vat: "부가세", send: "세무사 전달", settings: "세무 설정", emp: "직원 급여",
};
const CODES = { home: "S05-01", upload: "S05-02", match: "S05-04", classify: "S05-05", vendors: "S05-06", wh: "S05-07", pl: "S05-08", vat: "S05-09", send: "S05-10", settings: "S05-11", emp: "S05-12" };
const NEXT = { upload: "match", match: "classify", classify: "wh", wh: "pl", pl: "vat", vat: "send" };

/* ── 계산 ── */
const corp = () => S.type === "corp";
const items = (dir) => D.ITEMS.filter((i) => (i.s === "all" || i.s === S.type) && (!dir || i.d === dir));
const kindFiles = (k) => S.files.filter((f) => f.kind === k);
/* 은행 줄 쪽 남은 금액을 분류로 넘긴 것 — 출처 「짝 남은 금액」 */
const clsTargets = () => [
  ...S.rest.map((x) => ({ ...x, src: "rest" })),
  ...S.bank.filter((b) => b.state === "none").map((b) => ({ id: b.id, src: "bank", date: b.date, desc: b.desc, amt: b.out || b.in, dir: b.out ? "out" : "in", hint: b.hint, acc: b.acc })),
  ...S.cash.filter((c) => !c.item).map((c) => ({ id: c.id, src: "cash", date: c.date, desc: c.desc, amt: c.amt, dir: "out" })),
];
const clsDone = (id) => S.cls[id] && S.cls[id].ok;
function counts() {
  const off = (k) => S.noneKinds.includes(k) || S.settings.unused.includes(k);
  /* 자료 9종 = 엑셀 8종 + 삐용 경비 */
  const total = D.KINDS.length + 1;
  const up = D.KINDS.filter((k) => kindFiles(k.id).length).length + (S.ppLast ? 1 : 0);
  const none = D.KINDS.filter((k) => !kindFiles(k.id).length && off(k.id)).length;
  /* 후보 줄 + 은행 줄 쪽에 남은 금액이 있는 「일부 짝」 */
  const cand = S.bank.filter((b) => b.state === "cand" || (b.pair && b.pair.partial && b.pair.partial.side === "bank" && !b.pair.partial.sent)).length;
  const tg = clsTargets();
  const clsLeft = tg.filter((t) => !clsDone(t.id)).length;
  return { up, none, upLeft: total - up - none, total, cand, clsTotal: tg.length, clsLeft };
}
const accName = (id) => { const a = S.settings.accounts.find((x) => x.id === id); return a ? a.bank + " · " + a.alias : "(삭제된 계좌)"; };
function touched() { if (S.sends.length) S.changed = true; }

/* 시안 오늘 기준 D-day */
const dday = (iso) => Math.round((Date.parse(iso) - Date.parse(D.TODAY)) / 86400000);
function deadlines() {
  return [
    /* 원천세 마감은 세무 설정의 신고 주기(매월 / 반기)에 따라 — 실제는 마감 규칙을 코드 표에서 읽음 */
    S.settings.halfYear
      ? (Number(S.month.slice(5)) <= 6
        ? { t: "원천세 신고·납부 (반기납부)", d: "2026-07-10", s: "1~6월에 준 급여·외주비에서 뗀 세금을 한 번에 냅니다" }
        : { t: "원천세 신고·납부 (반기납부)", d: "2027-01-10", s: "7~12월에 준 급여·외주비에서 뗀 세금을 한 번에 냅니다" })
      : { t: "원천세 신고·납부", d: "2026-10-10", s: "9월에 준 급여·외주비에서 뗀 세금" },
    corp()
      ? { t: "부가세 3분기 예정신고", d: "2026-10-25", s: "7~9월 거래분 — 법인은 분기마다 신고합니다" }
      : { t: "부가세 예정고지 납부", d: "2026-10-25", s: "세무서 고지서로 직전 기 세금의 절반을 냅니다 — 신고는 없습니다" },
  ];
}

/* ── 공통 UI ── */
const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const mLabel = (m) => m.slice(0, 4) + "년 " + Number(m.slice(5)) + "월";
const mShort = (m) => Number(m.slice(5)) + "월";
function ctx(note) {
  /* 거래처 · 세무 설정은 달 선택을 숨기고 안내만 */
  if (note) return `<div class="ctx"><span class="ctx-note">${note}</span></div>`;
  const i = MONTHS.indexOf(S.month);
  return `<div class="ctx"><div class="ctx-l"><span class="ctx-lab">작업할 달</span>
    <span class="month"><button data-act="month" data-d="-1" ${i <= 0 ? "disabled" : ""} aria-label="이전 달">${ic("chevron-left")}</button><span class="v">${mLabel(S.month)}</span><button data-act="month" data-d="1" ${i >= MONTHS.length - 1 ? "disabled" : ""} aria-label="다음 달">${ic("chevron-right")}</button></span>
    ${S.month === D.DEFAULT_MONTH ? "" : `<button class="btn--link btn" data-act="month-reset">지난달로</button>`}</div>
    <span class="ctx-note">${note || "오늘 2026년 10월 6일 · " + (corp() ? "법인" : "개인 일반과세자")}</span></div>`;
}
const head = (title, desc, right = "") => `<div class="page-h"><div><h1>${title}</h1>${desc ? `<p>${desc}</p>` : ""}</div>${right ? `<div class="row">${right}</div>` : ""}</div>`;
function next(id, txt) {
  const n = NEXT[id];
  if (!n) return "";
  return `<div class="next"><button class="btn btn--primary" data-act="go" data-s="${n}">다음 단계: ${TITLES[n]} ${ic("arrow-right")}</button><span class="t">${txt || ""}</span></div>`;
}
const notSep = () => `<div class="card card-pad"><div class="note">${ic("info")}<span>시안 데이터는 <b>2026년 9월</b>만 있습니다. 작업할 달을 9월로 돌려 확인해 주세요.</span></div><div style="margin-top:12px"><button class="btn" data-act="month-reset">9월로 이동</button></div></div>`;
const stBadge = (st) => ({ todo: '<span class="badge b-todo">할 일</span>', doing: '<span class="badge b-doing">진행 중</span>', done: '<span class="badge b-done">끝남</span>', view: '<span class="badge b-gray">조회</span>' })[st];

/* ── 토스트 ── */
let tt;
function toast(m) { const t = $("#toast"); t.querySelector("span").textContent = m; t.classList.add("on"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("on"), 2400); }

/* ── 렌더 — 포커스·커서 위치를 지켜 다시 그립니다 ── */
const MODALS = {};
function render() {
  const a = document.activeElement, aid = a && a.id, sel = a && a.selectionStart;
  $("#bb-title").textContent = "세무 · " + TITLES[S.screen];
  $("#bb-code").textContent = CODES[S.screen] + " · 이 제목줄은 삐용이 그립니다";
  const m = S.ui.modal;
  $("#body").innerHTML = SCREENS[S.screen]() + (m ? `<div class="overlay" data-act="ovl">${MODALS[m.type](m)}</div>` : "");
  $("#c-screen").value = S.screen;
  $("#c-type").value = S.type;
  $("#c-half").checked = S.settings.halfYear;
  if (S.screen === "settings" && S.ui.draft && S.ui.draft.errs) S.ui.draft.errs.forEach((id) => { const e = document.getElementById(id); if (e) e.classList.add("is-err"); });
  lucide.createIcons();
  if (aid) { const el = document.getElementById(aid); if (el) { el.focus(); if (sel != null && el.setSelectionRange) try { el.setSelectionRange(sel, sel); } catch (e) {} } }
}
/* 사업자등록번호 끝자리 검증 */
function bizOk(s) {
  const d = String(s).replace(/-/g, "");
  if (!/^\d{10}$/.test(d)) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let n = 0;
  for (let i = 0; i < 9; i++) n += +d[i] * w[i];
  n += Math.floor((+d[8] * 5) / 10);
  return (10 - (n % 10)) % 10 === +d[9];
}
function go(s) {
  /* 세무 설정을 저장하지 않고 떠나면 확인 창 (실제는 ERP 공통 방식) */
  if ((S.screen === "settings" && s !== "settings" && S.ui.draft && S.ui.draft.dirty) || (S.screen === "emp" && s !== "emp" && S.ui.edraft && S.ui.edraft.dirty)) {
    modal({ type: "confirm", icon: "triangle-alert", title: "저장하지 않은 변경이 있습니다", ok: "나가기",
      body: "이 화면을 나가면 바꾼 내용이 사라집니다. 저장하려면 [돌아가기]를 누른 뒤 [저장]을 누르세요.", run: () => { S.ui.draft = null; S.ui.edraft = null; go(s); } });
    return;
  } S.screen = s; S.ui.open = null; S.ui.modal = null; S.ui.draft = null; S.ui.edraft = null; render(); window.scrollTo(0, 0); }
const modal = (o) => { S.ui.modal = o; render(); };
const closeModal = () => { S.ui.modal = null; render(); };

/* ── 이벤트 위임 — data-act (클릭) · data-chg (변경) · data-inp (입력) ── */
const ACT = {
  go: (d) => go(d.s),
  month: (d) => { const i = MONTHS.indexOf(S.month) + Number(d.d); S.month = MONTHS[Math.max(0, Math.min(MONTHS.length - 1, i))]; render(); },
  "month-reset": () => { S.month = D.DEFAULT_MONTH; render(); },
  close: () => closeModal(),
  ovl: (d, e) => { if (e.target.classList.contains("overlay")) closeModal(); },
};
const CHG = {}, INP = {};
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const f = ACT[el.dataset.act];
  if (f) f(el.dataset, e, el);
});
document.addEventListener("change", (e) => { const el = e.target.closest("[data-chg]"); if (el && CHG[el.dataset.chg]) CHG[el.dataset.chg](el.dataset, el); });
document.addEventListener("input", (e) => { const el = e.target.closest("[data-inp]"); if (el && INP[el.dataset.inp]) INP[el.dataset.inp](el.dataset, el); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.ui.modal) closeModal(); });

/* 확인 모달 (공통) */
MODALS.confirm = (m) => `<div class="modal modal--sm" role="alertdialog" aria-modal="true"><div class="confirm"><div class="ic ${m.red ? "red" : ""}">${ic(m.icon || "circle-help", 24)}</div><h3>${m.title}</h3><p>${m.body}</p></div>
  <div class="confirm-f"><button class="btn" data-act="close">돌아가기</button><button class="btn ${m.red ? "btn--danger-solid" : "btn--primary"}" data-act="confirm-ok">${m.ok}</button></div></div>`;
ACT["confirm-ok"] = () => { const f = S.ui.modal.run; S.ui.modal = null; f(); render(); };
