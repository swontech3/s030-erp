/* S05-01 이번 달 할 일 · S05-02 자료 올리기(삐용 경비 포함) · S05-04 은행 짝 맞추기 */

/* ═════════ S05-01 이번 달 할 일 (s050000010) ═════════ */
/* 단계 숫자 = 그 화면 칩·배지의 숫자(그 화면에서 처리할 줄 수). 실제는 서버 한 곳에서 셉니다 */
function stepRows() {
  const c = counts(), bankUp = kindFiles("bank").length > 0;
  return [
    { s: "upload", nm: "자료 올리기", ds: `이번 달 자료 ${c.total}종 (삐용 경비 포함)`,
      st: c.upLeft === 0 ? "done" : c.up ? "doing" : "todo", c: `${c.up}종 올림${c.none ? ` · ${c.none}종 없음` : ""} · ${c.upLeft}종 남음` },
    /* 직원 급여 확인 — 숫자 = 직원 급여 화면 배지(4대보험 자료에 없는 정규직 수). 저장 전이면 「저장 전」 */
    { s: "emp", nm: "직원 급여 확인", ds: "이번 달 직원 급여 저장 · 4대보험 자료와 맞는지",
      st: !S.empSaved ? "todo" : empMiss() ? "doing" : "done", c: !S.empSaved ? "저장 전" : empMiss() ? `4대보험 자료에 없음 ${empMiss()}명` : "모두 맞음" },
    { s: "match", nm: "은행 짝 맞추기", ds: "통장 입출금을 다른 자료와 연결",
      st: !bankUp ? "todo" : c.cand ? "doing" : "done", c: !bankUp ? "은행 자료 필요" : c.cand ? `확인할 줄 ${c.cand}줄` : "모두 확인함" },
    { s: "classify", nm: "거래 분류", ds: "짝이 없는 줄에 항목 붙이기",
      st: c.clsLeft === 0 ? "done" : c.clsLeft < c.clsTotal ? "doing" : "todo", c: c.clsLeft ? `${c.clsLeft}줄 남음` : "모두 붙임" },
    { s: "wh", nm: "원천세 신고자료", ds: "급여·외주비에서 뗀 세금 신고 준비",
      st: S.settings.halfYear ? "view" : S.wh.made ? "done" : "todo", c: S.settings.halfYear ? `반기납부 · ${Number(S.month.slice(5)) <= 6 ? 6 : 12}월 직원 급여 저장 뒤 만듦` : S.wh.made ? `${S.wh.at} 만듦` : `마감 D-${dday("2026-10-10")}` },
    { s: "pl", nm: "손익·부가세 확인", ds: "보기만 하는 화면 — 분류가 끝날수록 정확해집니다", st: "view", c: c.clsLeft ? `분류 남은 ${c.clsLeft}줄 빠져 있음` : "모두 반영됨" },
    { s: "send", nm: "세무사 전달", ds: "정리본을 세무사 메일로 보냅니다",
      st: S.sends.length ? (S.changed ? "doing" : "done") : "todo", c: S.sends.length ? (S.changed ? "보낸 뒤 바뀐 자료 있음" : S.sends[0].at + " 보냄") : "아직 안 보냄" },
  ].map((r, i) => ({ ...r, no: i + 1 }));
}
/* 지난 달 · 이번 달(달력) — 같은 화면에서 달만 바꿔 그 달 상태를 보여 줍니다 (시안은 흉내 낸 값) */
function simRows(past) {
  const nx = Number(S.month.slice(5)) + 1;
  return [["upload", "자료 올리기", "이번 달 자료 9종 (삐용 경비 포함)"], ["emp", "직원 급여 확인", "이번 달 직원 급여 저장 · 4대보험 자료와 맞는지"], ["match", "은행 짝 맞추기", "통장 입출금을 다른 자료와 연결"], ["classify", "거래 분류", "짝이 없는 줄에 항목 붙이기"],
    ["wh", "원천세 신고자료", "급여·외주비에서 뗀 세금 신고 준비"], ["pl", "손익·부가세 확인", "보기만 하는 화면 — 분류가 끝날수록 정확해집니다"], ["send", "세무사 전달", "정리본을 세무사 메일로 보냅니다"]]
    .map(([s, nm, ds], i) => ({ s, nm, ds, no: i + 1, st: s === "pl" ? "view" : past ? "done" : "todo",
      c: s === "pl" ? (past ? "모두 반영됨" : "아직 자료 없음") : past ? (s === "send" ? `${nx}.03 보냄` : "끝남") : "달이 끝난 뒤 시작" }));
}
SCREENS.home = () => {
  const cur = S.month === D.DEFAULT_MONTH, past = S.month < D.DEFAULT_MONTH, ms = mShort(S.month);
  const rows = cur ? stepRows() : simRows(past);
  const nowStep = cur ? rows.find((r) => r.st === "todo" || r.st === "doing") : null;
  const c = counts(), pl = D.pl[S.month];
  const dl = deadlines().map((d) => {
    const n = dday(d.d);
    return `<div class="card dl"><div class="d ${n <= 7 ? "urgent" : ""}"><span>D-${n}</span><b>${Number(d.d.slice(5, 7))}.${Number(d.d.slice(8))}</b></div><div style="min-width:0"><div class="t">${d.t}</div><div class="s">${d.s}</div></div></div>`;
  }).join("");
  const desc = cur ? (nowStep ? `위에서부터 차례로 하면 ${ms} 정리가 끝납니다. 지금 할 일은 <b style="color:var(--text-heading)">${nowStep.no}. ${nowStep.nm}</b>입니다.` : `${ms} 정리를 모두 마쳤습니다.`)
    : past ? `${ms} 정리를 모두 마치고 세무사에게 보냈습니다.` : `${ms} 자료는 달이 끝난 뒤 정리합니다. 통장·카드 내역이 아직 쌓이는 중입니다.`;
  const kv = (v, hl) => `<div class="v"${hl ? ' style="color:var(--color-primary)"' : ""}>${pl ? won(v) + "<small> 원</small>" : "—"}</div>`;
  return ctx() +
    head(`${ms} 세무 정리`, desc) +
    `<div><div class="sec-t" style="margin-bottom:10px">다가오는 마감</div><div class="grid2">${dl}</div></div>
    <div class="card"><div class="steps">${rows.map((r) => `
      <div class="step ${r.st === "done" ? "is-done" : r === nowStep ? "is-doing" : ""}" data-act="go" data-s="${r.s}" role="button" tabindex="0" title="${r.nm} 화면으로">
        <span class="no">${r.st === "done" ? ic("check", 16) : r.no}</span>
        <div style="min-width:0"><div class="nm">${r.nm}</div><div class="ds">${r.ds}</div></div>
        <div class="st">${stBadge(r.st)}<span class="c">${r.c}</span></div>
        <span class="go">${ic("chevron-right", 18)}</span>
      </div>`).join("")}</div></div>
    <div><div class="between" style="margin-bottom:10px"><div class="sec-t">${ms} 숫자 요약</div><span class="sm">${cur && c.clsLeft ? `분류 남은 ${c.clsLeft}줄은 아직 빠져 있습니다` : ""}</span></div>
      <div class="grid3"><div class="card kpi"><div class="k">번 돈 (매출)</div>${kv(pl && pl[0])}</div>
      <div class="card kpi"><div class="k">쓴 돈 (비용)</div>${kv(pl && pl[1])}</div>
      <div class="card kpi"><div class="k">남은 돈 (이익)</div>${kv(pl && pl[0] - pl[1], true)}</div></div></div>
    <div class="card card-pad row" style="gap:12px"><span class="row"><button class="btn btn--sm" data-act="go" data-s="vendors">${ic("building-2", 14)}거래처</button><button class="btn btn--sm" data-act="go" data-s="settings">${ic("settings", 14)}세무 설정</button></span><span class="help">거래처 정리와 세무 설정은 순서와 상관없이 언제든 엽니다.</span></div>`;
};

/* ═════════ S05-02 자료 올리기 ═════════ */
SCREENS.upload = () => {
  if (S.month !== D.DEFAULT_MONTH) return ctx() + head("자료 올리기") + notSep();
  const c = counts();
  const cards = D.KINDS.map((k) => {
    const fs = kindFiles(k.id), unused = S.settings.unused.includes(k.id), none = S.noneKinds.includes(k.id);
    const st = fs.length ? `<span class="badge b-done">${fs.length}개 파일</span>` : unused ? `<span class="badge b-gray">쓰지 않는 자료</span>` : none ? `<span class="badge b-gray">이번 달 없음</span>` : `<span class="badge b-todo">아직</span>`;
    const sub = fs.length ? "" : unused ? `<button class="btn btn--link" style="font-size:12px" data-act="go" data-s="settings">세무 설정</button>` : none ? `<button class="btn btn--link" style="font-size:12px" data-act="kind-none" data-k="${k.id}">되돌리기</button>` : `<button class="btn btn--link" style="font-size:12px;color:var(--text-muted)" data-act="kind-none" data-k="${k.id}">이번 달 없음</button>`;
    return `<div class="card kind ${fs.length ? "is-up" : ""}"><span class="ic">${ic(k.icon, 18)}</span><div><div class="nm">${k.name}</div><div class="ds">${k.desc}</div></div>
      <div class="ft"><span class="row" style="gap:6px">${st}${sub}</span><button class="btn btn--sm" data-act="up-open" data-k="${k.id}">${ic("upload", 14)}올리기</button></div></div>`;
  }).join("");
  const list = [...S.files.map((f) => {
    const k = D.KINDS.find((x) => x.id === f.kind);
    const on = S.ui.fsel.includes(f.id);
    return { at: f.at, h: `<tr class="clickable ${on ? "pick" : ""}" data-act="f-sel" data-id="${f.id}"><td><input type="checkbox" class="rowchk" ${on ? "checked" : ""} aria-label="선택"></td><td>${k.name}</td><td class="mut ell">${f.org || "—"}</td><td class="ell" title="${esc(f.name)}">${esc(f.name)}</td><td class="num">${won(f.rows)}</td><td class="mut tnum">${f.at}</td></tr>` };
  }), ...ppRow()].sort((x, y) => (x.at < y.at ? 1 : -1)).map((x) => x.h).join("");
  return ctx() +
    head("자료 올리기", "9월 자료를 엑셀로 올립니다. 은행·카드는 기관을 고르면 시스템 표준양식으로 바뀝니다. 날짜가 다른 달인 줄은 그 달로 들어갑니다.",
      `<span class="badge ${c.upLeft ? "b-doing" : "b-done"}">${c.up}종 올림 · ${c.upLeft}종 남음</span>`) +
    `<div class="note">${ic("info")}<span>이번 달에만 없는 자료는 <b>「이번 달 없음」</b>을 누르세요 — 그 달에만 적용되고 다음 달로 이어지지 않습니다. 매달 없는 자료(예: 대출이 없는 회사의 대출 내역)는 <button class="btn btn--link" style="font-size:13px" data-act="go" data-s="settings">세무 설정</button>의 「우리 회사가 쓰지 않는 자료」로 고르면 매달 자동으로 「없음」이 됩니다.</span></div>
    <div class="grid4">${cards}${ppCard()}</div>
    <div class="card"><div class="card-pad card-h" style="padding-bottom:12px"><h2>올린 파일</h2><span class="sub">같은 파일은 다시 올릴 수 없습니다 · 파일을 지우면 그 파일로 맺은 짝이 풀립니다</span></div>
      <div class="tbar"><button class="btn btn--sm" data-act="f-view" ${S.ui.fsel.length === 1 ? "" : "disabled"}>${ic("eye", 14)}보기</button><button class="btn btn--sm btn--danger" data-act="file-del" ${S.ui.fsel.some((x) => x !== "pp") ? "" : "disabled"}>${ic("trash-2", 14)}삭제${S.ui.fsel.filter((x) => x !== "pp").length ? ` (${S.ui.fsel.filter((x) => x !== "pp").length})` : ""}</button><span class="sm">${S.ui.fsel.length ? `${S.ui.fsel.length}개 선택` : "줄을 고르세요 · [보기]는 한 줄, 지우기는 여러 줄"}</span></div>
      <div class="tbl-wrap"><table class="tbl" style="border-top:1px solid var(--border)"><colgroup><col class="w-chk"><col style="width:150px"><col style="width:170px"><col><col style="width:64px"><col style="width:100px"></colgroup>
      <thead><tr><th></th><th>자료</th><th>기관 · 계좌</th><th>파일 이름</th><th class="num">줄</th><th>올린 때</th></tr></thead><tbody>${list || `<tr><td colspan="6" class="mut" style="text-align:center;padding:32px">아직 올린 파일이 없습니다</td></tr>`}</tbody></table></div></div>` +
    next("upload", c.upLeft ? `아직 ${c.upLeft}종이 남았지만 다음 단계로 넘어가도 됩니다` : "자료를 모두 올렸습니다");
};
ACT["kind-none"] = (d) => { const i = S.noneKinds.indexOf(d.k); i < 0 ? S.noneKinds.push(d.k) : S.noneKinds.splice(i, 1); render(); };
ACT["f-sel"] = (d) => { const s = S.ui.fsel, i = s.indexOf(d.id); i < 0 ? s.push(d.id) : s.splice(i, 1); render(); };
ACT["file-del"] = () => {
  const fs = S.files.filter((x) => S.ui.fsel.includes(x.id));
  if (!fs.length) return;
  const rows = fs.reduce((n, f) => n + f.rows, 0), pairs = fs.reduce((n, f) => n + f.pairs, 0);
  modal({ type: "confirm", red: true, icon: "trash-2", title: fs.length > 1 ? `파일 ${fs.length}개를 지우시겠습니까?` : "이 파일을 지우시겠습니까?", ok: "삭제",
    body: `${fs.map((f) => `<b>${esc(f.name)}</b>`).join("<br>")}<br>${won(rows)}줄이 빠지고, 이 파일로 맺은 짝 ${pairs}건이 풀립니다. 풀린 은행 줄은 다시 「짝 없음」이 됩니다.`,
    run: () => { S.files = S.files.filter((x) => !S.ui.fsel.includes(x.id)); S.ui.fsel = []; touched(); toast(`파일을 지웠습니다 · 짝 ${pairs}건 풀림`); } });
};

/* 업로드 모달 */
const PREVIEW = [["09.24", "쿠팡(주)", 420000], ["09.25", "스타벅스 강남R점", 54000], ["09.26", "다이소 강남점", 18400], ["09.29", "카카오T", 23400], ["09.30", "GS25 삼성점", 6800]];
const PREVIEW_CARD = [["08.28", "09.15", "9월", "쿠팡(주)", 420000], ["08.29", "09.15", "9월", "스타벅스 강남R점", 54000], ["08.30", "09.15", "9월", "다이소 강남점", 18400], ["08.31", "09.15", "9월", "카카오T", 23400], ["09.01", "10.15", "10월", "GS25 삼성점", 6800]];
const DUPS = [{ date: "09.24", desc: "쿠팡(주)", amt: 420000 }, { date: "09.25", desc: "스타벅스 강남R점", amt: 54000 }];
ACT["up-open"] = (d) => {
  const k = D.KINDS.find((x) => x.id === d.k);
  const org = k.org === "bank" ? D.BANKS[0] : k.org === "card" ? D.CARDCOS[0] : "";
  modal({ type: "up", kind: d.k, org, acc: "", picked: null, dup: {} });
  pickAcc();
};
function pickAcc() {
  const m = S.ui.modal, k = D.KINDS.find((x) => x.id === m.kind);
  const list = k.org === "bank" ? S.settings.accounts.filter((a) => a.bank === m.org && !a.off) : k.org === "card" ? S.settings.cards.filter((c) => c.co === m.org && !c.off) : [];
  m.acc = list[0] ? list[0].id : "";
  render();
}
MODALS.up = (m) => {
  const k = D.KINDS.find((x) => x.id === m.kind);
  const orgs = k.org === "bank" ? D.BANKS : k.org === "card" ? D.CARDCOS : null;
  const accs = k.org === "bank" ? S.settings.accounts.filter((a) => a.bank === m.org && !a.off) : k.org === "card" ? S.settings.cards.filter((c) => c.co === m.org && !c.off) : [];
  const decided = DUPS.every((_, i) => m.dup[i]);
  const keep = DUPS.filter((_, i) => m.dup[i] === "in").length;
  const exist = kindFiles(m.kind)[0];
  return `<div class="modal modal--lg" role="dialog" aria-modal="true"><div class="m-h"><div><h3>자료 올리기</h3><p>${k.desc}</p></div><button class="icon-btn" data-act="close" aria-label="닫기">${ic("x", 20)}</button></div>
  <div class="m-b">
    <div class="grid3">
      <label class="field"><span class="lab">자료 종류</span><select class="select" data-chg="up-kind">${D.KINDS.map((x) => `<option value="${x.id}" ${x.id === m.kind ? "selected" : ""}>${x.name}</option>`).join("")}</select></label>
      ${orgs ? `<label class="field"><span class="lab">${k.org === "bank" ? "은행" : "카드사"}</span><select class="select" data-chg="up-org">${orgs.map((o) => `<option ${o === m.org ? "selected" : ""}>${o}</option>`).join("")}</select></label>
      <label class="field"><span class="lab">${k.org === "bank" ? "계좌" : "카드"}</span>${accs.length ? `<select class="select" data-chg="up-acc">${accs.map((a) => `<option value="${a.id}" ${a.id === m.acc ? "selected" : ""}>${a.alias} · ${a.no || "끝 " + a.last4}</option>`).join("")}</select>` : `<span class="sm" style="line-height:40px">등록된 ${k.org === "bank" ? "계좌" : "카드"}가 없습니다 · <button class="btn--link btn" style="font-size:12px" data-act="go" data-s="settings">세무 설정에서 추가</button></span>`}</label>` : ""}
    </div>
    <div class="drop">${ic("file-spreadsheet", 28, "color:var(--text-caption)")}<div style="font-size:14px;color:var(--text-heading);font-weight:700">엑셀 파일을 끌어다 놓거나 고르세요</div><div class="sm">.xlsx · .xls · 한 번에 한 파일</div>
      <div class="row" style="justify-content:center"><button class="btn btn--sm" data-act="up-pick" data-p="new" ${orgs && !accs.length ? "disabled" : ""}>파일 고르기</button>${exist ? `<button class="btn btn--sm" data-act="up-pick" data-p="dup" style="color:var(--text-muted)">이미 올린 파일 고르기 (확인용)</button>` : ""}</div></div>
    ${m.picked === "dup" ? `<div class="note note--danger">${ic("circle-alert")}<span><b>이미 올린 파일입니다.</b> ${esc(exist.name)} — ${exist.at}에 올렸습니다. 같은 파일은 다시 올릴 수 없습니다. 고친 파일이면 올린 파일을 먼저 지우세요.</span></div>` : ""}
    ${m.picked === "new" ? `
      <div class="between"><div class="sec-t">표준양식으로 바꾼 결과</div><span class="row"><span class="badge b-todo">전체 14줄</span><span class="badge b-done">9월 12줄</span><span class="badge b-todo">10월 2줄 → 10월에 넣음</span></span></div>
      ${m.kind === "card" ? `<div class="card"><table class="tbl"><colgroup><col style="width:92px"><col style="width:92px"><col style="width:80px"><col><col style="width:130px"></colgroup><thead><tr><th>사용일자</th><th>결제일</th><th>적용월</th><th>가맹점</th><th class="num">금액</th></tr></thead>
      <tbody>${PREVIEW_CARD.map((r) => `<tr><td class="tnum">${r[0]}</td><td class="tnum mut">${r[1]}</td><td class="mut">${r[2]}</td><td>${r[3]}</td><td class="num">${won(r[4])}</td></tr>`).join("")}<tr><td colspan="5" class="sm" style="text-align:center">사용일자 = 비용·부가세를 잡는 날 · 결제일 = 카드대금 출금과 짝 맞출 때 · 적용월 = 어느 달 청구에 묶이는지</td></tr></tbody></table></div>`
      : `<div class="card"><table class="tbl"><colgroup><col style="width:90px"><col><col style="width:140px"></colgroup><thead><tr><th>날짜</th><th>내용</th><th class="num">금액</th></tr></thead>
      <tbody>${PREVIEW.map((r) => `<tr><td class="tnum">${r[0]}</td><td>${r[1]}</td><td class="num">${won(r[2])}</td></tr>`).join("")}<tr><td colspan="3" class="sm" style="text-align:center">… 앞 5줄만 보여 줍니다</td></tr></tbody></table></div>`}
      <div><div class="between"><div class="sec-t">중복 의심 ${DUPS.length}건 — 직접 골라 주세요</div><span class="sm">같은 날 같은 금액의 정상 거래일 수 있어 자동으로 빼지 않습니다</span></div>
      <div class="card" style="margin-top:10px"><table class="tbl"><colgroup><col style="width:90px"><col><col style="width:120px"><col style="width:200px"></colgroup><thead><tr><th>날짜</th><th>내용</th><th class="num">금액</th><th>처리</th></tr></thead>
      <tbody>${DUPS.map((r, i) => `<tr><td class="tnum">${r.date}</td><td>${r.desc}<div class="sm">이미 올린 줄과 날짜·내용·금액이 같습니다</div></td><td class="num">${won(r.amt)}</td>
        <td><span class="row" style="gap:14px"><label class="chk"><input type="radio" name="dup${i}" data-chg="up-dup" data-i="${i}" value="in" ${m.dup[i] === "in" ? "checked" : ""}>넣기</label><label class="chk"><input type="radio" name="dup${i}" data-chg="up-dup" data-i="${i}" value="out" ${m.dup[i] === "out" ? "checked" : ""}>빼기</label></span></td></tr>`).join("")}</tbody></table></div></div>` : ""}
  </div>
  <div class="m-f">${m.picked === "new" && !decided ? `<span class="sm">중복 의심 줄을 모두 골라야 올릴 수 있습니다</span>` : ""}<span class="sp"></span><button class="btn" data-act="close">취소</button>
    <button class="btn btn--primary" data-act="up-ok" ${m.picked === "new" && decided ? "" : "disabled"}>${m.picked === "new" && decided ? `${12 - (DUPS.length - keep)}줄 올리기` : "올리기"}</button></div></div>`;
};
CHG["up-kind"] = (d, el) => { const m = S.ui.modal, k = D.KINDS.find((x) => x.id === el.value); m.kind = el.value; m.org = k.org === "bank" ? D.BANKS[0] : k.org === "card" ? D.CARDCOS[0] : ""; m.picked = null; m.dup = {}; pickAcc(); };
CHG["up-org"] = (d, el) => { S.ui.modal.org = el.value; S.ui.modal.picked = null; pickAcc(); };
CHG["up-acc"] = (d, el) => { S.ui.modal.acc = el.value; };
CHG["up-dup"] = (d, el) => { S.ui.modal.dup[d.i] = el.value; render(); };
ACT["up-pick"] = (d) => { S.ui.modal.picked = d.p; S.ui.modal.dup = {}; render(); };
ACT["up-ok"] = () => {
  const m = S.ui.modal, k = D.KINDS.find((x) => x.id === m.kind);
  const a = [...S.settings.accounts, ...S.settings.cards].find((x) => x.id === m.acc);
  const keep = DUPS.filter((_, i) => m.dup[i] === "in").length;
  S.files.push({ id: "f" + Date.now(), kind: m.kind, org: a ? m.org + " · " + a.alias : "", name: k.name.replace(/[·\s]/g, "") + "_추가_202609.xlsx", rows: 12 - (DUPS.length - keep), at: "10.06 지금", pairs: 0 });
  S.noneKinds = S.noneKinds.filter((x) => x !== m.kind);
  touched();
  S.ui.modal = null; render();
  toast(`올렸습니다 · 9월 ${12 - (DUPS.length - keep)}줄, 10월 2줄`);
};

/* ═════════ 삐용 경비 — 자료 올리기(S05-02) 안의 카드로 합침 ═════════ */
const ppCard = () => `<div class="card kind ${S.ppLast ? "is-up" : ""}"><span class="ic">${ic("inbox", 18)}</span><div><div class="nm">삐용 경비</div><div class="ds">결재 완료된 경비만 가져옵니다 · 이미 가져온 건은 건너뜁니다 · 삐용에서 취소되면 거래 분류에 표시됩니다</div></div>
  <div class="sm">${S.ppLast ? `마지막으로 가져온 때 ${S.ppLast} · ${S.ppiyong.length}건` : "아직 가져오지 않았습니다"}</div>
  <div class="ft"><span class="row" style="gap:6px">${S.ppLast ? `<span class="badge b-done">${S.ppiyong.length}건</span>` : `<span class="badge b-todo">아직</span>`}</span><button class="btn btn--sm" data-act="pp-import">${ic("refresh-cw", 14)}가져오기</button></div></div>`;
/* 올린 파일 목록의 「삐용 경비」 한 줄 — 건수 · 가져온 때만. 지울 수 없음 */
const ppRow = () => (S.ppLast ? [{ at: S.ppLast, h: `<tr class="clickable ${S.ui.fsel.includes("pp") ? "pick" : ""}" data-act="f-sel" data-id="pp" title="삐용 경비는 지울 수 없습니다 — 다시 가져오면 갱신됩니다"><td><input type="checkbox" class="rowchk" ${S.ui.fsel.includes("pp") ? "checked" : ""} aria-label="선택 ([보기]만)"></td><td>삐용 경비</td><td class="mut ell">삐용</td><td class="ell">결재 완료 경비 (사용일 9월)</td><td class="num">${S.ppiyong.length}</td><td class="mut tnum">${S.ppLast}</td></tr>` }] : []);
ACT["pp-import"] = () => {
  let nw = 0;
  if (!S.ppiyong.find((e) => e.id === "e6")) { S.ppiyong.push({ id: "e6", date: "09.30", who: "정하늘", desc: "사무용품 (개인 돈)", amt: 27000, pay: "own", link: "wait", st: "ok" }); nw = 1; }
  S.ppLast = "10.06 지금"; if (nw) touched(); render();
  toast(`가져왔습니다 · 새로 ${nw}건 · 바뀜 0건 · 취소됨 0건`);
};

/* ═════════ S05-04 은행 짝 맞추기 ═════════ */
/* 다른 달 자료와 맺은 짝은 달을 보여 줍니다 — 비용·수입은 원래 자료의 달에 잡힙니다 */
const diffOf = (b, c) => (b.in || b.out) - c.amt;
const diffText = (b, c) => {
  const df = diffOf(b, c);
  if (!df || c.nodoc) return "";
  return Math.abs(df) <= D.FEE_LIMIT
    ? `<div class="diff">금액 차이 ${won(Math.abs(df))}원 — 확정하면 차이를 「수수료」로 남깁니다${c.note ? " · " + c.note : ""}</div>`
    : `<div class="diff">금액 차이 ${won(Math.abs(df))}원 — 기준 ${won(D.FEE_LIMIT)}원을 넘습니다. 확정할 때 나눠서 낸 것인지 고릅니다${c.note ? " · " + c.note : ""}</div>`;
};
const monTag = (p) => (p && p.mon && p.mon !== 9 ? ` <span class="badge b-todo b-sm">${p.mon}월 자료와 짝</span>` : "");
const pairLine = (p) => `<div class="sm">${D.PAIR_KINDS[p.kind]}${monTag(p)}</div><div class="ell" title="${esc(p.label)}">${esc(p.label)}</div>`;
/* 목록 위 버튼 — 고른 줄(하나)의 상태에 맞는 버튼만 켜짐 */
function mBar() {
  const b = S.bank.find((x) => x.id === S.ui.msel);
  const st = b ? b.state : "", id = b ? b.id : "";
  const part = !!(b && b.pair && b.pair.partial && b.pair.partial.side === "bank" && !b.pair.partial.sent);
  const canFind = st === "cand" || st === "none", canRel = st === "auto" || st === "done";
  return `<div class="tbar"><button class="btn btn--sm btn--primary" data-act="m-open" data-id="${id}" ${canFind ? "" : "disabled"}>${st === "none" ? "짝 찾기" : "짝 확인"}</button><button class="btn btn--sm" data-act="m-release" data-id="${id}" ${canRel ? "" : "disabled"}>해제</button><button class="btn btn--sm" data-act="m-open" data-id="${id}" ${part ? "" : "disabled"}>남은 금액 처리</button>
    <span class="sm">${b ? `고른 줄 · ${b.date} ${esc(b.desc)}` : "줄을 하나 고르세요"}</span></div>`;
}
SCREENS.match = () => {
  if (S.month !== D.DEFAULT_MONTH) return ctx() + head("은행 짝 맞추기") + notSep();
  const u = S.ui;
  const accs = S.settings.accounts.filter((a) => S.bank.some((b) => b.acc === a.id));
  if (!accs.find((a) => a.id === u.acc) && accs[0]) u.acc = accs[0].id;
  const rows = S.bank.filter((b) => b.acc === u.acc);
  const n = (f) => rows.filter(f).length;
  /* 「확인 필요」 = 이 화면에서 처리할 줄 — 후보 줄 + 은행 쪽 일부 짝(아직 안 넘김). 할 일 3단계와 같은 숫자 */
  const F = { all: () => true, cand: (b) => b.state === "cand" || !!(b.pair && b.pair.partial && b.pair.partial.side === "bank" && !b.pair.partial.sent), none: (b) => b.state === "none", done: (b) => b.state === "done" || b.state === "auto", auto: (b) => b.state === "auto" };
  const chips = [["all", "전체", n(F.all)], ["cand", "확인 필요", n(F.cand)], ["none", "짝 없음", n(F.none)], ["done", "짝 맞춤", n(F.done)], ["auto", "그중 자동", n(F.auto)]];
  const list = rows.filter(F[u.mf]).filter(perOk("match")).sort((x, y) => (x.date < y.date ? 1 : -1));   // 기본 날짜 최신순
  const body = list.map((b) => {
    const open = u.open === b.id;
    let pc, btn;
    if (b.state === "auto" || b.state === "done") {
      pc = `<div class="row" style="gap:6px;flex-wrap:nowrap;min-width:0"><div style="min-width:0">${pairLine(b.pair)}${b.pair.kind === "payroll" ? `<div class="sm">직원 · 달 기준 짝 · 금액 차이는 「세금 등 차이」</div>` : ""}${b.pair.fee ? `<div class="sm">차이 ${won(b.pair.fee)}원 → 수수료로 남김</div>` : ""}${b.pair.partial ? (b.pair.partial.sent ? `<div class="sm">이 은행 줄 남은 ${won(b.pair.partial.amt)}원 → 거래 분류로 넘김</div>` : `<div class="row" style="gap:6px;margin-top:2px"><span class="badge b-doing b-sm">일부 짝</span><span class="sm">${b.pair.partial.side === "doc" ? "계산서" : "이 은행 줄"} 남은 ${won(b.pair.partial.amt)}원 — 다른 ${b.pair.partial.side === "doc" ? "은행 줄과" : "자료와"} 짝</span></div>`) : ""}</div>${b.state === "auto" ? `<span class="badge b-line b-sm" title="금액·날짜·거래처가 모두 맞아 자동으로 확정했습니다">자동</span>` : ""}</div>`;
      btn = `<button class="btn btn--sm" data-act="m-release" data-id="${b.id}">해제</button>`;
    } else if (b.state === "cand") {
      pc = `<span class="badge b-doing">후보 ${b.cands.length}개</span><div class="sm ell" style="margin-top:4px">${esc(b.cands[0].label)}</div>`;
      btn = `<button class="btn btn--sm ${open ? "" : "btn--primary"}" data-act="m-open" data-id="${b.id}">${open ? "닫기" : "확인"}</button>`;
    } else {
      pc = `<span class="badge b-todo">짝 없음 → 거래 분류</span>${b.hint ? `<div class="sm" style="margin-top:4px">${b.hint}</div>` : ""}`;
      btn = `<button class="btn btn--sm" data-act="m-open" data-id="${b.id}">${open ? "닫기" : "짝 찾기"}</button>`;
    }
    const sel = u.msel === b.id;
    const tr = `<tr class="clickable ${sel ? "pick" : ""} ${open ? "is-open" : ""}" data-act="m-sel" data-id="${b.id}"><td><input type="radio" class="rowchk" name="msel" ${sel ? "checked" : ""} aria-label="선택"></td><td class="tnum">${b.date}</td><td class="ell" title="${esc(b.desc)}">${esc(b.desc)}</td><td class="num">${b.in ? won(b.in) : ""}</td><td class="num">${b.out ? won(b.out) : ""}</td><td>${pc}</td></tr>`;
    if (!open) return tr;
    if (b.state !== "cand" && b.state !== "none") {
      /* 일부 짝 — 은행 줄 쪽 남은 금액 */
      const p = b.pair.partial;
      return tr + `<tr class="sub"><td colspan="6"><div class="cands"><div class="card" style="padding:14px 16px;display:flex;flex-direction:column;gap:8px">
        <div style="font-size:14px;font-weight:700;color:var(--text-heading)">이 은행 줄에 ${won(p.amt)}원이 남았습니다</div>
        <span class="sm">다른 자료(계산서 등)와 짝을 더 맞추세요. 다 맞춘 뒤에도 남으면 남은 금액만 거래 분류로 넘깁니다 — 돈이 실제로 ${b.in ? "들어온" : "나간"} 것이라 짝 없는 ${b.in ? "입금" : "출금"}과 같습니다.</span></div>
        ${(b.restCands || []).length ? `<div class="sm">더 맞출 자료를 고르세요</div>${b.restCands.map((c, i) => `<label class="cand ${u.rpick[b.id] === i ? "on" : ""}"><input type="radio" name="rp-${b.id}" data-chg="m-rpick" data-id="${b.id}" data-i="${i}" ${u.rpick[b.id] === i ? "checked" : ""}><div style="min-width:0"><div class="k">${D.PAIR_KINDS[c.kind]}${monTag(c)}</div><div class="t ell">${esc(c.label)}</div>${c.amt !== p.amt ? `<div class="diff">맞추면 남는 금액 ${won(Math.abs(p.amt - c.amt))}원</div>` : ""}</div><span class="num" style="font-weight:700;color:var(--text-heading)">${won(c.amt)}원</span></label>`).join("")}` : ""}
        <div class="between"><span class="sm">${(b.restCands || []).length ? "" : "더 맞출 자료 후보가 없습니다"}</span><span class="row"><button class="btn btn--sm" data-act="m-open" data-id="${b.id}">닫기</button><button class="btn btn--sm" data-act="m-rest" data-id="${b.id}">남은 금액을 거래 분류로</button>${(b.restCands || []).length ? `<button class="btn btn--sm btn--primary" data-act="m-rok" data-id="${b.id}" ${u.rpick[b.id] != null ? "" : "disabled"}>짝 확정</button>` : ""}</span></div></div></td></tr>`;
    }
    const opts = b.state === "cand" ? b.cands : [
      ...(b.in ? [{ kind: "owner", label: "대표가 넣은 돈", amt: b.in, nodoc: true }] : []),
      { kind: "transfer", label: "내 계좌끼리 옮긴 돈 — 세무 설정에 등록한 계좌 사이", amt: b.in || b.out, nodoc: true },
    ];
    const pk = u.pick[b.id];
    const chosen = pk != null ? opts[pk] : null;
    const bdf = chosen && !chosen.nodoc ? diffOf(b, chosen) : 0;
    const big = Math.abs(bdf) > D.FEE_LIMIT, bc = u.big[b.id];
    return tr + `<tr class="sub"><td colspan="6"><div class="cands">
      ${b.state === "none" ? `<div class="sm">자료로 찾은 후보가 없습니다. 아래에 해당하면 고르고, 아니면 그대로 두세요 — 거래 분류에서 항목을 붙입니다.</div>` : ""}
      ${opts.map((c, i) => `<label class="cand ${pk === i ? "on" : ""}"><input type="radio" name="pk-${b.id}" data-chg="m-pick" data-id="${b.id}" data-i="${i}" ${pk === i ? "checked" : ""}>
        <div style="min-width:0"><div class="k">${D.PAIR_KINDS[c.kind]}${c.multi ? ` · ${c.multi}건 묶음` : ""}${monTag(c)}</div><div class="t ell">${esc(c.label)}</div>${diffText(b, c)}</div>
        <span class="num" style="font-weight:700;color:var(--text-heading)">${c.nodoc ? "" : won(c.amt) + "원"}</span></label>`).join("")}
      ${big ? `<div class="card" style="padding:14px 16px;display:flex;flex-direction:column;gap:10px"><div style="font-size:14px;font-weight:700;color:var(--text-heading)">금액 차이 ${won(Math.abs(bdf))}원 — 어떤 경우인가요?</div>
        <label class="chk"><input type="radio" name="big-${b.id}" data-chg="m-big" data-id="${b.id}" value="split" ${bc === "split" ? "checked" : ""}><span><b>나눠서 낸 것</b> <span class="sm">— 짝을 맺고, ${bdf < 0 ? "계산서의" : "이 은행 줄의"} 남은 ${won(Math.abs(bdf))}원은 다른 ${bdf < 0 ? "은행 줄과" : "자료와"} 짝을 맞춥니다</span></span></label>
        <label class="chk"><input type="radio" name="big-${b.id}" data-chg="m-big" data-id="${b.id}" value="no" ${bc === "no" ? "checked" : ""}><span><b>짝이 아님</b> <span class="sm">— 확정하지 않습니다</span></span></label>
        <span class="sm">남은 금액은 아직 안 낸 돈이라 비용이 아닙니다 — 비용은 이미 계산서로 잡혀 있습니다.</span></div>` : ""}
      <div class="between" style="margin-top:4px"><span class="sm">${chosen && !chosen.nodoc && bdf && !big ? "금액이 다른 짝은 자동으로 확정하지 않습니다. 맞는지 확인하고 확정하세요." : ""}</span>
        <span class="row"><button class="btn btn--sm" data-act="m-open" data-id="${b.id}">닫기</button><button class="btn btn--sm btn--primary" data-act="m-ok" data-id="${b.id}" ${chosen && (!big || bc) ? "" : "disabled"}>${big && bc === "no" ? "확정하지 않음" : "짝 확정"}</button></span></div>
    </div></td></tr>`;
  }).join("");
  const c = counts();
  return ctx() +
    head("은행 짝 맞추기", "통장에 찍힌 돈마다 무엇 때문에 오갔는지 다른 자료와 연결합니다. 짝이 없는 줄만 다음 단계(거래 분류)로 넘어갑니다.") +
    `<div class="note">${ic("info")}<span>금액·날짜(±3일)·거래처가 모두 맞으면 <b>자동으로 확정</b>하고 <span class="badge b-line b-sm">자동</span> 표시를 합니다. 잘못 맺어졌으면 [해제]하세요. 카드대금 출금은 <b>결제일</b>로 찾고, <b>적용월이 같은 카드 줄의 청구 합계</b>와 짝을 맞추며, 비용은 카드 사용 내역으로 잡습니다.<br>금액 차이가 <b>${won(D.FEE_LIMIT)}원 이하</b>면 확정할 때 차이를 「수수료」로 남깁니다. 넘으면 확정할 때 「나눠서 낸 것」(일부 짝)인지 「짝이 아님」인지 고릅니다.<br>짝 후보는 이 통장 줄의 달 <b>앞뒤 2개월</b>(7~11월) 자료에서 찾습니다. 다른 달 자료와 맺어도 비용·수입은 원래 자료의 달에 잡히고, 은행 줄은 9월에서 「짝 있음」이 됩니다.</span></div>
    ${u.mfile ? fileBand(u.mfile, rows.length, "m-allfile") : ""}<div class="card"><div class="tabs" style="padding:0 16px">${accs.map((a) => `<button class="tab ${a.id === u.acc ? "on" : ""}" data-act="m-acc" data-id="${a.id}">${a.bank} · ${a.alias}</button>`).join("")}</div>
      <div class="card-pad" style="padding-top:14px;padding-bottom:14px"><div class="chips">${chips.map(([k, l, v]) => `<button class="chip ${u.mf === k ? "on" : ""}" data-act="m-filter" data-f="${k}">${l} <b>${v}</b></button>`).join("")}</div></div>
      <div class="tbar" style="border-top:1px solid var(--border)">${xlsBtn("은행 짝 맞추기 · " + accName(u.acc), list.length)}${perBar("match")}<span class="sm">지금 걸린 거르기 결과만 내려받습니다</span></div>
      ${mBar()}
      <table class="tbl" style="border-top:1px solid var(--border)"><colgroup><col class="w-chk"><col style="width:68px"><col style="width:170px"><col style="width:112px"><col style="width:112px"><col></colgroup>
      <thead><tr><th></th><th>날짜</th><th>내용</th><th class="num">입금</th><th class="num">출금</th><th>짝</th></tr></thead><tbody>${body || `<tr><td colspan="6" class="mut" style="text-align:center;padding:32px">해당하는 줄이 없습니다</td></tr>`}</tbody></table></div>` +
    next("match", c.cand ? `확인할 줄 ${c.cand}줄이 남았습니다 · 짝 없는 줄은 다음 단계에서 항목을 붙입니다` : "모두 확인했습니다");
};
ACT["m-acc"] = (d) => { S.ui.mfile = null; S.ui.acc = d.id; S.ui.open = null; S.ui.msel = null; render(); };
ACT["m-filter"] = (d) => { S.ui.mf = d.f; S.ui.open = null; S.ui.msel = null; render(); };
ACT["m-sel"] = (d) => { if (S.ui.open && S.ui.open !== d.id) S.ui.open = null; S.ui.msel = d.id; render(); };
ACT["m-open"] = (d) => { S.ui.open = S.ui.open === d.id ? null : d.id; render(); };
CHG["m-pick"] = (d) => { S.ui.pick[d.id] = Number(d.i); delete S.ui.big[d.id]; render(); };
CHG["m-big"] = (d, el) => { S.ui.big[d.id] = el.value; render(); };
ACT["m-ok"] = (d) => {
  const b = S.bank.find((x) => x.id === d.id), i = S.ui.pick[d.id];
  if (S.ui.big[d.id] === "no") { delete S.ui.pick[d.id]; delete S.ui.big[d.id]; S.ui.open = null; render(); toast("확정하지 않았습니다 · 후보로 남겨 둡니다"); return; }
  const opts = b.state === "cand" ? b.cands : [...(b.in ? [{ kind: "owner", label: "대표가 넣은 돈", amt: b.in, nodoc: true }] : []), { kind: "transfer", label: "내 계좌끼리 옮긴 돈", amt: b.in || b.out, nodoc: true }];
  b.pair = { ...opts[i] }; b.prev = b.state === "cand" ? b.cands : null; b.state = "done";
  const df = b.pair.nodoc ? 0 : diffOf(b, b.pair);
  S.fees = S.fees.filter((x) => x.id !== b.id);
  /* 1만 원 이하 → 수수료 / 넘으면 「나눠서 낸 것」으로 고른 경우만 여기 옴 → 일부 짝. 남은 금액은 비용이 아님 */
  if (df && Math.abs(df) <= D.FEE_LIMIT) { b.pair.fee = Math.abs(df); S.fees.push({ id: b.id, amt: Math.abs(df) }); }
  else if (df) b.pair.partial = { side: df < 0 ? "doc" : "bank", amt: Math.abs(df) };
  delete S.ui.big[b.id];
  delete S.cls[b.id]; delete S.ui.pick[b.id]; S.ui.open = null; touched(); render(); toast("짝을 확정했습니다");
};
/* 은행 줄 쪽 남은 금액 — 같은 펼침 안에서 자료를 더 골라 짝을 이어 맞춤 */
CHG["m-rpick"] = (d) => { S.ui.rpick[d.id] = Number(d.i); render(); };
ACT["m-rok"] = (d) => {
  const b = S.bank.find((x) => x.id === d.id), i = S.ui.rpick[d.id], c = b.restCands[i], p = b.pair.partial;
  p.amt -= c.amt; b.restCands.splice(i, 1); delete S.ui.rpick[d.id];
  b.pair.label += " + " + (c.label.split(" · ")[1] || c.label);
  if (p.amt <= 0) { delete b.pair.partial; S.ui.open = null; }
  touched(); render(); toast(p.amt > 0 ? `짝을 더 맞췄습니다 · 남은 ${won(p.amt)}원` : "짝을 다 맞췄습니다");
};
ACT["m-rest"] = (d) => {
  const b = S.bank.find((x) => x.id === d.id), p = b.pair.partial;
  p.sent = true;
  S.rest.push({ id: "r-" + b.id, of: b.id, acc: b.acc, date: b.date, desc: b.desc + " · 짝 남은 금액", amt: p.amt, dir: b.in ? "in" : "out" });
  S.ui.open = null; touched(); render(); toast("남은 금액을 거래 분류로 넘겼습니다");
};
ACT["m-release"] = (d) => {
  const b = S.bank.find((x) => x.id === d.id);
  b.cands = b.prev || [b.pair]; b.state = "cand"; b.pair = null;
  S.fees = S.fees.filter((x) => x.id !== b.id); S.rest = S.rest.filter((x) => x.of !== b.id); delete S.cls["r-" + b.id]; touched(); render(); toast("짝을 풀었습니다 · 후보로 돌아갑니다");
};
