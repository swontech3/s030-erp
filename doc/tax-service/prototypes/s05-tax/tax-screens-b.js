/* S05-05 거래 분류 · S05-06 거래처 · S05-07 원천세 · S05-08 월별 손익 · S05-09 부가세 · S05-10 세무사 전달 · S05-11 세무 설정 */

/* ═════════ S05-05 거래 분류 ═════════ */
SCREENS.classify = () => {
  if (S.month !== D.DEFAULT_MONTH) return ctx() + head("거래 분류") + notSep();
  const u = S.ui, all = clsTargets(), c = counts();
  const list = (u.cf === "all" ? all : all.filter((t) => !clsDone(t.id))).sort((x, y) => (x.date < y.date ? 1 : -1));   // 기본 날짜 최신순
  const nOut = items("out").length, nIn = items("in").length;
  const selDirs = [...new Set(all.filter((t) => u.csel.includes(t.id)).map((t) => t.dir))];
  const selT = all.filter((t) => u.csel.includes(t.id));
  const nOk = selT.filter((t) => !clsDone(t.id) && ((S.cls[t.id] && S.cls[t.id].item) || D.MEMORY[t.desc])).length;
  const nUndo = selT.filter((t) => clsDone(t.id)).length;
  const opt = (sel, dir) => `<option value="">${dir === "in" ? "입금 항목 고르기" : "출금 항목 고르기"}</option>` + items(dir).map((i) => `<option value="${esc(i.v)}" ${i.v === sel ? "selected" : ""}>${i.v}${i.g ? " — " + i.g : ""}</option>`).join("");
  const rows = list.map((t) => {
    const cur = S.cls[t.id], val = cur ? cur.item : D.MEMORY[t.desc] || "", ok = clsDone(t.id), sug = !cur && D.MEMORY[t.desc];
    return `<tr class="clickable ${u.csel.includes(t.id) ? "pick" : ""}" data-act="c-row" data-id="${t.id}"><td><input type="checkbox" class="rowchk" ${u.csel.includes(t.id) ? "checked" : ""} aria-label="선택"></td>
      <td class="tnum">${t.date}</td><td class="mut ell">${t.src === "bank" ? accName(t.acc).split(" · ")[1] : t.src === "rest" ? "짝 남은 금액" : "현금 경비"}</td>
      <td><div class="ell" title="${esc(t.desc)}">${esc(t.desc)}</div>${t.hint ? `<div class="sm">${t.hint} · <button class="btn btn--link" style="font-size:12px" data-act="go" data-s="upload">자료 올리기</button></div>` : ""}</td>
      <td class="num">${t.dir === "in" ? "+" : ""}${won(t.amt)}</td>
      <td>${ok ? `<span style="font-weight:700">${esc(val)}</span>` : `<select class="select" style="width:100%;height:36px" data-chg="c-item" data-id="${t.id}">${opt(val, t.dir)}</select>${sug ? `<div class="sm" style="margin-top:3px">지난번 항목을 골라 두었습니다</div>` : ""}`}</td>
      </tr>`;
  }).join("");
  return ctx() +
    head("거래 분류", "짝 맞추기에서 짝이 없던 은행 줄, 은행 줄에 남은 금액(짝 남은 금액), 항목 칸이 빈 현금 경비에 항목을 붙입니다. 모르면 「잘 모름 — 세무사에게 묻기」를 고르세요.",
      `<span class="badge ${c.clsLeft ? "b-doing" : "b-done"}">${c.clsLeft}줄 남음 / ${c.clsTotal}줄</span>`) +
    `<div class="note">${ic("info")}<span>항목 목록은 공통 코드 표에서 불러옵니다 — 지금은 <b>${corp() ? "법인" : "개인 일반과세자"}용 출금 항목 ${nOut}개 · 입금 항목 ${nIn}개</b> — 입금 줄에는 입금 항목만, 출금 줄에는 출금 항목만 보입니다. ${corp() ? "「사업과 무관」은 세무사가 처리 방법을 정합니다." : "「사업과 무관」은 대표 인출로 처리합니다."} 같은 거래처는 지난번 항목을 골라 두지만, 확정은 직접 합니다.</span></div>
    <div class="card"><div class="card-pad between" style="padding-top:14px;padding-bottom:14px">
      <div class="chips"><button class="chip ${u.cf !== "all" ? "on" : ""}" data-act="c-filter" data-f="left">남은 줄 <b>${c.clsLeft}</b></button><button class="chip ${u.cf === "all" ? "on" : ""}" data-act="c-filter" data-f="all">모두 <b>${c.clsTotal}</b></button></div>
      </div>
      <div class="tbar"><button class="btn btn--sm btn--primary" data-act="c-ok" ${nOk ? "" : "disabled"}>확정${nOk ? ` (${nOk})` : ""}</button><button class="btn btn--sm" data-act="c-undo" ${nUndo ? "" : "disabled"}>고치기${nUndo ? ` (${nUndo})` : ""}</button><span class="tbar-sep"></span>
        ${u.csel.length && selDirs.length > 1 ? `<span class="sm" style="color:var(--color-warning-text)">입금 줄과 출금 줄을 함께 골랐습니다 — 한쪽만 골라야 한 번에 붙일 수 있습니다</span>` : u.csel.length ? `<select class="select" style="height:32px;width:220px" data-chg="c-bulk">${opt(u.cbulk, selDirs[0])}</select><button class="btn btn--sm" data-act="c-bulk-ok" ${u.cbulk ? "" : "disabled"}>선택한 줄에 붙이기</button><span class="sm">${u.csel.length}줄 선택</span>` : `<span class="sm">줄을 고르세요 · 여러 줄을 골라 한 번에 확정하거나 같은 항목을 붙일 수 있습니다</span>`}</div>
      <table class="tbl" style="border-top:1px solid var(--border)"><colgroup><col class="w-chk"><col style="width:64px"><col style="width:110px"><col><col style="width:110px"><col style="width:300px"></colgroup>
      <thead><tr><th></th><th>날짜</th><th>출처</th><th>내용</th><th class="num">금액</th><th>항목</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="mut" style="text-align:center;padding:32px">${ic("circle-check", 18, "vertical-align:-3px;color:var(--color-primary)")} 남은 줄이 없습니다</td></tr>`}</tbody></table></div>` +
    next("classify", c.clsLeft ? `남은 ${c.clsLeft}줄은 손익·부가세에서 빠진 채로 계산됩니다` : "모두 붙였습니다");
};
CHG["c-item"] = (d, el) => { S.cls[d.id] = { item: el.value, ok: false }; render(); };
CHG["c-sel"] = (d, el) => { const s = S.ui.csel; el.checked ? s.push(d.id) : s.splice(s.indexOf(d.id), 1); render(); };
CHG["c-bulk"] = (d, el) => { S.ui.cbulk = el.value; render(); };
ACT["c-filter"] = (d) => { S.ui.cf = d.f; render(); };
ACT["c-row"] = (d, e) => { if (e.target.closest("select, button, a")) return; const s = S.ui.csel, i = s.indexOf(d.id); i < 0 ? s.push(d.id) : s.splice(i, 1); render(); };
/* 고른 줄 중 항목이 골라진 줄만 확정. 항목이 없는 줄은 남겨 둡니다 */
ACT["c-ok"] = () => {
  const tg = clsTargets().filter((t) => S.ui.csel.includes(t.id) && !clsDone(t.id));
  let n = 0;
  tg.forEach((t) => { const v = (S.cls[t.id] && S.cls[t.id].item) || D.MEMORY[t.desc]; if (v) { S.cls[t.id] = { item: v, ok: true }; n++; } });
  const skip = tg.length - n;
  S.ui.csel = S.ui.csel.filter((id) => !clsDone(id)); touched(); render();
  toast(`${n}줄을 확정했습니다${skip ? ` · ${skip}줄은 항목이 없어 건너뜀` : ""}`);
};
ACT["c-undo"] = () => { S.ui.csel.forEach((id) => { if (clsDone(id)) S.cls[id].ok = false; }); render(); };
ACT["c-bulk-ok"] = () => { const v = S.ui.cbulk; S.ui.csel.forEach((id) => { S.cls[id] = { item: v, ok: true }; }); toast(`${S.ui.csel.length}줄에 「${v}」${jo(v, "을/를")} 붙였습니다`); S.ui.csel = []; S.ui.cbulk = ""; touched(); render(); };

/* ═════════ S05-06 거래처 ═════════ */
SCREENS.vendors = () => {
  const u = S.ui;
  const q = u.vq.trim();
  const list = S.vendors.filter((v) => (u.vf === "all" || (u.vf === "main" ? v.main : !v.main)) && (!q || v.name.includes(q) || v.biz.includes(q)));
  const dup = S.vendors.find((v) => v.dup && S.vendors.find((x) => x.id === v.dup));
  const nMain = S.vendors.filter((v) => v.main).length;
  return ctx(`거래처는 달과 상관없이 하나의 목록입니다 · 「${mShort(S.month)} 거래」는 작업할 달 기준`) +
    head("거래처", "자료를 올리면 거래처가 자동으로 생깁니다. 이름·사업자번호를 고치고, 같은 곳을 하나로 합치고, 자주 거래하는 곳을 주거래처로 표시합니다.") +
    (dup ? `<div class="note note--warn">${ic("copy")}<span style="flex:1"><b>사업자번호가 같은 거래처가 있습니다.</b> 「${esc(S.vendors.find((x) => x.id === dup.dup).name)}」 · 「${esc(dup.name)}」 — 같은 곳이면 하나로 합치세요.</span><button class="btn btn--sm" data-act="v-dupsel" data-a="${dup.dup}" data-b="${dup.id}">둘 다 고르기</button></div>` : "") +
    `<div class="card"><div class="card-pad between" style="padding-top:14px;padding-bottom:14px">
      <span class="row"><input class="input" id="v-q" style="width:240px" placeholder="거래처명 · 사업자번호" value="${esc(u.vq)}" data-inp="v-q">
        <span class="chips"><button class="chip ${u.vf === "all" ? "on" : ""}" data-act="v-f" data-f="all">전체 <b>${S.vendors.length}</b></button><button class="chip ${u.vf === "main" ? "on" : ""}" data-act="v-f" data-f="main">주거래처 <b>${nMain}</b></button><button class="chip ${u.vf === "etc" ? "on" : ""}" data-act="v-f" data-f="etc">일반 <b>${S.vendors.length - nMain}</b></button></span></span>
      </div>
      <div class="tbar"><button class="btn btn--sm" data-act="v-edit" ${u.vsel.length === 1 ? "" : "disabled"}>${ic("pencil", 14)}고치기</button><button class="btn btn--sm" data-act="v-main" data-v="1" ${u.vsel.length ? "" : "disabled"}>${ic("star", 14)}주거래처로</button><button class="btn btn--sm" data-act="v-main" data-v="0" ${u.vsel.length ? "" : "disabled"}>일반으로</button><button class="btn btn--sm" data-act="v-merge" ${u.vsel.length >= 2 ? "" : "disabled"}>${ic("merge", 14)}합치기${u.vsel.length >= 2 ? ` (${u.vsel.length})` : ""}</button>
        <span class="sm">${u.vsel.length ? `${u.vsel.length}곳 선택` : "줄을 고르세요 · 고치기는 한 곳, 합치기는 두 곳 이상"}</span></div>
      <table class="tbl" style="border-top:1px solid var(--border)"><colgroup><col class="w-chk"><col><col style="width:140px"><col style="width:120px"><col style="width:84px"><col style="width:160px"></colgroup>
      <thead><tr><th></th><th>거래처명</th><th>사업자번호</th><th>구분</th><th class="num">${mShort(S.month)} 거래</th><th>처음 생긴 자료</th></tr></thead>
      <tbody>${list.map((v) => `<tr class="clickable ${u.vsel.includes(v.id) ? "pick" : ""}" data-act="v-row" data-id="${v.id}"><td><input type="checkbox" class="rowchk" ${u.vsel.includes(v.id) ? "checked" : ""} aria-label="선택"></td>
        <td class="ell" style="font-weight:700">${esc(v.name)}</td><td class="tnum ${v.biz ? "" : "mut"}">${v.biz || "없음"}</td>
        <td>${v.main ? `<span class="badge b-done">${ic("star", 12, "fill:currentColor")}주거래처</span>` : `<span class="badge b-todo">일반</span>`}</td>
        <td class="num">${S.month === D.DEFAULT_MONTH ? v.cnt + "건" : "—"}</td><td class="mut">${v.from}</td></tr>`).join("") || `<tr><td colspan="6" class="mut" style="text-align:center;padding:32px">찾는 거래처가 없습니다</td></tr>`}</tbody></table></div>`;
};
INP["v-q"] = (d, el) => { S.ui.vq = el.value; render(); };
ACT["v-f"] = (d) => { S.ui.vf = d.f; render(); };
CHG["v-sel"] = (d, el) => { const s = S.ui.vsel; el.checked ? s.push(d.id) : s.splice(s.indexOf(d.id), 1); render(); };
ACT["v-dupsel"] = (d) => { S.ui.vsel = [d.a, d.b]; render(); };
ACT["v-row"] = (d) => { const s = S.ui.vsel, i = s.indexOf(d.id); i < 0 ? s.push(d.id) : s.splice(i, 1); render(); };
ACT["v-main"] = (d) => { S.vendors.forEach((v) => { if (S.ui.vsel.includes(v.id)) v.main = d.v === "1"; }); render(); };   // 파일에 안 나오므로 touched() 없음
ACT["v-edit"] = () => { const v = S.vendors.find((x) => x.id === S.ui.vsel[0]); if (v) modal({ type: "vedit", id: v.id, name: v.name, biz: v.biz }); };
MODALS.vedit = (m) => `<div class="modal modal--sm" role="dialog" aria-modal="true"><div class="m-h"><div><h3>거래처 고치기</h3><p>고친 이름은 모든 달의 자료에 함께 바뀝니다</p></div><button class="icon-btn" data-act="close" aria-label="닫기">${ic("x", 20)}</button></div>
  <div class="m-b"><label class="field"><span class="lab">거래처명</span><input class="input" id="ve-n" value="${esc(m.name)}" data-inp="ve" data-k="name"></label>
  <label class="field"><span class="lab">사업자번호</span><input class="input tnum ${m.err ? "is-err" : ""}" id="ve-b" value="${esc(m.biz)}" placeholder="000-00-00000" data-inp="ve" data-k="biz">${m.err ? `<span class="err-t">${m.err}</span>` : ""}</label></div>
  <div class="m-f"><span class="sp"></span><button class="btn" data-act="close">취소</button><button class="btn btn--primary" data-act="ve-ok">저장</button></div></div>`;
INP.ve = (d, el) => { S.ui.modal[d.k] = el.value; if (d.k === "biz" && S.ui.modal.err) { S.ui.modal.err = ""; el.classList.remove("is-err"); } };
ACT["ve-ok"] = () => {
  const m = S.ui.modal, v = S.vendors.find((x) => x.id === m.id), b = m.biz.trim();
  /* 사업자번호 — 000-00-00000 모양 + 끝자리 검증 번호까지 확인 (ERP 공통 숫자 모양 부품) */
  if (b && (!/^\d{3}-\d{2}-\d{5}$/.test(b) || !bizOk(b))) { m.err = "사업자번호가 맞지 않습니다 — 000-00-00000 모양이고, 끝자리 검증 번호까지 확인합니다"; render(); return; }
  v.name = m.name.trim() || v.name; v.biz = b; touched(); closeModal(); toast("거래처를 고쳤습니다");
};
ACT["v-merge"] = () => { modal({ type: "vmerge", keep: S.ui.vsel[0] }); };
MODALS.vmerge = (m) => {
  const vs = S.ui.vsel.map((id) => S.vendors.find((x) => x.id === id));
  return `<div class="modal modal--sm" role="dialog" aria-modal="true"><div class="m-h"><div><h3>거래처 ${vs.length}곳 합치기</h3><p>남길 이름을 고르세요. 나머지 거래처의 자료는 모두 이 이름으로 옮겨집니다</p></div><button class="icon-btn" data-act="close" aria-label="닫기">${ic("x", 20)}</button></div>
  <div class="m-b"><div class="note note--danger">${ic("circle-alert")}<span><b>되돌릴 수 없습니다.</b> 합친 뒤에는 다시 나눌 수 없습니다. ${vs.map((v) => `${esc(v.name)} ${v.cnt}건`).join(" · ")}</span></div><div class="cands">${vs.map((v) => `<label class="cand ${m.keep === v.id ? "on" : ""}"><input type="radio" name="vk" data-chg="vm-keep" data-id="${v.id}" ${m.keep === v.id ? "checked" : ""}><div><div class="t">${esc(v.name)}</div><div class="k">${v.biz || "사업자번호 없음"} · ${v.from}</div></div><span class="sm">${v.cnt}건</span></label>`).join("")}</div></div>
  <div class="m-f"><span class="sp"></span><button class="btn" data-act="close">취소</button><button class="btn btn--primary" data-act="vm-ok">합치기</button></div></div>`;
};
CHG["vm-keep"] = (d) => { S.ui.modal.keep = d.id; render(); };
ACT["vm-ok"] = () => {
  const keep = S.vendors.find((x) => x.id === S.ui.modal.keep), rest = S.ui.vsel.filter((id) => id !== keep.id);
  rest.forEach((id) => { const v = S.vendors.find((x) => x.id === id); keep.cnt += v.cnt; keep.main = keep.main || v.main; if (!keep.biz) keep.biz = v.biz; });
  S.vendors = S.vendors.filter((v) => !rest.includes(v.id)); S.vendors.forEach((v) => { if (rest.includes(v.dup)) delete v.dup; });
  S.ui.vsel = []; touched(); closeModal(); toast(`「${keep.name}」${jo(keep.name, "으로")} 합쳤습니다`);
};

/* ═════════ S05-07 원천세 ═════════ */
SCREENS.wh = () => {
  if (S.month !== D.DEFAULT_MONTH) return ctx() + head("원천세") + notSep();
  const P = payrollRows(), sum = (a, k) => a.reduce((n, r) => n + (r[k] || 0), 0);   // 직원 급여(S05-12) 값
  const L = P.filter((r) => r.kind === "근로"), B = P.filter((r) => r.kind === "사업");
  const half = S.settings.halfYear;
  /* 반기: 1~6월분(7월 10일) · 7~12월분(다음 해 1월 10일). 반기 마지막 달(6·12월) 직원 급여를 저장하면 [만들기]가 켜짐 */
  const mo = Number(S.month.slice(5)), h2 = mo >= 7;
  const hMonths = (h2 ? [7, 8, 9, 10, 11, 12] : [1, 2, 3, 4, 5, 6]).map((m) => "2026-" + String(m).padStart(2, "0"));
  const upMonths = hMonths.filter((m) => D.payrollMonths.includes(m));
  const lastUp = upMonths.includes(hMonths[5]);
  const mult = half ? upMonths.length : 1;
  const due = (sum(P, "tax") + sum(P, "local")) * mult;
  const box = (t, g, a) => `<div class="card card-pad"><div class="between"><div class="sec-t">${t}</div><span class="badge b-todo">${a.length}명</span></div><p class="help" style="margin-top:4px">${g}</p>
    <div class="calc" style="margin-top:10px"><div class="ln"><span>준 돈 (지급액)</span><span class="v">${won(sum(a, "pay"))}원</span></div><div class="ln"><span>뗀 소득세</span><span class="v">${a.some((r) => r.tax == null) ? txv(null) : won(sum(a, "tax")) + "원"}</span></div><div class="ln"><span>뗀 지방소득세</span><span class="v">${a.some((r) => r.local == null) ? txv(null) : won(sum(a, "local")) + "원"}</span></div></div></div>`;
  return ctx() +
    head("원천세", `<span class="term" title="월급·외주비를 줄 때 회사가 미리 떼어 두었다가 대신 내는 세금">원천세</span><span class="gloss">월급·외주비를 줄 때 회사가 떼어 대신 내는 세금</span><br><b>직원 급여</b> 화면 값으로 신고자료를 만듭니다 — 정규직 소득세 · 지방소득세는 세무사가 계산합니다. <b>실제로 돈을 준 달(지급월)</b> 기준이고, 어느 달 급여인지(귀속월)는 함께 적습니다.`) + whTabs() +
    (half ? `<div class="note note--info">${ic("calendar-range")}<span><b>반기납부 회사입니다.</b> 반기는 둘입니다 — 1~6월분은 <b>6월 직원 급여</b>를 저장하면, 7~12월분은 <b>12월 직원 급여</b>를 저장하면 신고자료를 만들 수 있습니다. 지금은 <b>${h2 ? "7~12월분" : "1~6월분"}</b>을 쌓는 중입니다 (신고 ${h2 ? "다음 해 1월 10일" : "7월 10일"}).</span></div>
    <div class="card card-pad"><div class="between"><div class="sec-t">${h2 ? "7~12월" : "1~6월"} 직원 급여</div><span class="sm">${upMonths.length}/6달 올림</span></div>
      <div class="grid3" style="grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-top:12px">${hMonths.map((m) => { const on = D.payrollMonths.includes(m); return `<div style="padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-md);background:${on ? "var(--color-accent-bg)" : "var(--surface)"}"><div style="font-weight:700;color:var(--text-heading)">${mShort(m)}</div><div class="sm">${on ? won(sum(P, "tax") + sum(P, "local")) + "원" : "아직"}</div></div>`; }).join("")}</div></div>` : "") +
    `<div class="card card-pad between"><div><div class="sm">신고 기간</div><div style="font-size:17px;font-weight:700;color:var(--text-heading)">${half ? (h2 ? "2026년 7~12월 지급분 (반기)" : "2026년 1~6월 지급분 (반기)") : "2026년 9월 지급분"} <span class="sm" style="font-weight:400">${half ? (h2 ? "· 신고 2027년 1월 10일" : "· 신고 2026년 7월 10일") : "· 지급일 09.25 · 귀속 9월"}</span></div></div>
      <div style="text-align:right"><div class="sm">${half ? `${h2 ? 7 : 1}~${mo}월 누적 낼 세금` : "10월 10일까지 낼 세금 (프리랜서분 · 정규직은 세무사 계산)"}</div><div style="font-size:22px;font-weight:700;color:var(--color-primary)" class="tnum">${won(due)}원</div></div></div>
    <div class="grid2">${box("근로소득", "직원 월급", L)}${box("사업소득 (3.3%)", "개인에게 맡긴 외주 — 소득세 3% + 지방소득세 0.3%", B)}</div>
    <div class="card"><div class="card-pad card-h" style="padding-bottom:12px"><h2>9월 직원 급여 · ${P.length}명</h2><span class="sub">직원 급여 화면 값 · 고치려면 <button class="btn btn--link" style="font-size:13px" data-act="go" data-s="emp">직원 급여</button></span></div>
      <table class="tbl" style="border-top:1px solid var(--border)"><colgroup><col><col style="width:110px"><col style="width:76px"><col style="width:76px"><col style="width:120px"><col style="width:110px"><col style="width:110px"></colgroup>
      <thead><tr><th>이름</th><th>소득 구분</th><th>귀속월</th><th>지급일</th><th class="num">지급액</th><th class="num">소득세</th><th class="num">지방소득세</th></tr></thead>
      <tbody>${P.map((r) => `<tr><td>${r.name}${r.note ? `<div class="sm">${r.note}</div>` : ""}</td><td><span class="badge ${r.kind === "근로" ? "b-todo" : "b-line"}">${r.kind}</span></td><td class="mut">9월</td><td class="tnum mut">09.25</td><td class="num">${won(r.pay)}</td><td class="num">${txv(r.tax)}</td><td class="num">${txv(r.local)}</td></tr>`).join("")}</tbody></table></div>
    <div class="note">${ic("shield-check")}<span><b>주민번호를 받지 않습니다.</b> 매달 내는 원천징수이행상황신고서는 합계만 적는 서류라 주민번호가 필요 없습니다. 사람별 지급명세서는 세무사가 채웁니다.</span></div>
    <div class="card card-pad row" style="gap:16px">${S.wh.made
      ? `<span class="row"><button class="btn btn--sm" data-act="wh-remake">다시 만들기</button><button class="btn btn--sm" data-act="wh-dl">${ic("download", 14)}받기</button></span><div class="row">${ic("file-spreadsheet", 20, "color:var(--color-primary)")}<div><div style="font-weight:700;color:var(--text-heading)">${whFile()}</div><div class="sm">${S.wh.at} 만듦 · 메일은 세무사 전달에서 정리본과 함께 보냅니다</div></div></div>`
      : `<button class="btn btn--primary" data-act="wh-make" ${half && !lastUp ? "disabled" : ""}>${ic("file-plus")}신고자료 만들기</button><span class="help">${half && !lastUp ? `${h2 ? 12 : 6}월 직원 급여를 저장하면 [신고자료 만들기]가 켜집니다.` : "신고자료를 만들면 파일로 받거나 세무사에게 함께 보낼 수 있습니다."}</span>`}</div>` +
    next("wh");
};
ACT["wh-make"] = () => { S.wh = { made: true, at: "10.06 지금" }; touched(); render(); toast("원천세 신고자료를 만들었습니다"); };
ACT["wh-dl"] = () => toast("파일을 내려받습니다 (시안)");
ACT["wh-remake"] = () => modal({ type: "confirm", icon: "file-plus", title: "신고자료를 다시 만드시겠습니까?", ok: "다시 만들기",
  body: "지금 파일을 새로 만든 파일로 바꿉니다. 세무사에게 이미 보냈다면 다시 보내야 합니다.", run: () => { S.wh = { made: true, at: "10.06 지금" }; touched(); toast("원천세 신고자료를 다시 만들었습니다"); } });
/* 파일 이름 — 매월 「회사명_원천세_2026년9월.xlsx」 · 반기 「회사명_원천세_2026년상반기.xlsx」 */
function whFile() {
  const mo = Number(S.month.slice(5));
  return `${D.company.name}_원천세_2026년${S.settings.halfYear ? (mo >= 7 ? "하반기" : "상반기") : mo + "월"}.xlsx`;
}
/* 원천세 탭 — 이번 달 신고 / 직원별 월 이력 · 누계 (급여 내역은 여기에 합침) */
const whTabs = () => `<div class="tabs">${[["now", "이번 달 신고"], ["hist", "직원별 월 이력 · 누계"]].map(([k, l]) => `<button class="tab ${(S.ui.whTab || "now") === k ? "on" : ""}" data-act="wh-tab" data-t="${k}">${l}</button>`).join("")}</div>`;
ACT["wh-tab"] = (d) => { S.ui.whTab = d.t; render(); };
function whHist() {
  const P = payrollRows(), ms = D.payrollMonths, tot = (r, k) => (r[k] || 0) * ms.length, all = (k) => P.reduce((n, r) => n + tot(r, k), 0);
  return `<div class="card"><div class="card-pad card-h" style="padding-bottom:12px"><h2>2026년 직원별 월 이력 · 누계</h2><span class="sub">직원 급여(S05-12) 값 · 지급월 기준 · 시안 데이터는 7~9월만 있습니다</span></div>
  <table class="tbl" style="border-top:1px solid var(--border)"><colgroup><col><col style="width:84px">${ms.map(() => `<col style="width:104px">`).join("")}<col style="width:120px"><col style="width:104px"><col style="width:112px"></colgroup>
  <thead><tr><th>이름</th><th>소득 구분</th>${ms.map((m) => `<th class="num">${mShort(m)} 지급액</th>`).join("")}<th class="num">누계 지급액</th><th class="num">누계 소득세</th><th class="num">누계 지방소득세</th></tr></thead>
  <tbody>${P.map((r) => `<tr><td>${r.name}</td><td><span class="badge ${r.kind === "근로" ? "b-todo" : "b-line"}">${r.kind}</span></td>${ms.map(() => `<td class="num">${won(r.pay)}</td>`).join("")}<td class="num" style="font-weight:700">${won(tot(r, "pay"))}</td><td class="num">${r.tax == null ? txv(null) : won(tot(r, "tax"))}</td><td class="num">${r.local == null ? txv(null) : won(tot(r, "local"))}</td></tr>`).join("")}
  <tr><td style="font-weight:700">합계</td><td></td>${ms.map(() => `<td class="num" style="font-weight:700">${won(P.reduce((n, r) => n + r.pay, 0))}</td>`).join("")}<td class="num" style="font-weight:700">${won(all("pay"))}</td><td class="num" style="font-weight:700">${won(all("tax"))}<div class="sm">프리랜서분</div></td><td class="num" style="font-weight:700">${won(all("local"))}<div class="sm">프리랜서분</div></td></tr></tbody></table></div>`;
}
const whMain = SCREENS.wh;
SCREENS.wh = () => (S.month === D.DEFAULT_MONTH && S.ui.whTab === "hist"
  ? ctx() + head("원천세", "직원마다 달별로 준 돈과 올해 누계를 봅니다. 직원 급여를 저장한 달만 쌓입니다.") + whTabs() + whHist() + next("wh")
  : whMain());

/* ═════════ S05-08 월별 손익 ═════════ */
SCREENS.pl = () => {
  const yr = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map((m) => "2026-" + m);
  const max = Math.max(...Object.values(D.pl).flat());
  const c = counts(), cur = D.pl[S.month];
  const leftAmt = clsTargets().filter((t) => !clsDone(t.id)).reduce((n, t) => n + t.amt, 0);
  const loanMissing = !kindFiles("loan").length && !S.noneKinds.includes("loan") && !S.settings.unused.includes("loan");
  const chart = yr.map((m) => {
    const v = D.pl[m];
    return `<button class="bar-g ${m === S.month ? "on" : ""} ${v ? "" : "off"}" ${v ? `data-act="pl-m" data-m="${m}"` : "disabled"} title="${v ? mLabel(m) + " · 번 돈 " + won(v[0]) + " · 쓴 돈 " + won(v[1]) : ""}">
      <span class="bars">${v ? `<span class="b1" style="height:${(v[0] / max) * 100}%"></span><span class="b2" style="height:${(v[1] / max) * 100}%"></span>` : ""}</span><span class="m">${Number(m.slice(5))}월</span></button>`;
  }).join("");
  const sep = S.month === D.DEFAULT_MONTH, ps = D.plSep;
  return ctx() +
    head("월별 손익", "달마다 번 돈·쓴 돈·남은 돈을 봅니다. 매입·매출은 계산서 날짜, 카드는 쓴 날, 나머지는 거래일 기준이고 부가세는 뺀 금액입니다.") +
    `<div class="card card-pad"><div class="between" style="margin-bottom:16px"><h2 style="font-size:17px">2026년</h2><span class="leg"><span><i style="background:var(--color-primary)"></i>번 돈</span><span><i style="background:#CBD5E1"></i>쓴 돈</span></span></div><div class="chart">${chart}</div></div>` +
    (cur ? `<div class="grid3"><div class="card kpi"><div class="k">${mShort(S.month)} 번 돈 (매출)</div><div class="v">${won(cur[0])}<small> 원</small></div></div><div class="card kpi"><div class="k">${mShort(S.month)} 쓴 돈 (비용)</div><div class="v">${won(cur[1])}<small> 원</small></div></div><div class="card kpi"><div class="k">${mShort(S.month)} 남은 돈 (이익)</div><div class="v" style="color:var(--color-primary)">${won(cur[0] - cur[1])}<small> 원</small></div></div></div>` : `<div class="card card-pad">${notSep()}</div>`) +
    (sep ? `${c.clsLeft || loanMissing ? `<div class="note note--warn">${ic("triangle-alert")}<span>${c.clsLeft ? `<b>아직 빠진 금액이 있습니다.</b> 분류 남은 ${c.clsLeft}줄 (${won(leftAmt)}원)은 항목을 붙이면 들어갑니다. <button class="btn btn--link" style="font-size:13px" data-act="go" data-s="classify">거래 분류</button>` : ""}${c.clsLeft && loanMissing ? "<br>" : ""}${loanMissing ? "대출 내역을 올리지 않아 대출 이자가 빠져 있습니다." : ""}</span></div>` : ""}
      <div class="grid2"><div class="card card-pad"><div class="sec-t">번 돈</div><div class="calc" style="margin-top:8px">${ps.income.map((r) => `<div class="ln"><span class="l">${r.v}<small>${r.g || ""}</small></span><span class="v">${won(r.amt)}</span></div>`).join("")}<div class="ln sum"><span>합계</span><span class="v">${won(cur[0])}</span></div></div></div>
      <div class="card card-pad"><div class="sec-t">쓴 돈</div><div class="calc" style="margin-top:8px">${ps.expense.map((r) => `<div class="ln"><span>${r.v}</span><span class="v">${won(r.amt)}</span></div>`).join("")}<div class="ln sum"><span>합계</span><span class="v">${won(cur[1])}</span></div></div>
        <p class="help" style="margin-top:12px">비용에 넣지 않는 것 — 카드대금 출금(카드 사용 내역으로 이미 잡음) · 원천세·부가세 납부 · 대출 원금 · 내 계좌끼리 옮긴 돈 · 대표가 넣은 돈</p></div></div>` : "") +
    next("pl");
};
ACT["pl-m"] = (d) => { S.month = d.m; render(); };

/* ═════════ S05-09 부가세 ═════════ */
SCREENS.vat = () => {
  if (S.month !== D.DEFAULT_MONTH) return ctx() + head("부가세") + notSep();
  const out = 6230000, inv = 1480000, card = 612000, est = [{ v: "거래처 식사 (접대 성격일 수 있음)", amt: 42000 }, { v: "승용차 주유 (업무용이 아닐 수 있음)", amt: 18000 }];
  /* 분류에서 「계산서 없는 매출」로 붙인 입금 줄 — 부가세 매출에도 잡고 「세무사 확인」 표시 */
  const vatItems = D.ITEMS.filter((i) => i.vat).map((i) => i.v);
  const noInv = clsTargets().filter((t) => clsDone(t.id) && vatItems.includes(S.cls[t.id].item)).reduce((n, t) => n + t.amt, 0);
  const noInvTax = Math.round(noInv / 11);
  const pay = out + noInvTax - inv - card, estSum = est.reduce((n, e) => n + e.amt, 0);
  const c = counts();
  return ctx() +
    head("부가세", `<span class="term" title="물건·서비스 값에 붙는 10% 세금. 손님에게 받아 둔 부가세에서 내가 낸 부가세를 빼고 차액을 냅니다">부가세</span><span class="gloss">손님에게 받아 둔 10% 세금에서 내가 낸 10%를 빼고 차액을 냅니다</span>`) +
    `<div class="card card-pad between"><div><div class="sm">신고 기간</div><div style="font-size:17px;font-weight:700;color:var(--text-heading)">${corp() ? "2026년 3분기 예정신고 · 7~9월" : "2026년 2기 확정신고 · 7~12월"}</div>
      <div class="sm">${corp() ? "법인은 분기마다 신고합니다 (예정 · 확정)" : "개인 일반과세자는 반기마다 확정신고하고, 중간에는 세무서 고지서로 냅니다 (예정고지)"}</div></div>
      <div style="text-align:right"><div class="sm">신고·납부 마감</div><div style="font-size:17px;font-weight:700;color:var(--text-heading)">${corp() ? "10월 25일" : "2027년 1월 25일"}</div></div></div>
    ${vatBar()}
    ${corp() ? "" : `<div class="note note--info">${ic("mail")}<span><b>10월 25일까지 예정고지 금액을 냅니다.</b> 세무서가 보낸 고지서 금액(직전 기에 낸 세금의 절반)이며 따로 신고하지 않습니다. 아래 숫자는 7~9월까지 쌓인 값입니다.</span></div>`}
    ${c.clsLeft ? `<div class="note note--warn">${ic("triangle-alert")}<span>분류 남은 ${c.clsLeft}줄은 아직 빠져 있습니다. 예상 금액은 분류가 끝날수록 정확해집니다.</span></div>` : ""}
    <div class="grid2"><div class="card card-pad"><div class="sec-t">낼 세금 예상</div><div class="calc" style="margin-top:8px">
      <div class="ln"><span class="l">받아 둔 부가세 (매출세액)<small>7~9월 매출 계산서 공급가액 62,300,000원의 10%</small></span><span class="v">${won(out)}</span></div>
      ${noInv ? `<div class="ln"><span class="l"><span class="row" style="gap:6px">계산서 없는 매출 <span class="badge b-doing b-sm">추정 · 세무사 확인</span></span><small>거래 분류에서 붙인 입금 ${won(noInv)}원에 부가세 10%가 들어 있다고 보고 1/11로 계산했습니다</small><small>면세 품목이면 부가세가 없으므로 세무사가 고칠 수 있습니다</small></span><span class="v">${won(noInvTax)}</span></div>` : `<div class="ln"><span class="l">계산서 없는 매출<small>거래 분류에서 「계산서 없는 매출」로 붙인 입금이 있으면 여기에 잡힙니다</small></span><span class="v" style="color:var(--text-caption);font-weight:400">없음</span></div>`}
      <div class="ln minus"><span class="l">낸 부가세 — 매입 계산서 (매입세액)<small>공급가액 14,800,000원의 10%</small></span><span class="v">${won(inv)}</span></div>
      <div class="ln minus"><span class="l"><span class="row" style="gap:6px">낸 부가세 — 카드 사용 <span class="badge b-doing b-sm">추정 · 세무사 확인</span></span><small>분류 항목의 「부가세 공제 추정」 칸으로 계산 — 식대·소모품비 등은 공제, 보험료·수수료 등은 제외</small></span><span class="v">${won(card)}</span></div>
      <div class="ln sum"><span>낼 세금 예상</span><span class="v">${won(pay)}원</span></div></div></div>
    <div class="card card-pad"><div class="between"><div class="sec-t">공제가 안 될 수 있는 매입</div><span class="badge b-doing">추정</span></div>
      <p class="help" style="margin-top:6px">시스템이 추정만 하고 판단은 세무사가 합니다. 공제가 안 되면 낼 세금이 <b>최대 ${won(estSum)}원</b> 늘어납니다.</p>
      <div class="calc" style="margin-top:8px">${est.map((e) => `<div class="ln"><span>${e.v}</span><span class="v">${won(e.amt)}</span></div>`).join("")}</div></div></div>
    <p class="help">이 화면은 보기만 합니다. 실제 신고는 세무사가 하며, 숫자는 세무사 전달 때 정리본에 함께 들어갑니다.</p>` +
    next("vat");
};

/* ═════════ S05-10 세무사 전달 ═════════ */
const SHEETS = ["매입·매출", "카드", "현금 경비", "은행 (짝·분류)", "급여", "세금 납부", "대출", "삐용 경비", "거래처", "손익", "부가세"];
SCREENS.send = () => {
  if (S.month !== D.DEFAULT_MONTH) return ctx() + head("세무사 전달") + notSep();
  const u = S.ui, c = counts(), em = S.settings.taxEmails;
  if (!u.to) u.to = em.map((e) => e.email);
  u.to = u.to.filter((x) => em.some((e) => e.email === x));
  const remain = [c.cand ? `짝 확인 남음 ${c.cand}줄` : "", c.clsLeft ? `분류 남음 ${c.clsLeft}줄` : "", !S.wh.made && !S.settings.halfYear ? "원천세 신고자료 아직" : ""].filter(Boolean);
  const raws = S.files.filter((f) => u.raw.includes(f.id));
  return ctx() +
    head("세무사 전달", "9월 정리본을 세무사 메일로 보냅니다. 삐용이 이미 쓰는 메일 발송 수단으로 보냅니다. 기간을 고르면 부문별 엑셀을 한 번에 묶어 보냅니다.") + sendPer() +
    (S.sends.length && S.changed ? `<div class="note note--warn">${ic("history")}<span><b>보낸 뒤 바뀐 자료가 있습니다.</b> ${S.sends[0].at}에 보낸 뒤 자료가 고쳐졌습니다. 다시 보내면 세무사가 최신본을 받습니다.</span></div>` : "") +
    `<div class="card card-pad"><div class="between"><div class="sec-t">보내기 전 확인</div>${remain.length ? `<span class="badge b-doing">남은 일 ${remain.length}</span>` : `<span class="badge b-done">모두 끝남</span>`}</div>
      ${remain.length ? `<p class="help" style="margin-top:8px">남은 일이 있어도 보낼 수 있습니다. 남은 건수는 메일 본문에 적힙니다.</p><div class="row" style="margin-top:10px">${remain.map((r) => `<span class="badge b-todo">${r}</span>`).join("")}</div>` : `<p class="help" style="margin-top:8px">짝 맞추기·분류·원천세까지 모두 끝났습니다.</p>`}</div>
    <div class="grid2">
      <div class="card card-pad"><div class="between"><div class="sec-t">받는 사람</div><button class="btn btn--link" style="font-size:13px" data-act="go" data-s="settings">세무 설정에서 바꾸기</button></div>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:10px">${em.map((e) => `<label class="chk"><input type="checkbox" data-chg="s-to" data-v="${esc(e.email)}" ${u.to.includes(e.email) ? "checked" : ""}><span><b>${esc(e.name)}</b> <span class="sm">${esc(e.email)}</span></span></label>`).join("") || `<span class="sm">등록된 세무사 메일이 없습니다</span>`}</div></div>
      <div class="card card-pad"><div class="sec-t">보낼 파일</div>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
          <label class="chk"><input type="checkbox" checked disabled><span><b>정리본 엑셀</b> <span class="sm">자료별 시트 ${SHEETS.length}개 · ${perLabel("send")} ${won(sendRows())}줄 · 항상 보냅니다</span></span></label>
          <label class="chk"><input type="checkbox" checked disabled><span><b>직원 급여 (엑셀)</b> <span class="sm">직원 급여 화면 그대로 · 항상 보냅니다</span></span></label>
          <label class="chk"><input type="checkbox" ${S.wh.made ? "checked" : ""} disabled><span><b>원천세 신고자료</b> ${S.wh.made ? `<span class="sm">함께 보냅니다</span>` : `<span class="sm">아직 없음 · <button class="btn btn--link" style="font-size:12px" data-act="go" data-s="wh">원천세에서 만들기</button></span>`}</span></label>
          <span class="sm" style="margin-top:4px">처음 올린 원본 파일 — 고르면 압축해서 함께 보냅니다</span>
          ${sendFiles().length ? "" : `<span class="sm">이 기간에 올린 파일이 없습니다</span>`}${sendFiles().map((f) => `<label class="chk" style="padding-left:4px"><input type="checkbox" data-chg="s-raw" data-id="${f.id}" ${u.raw.includes(f.id) ? "checked" : ""}><span class="ell" style="font-size:13px">${esc(f.name)}</span></label>`).join("")}</div></div></div>
    <div class="card card-pad"><div class="sec-t">메일 미리보기</div>
      <div style="margin-top:12px;padding:16px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface-alt);font-size:14px;line-height:1.7;color:var(--text-heading)">
        <div><span class="sm">받는 사람</span> ${u.to.length ? u.to.map(esc).join(", ") : "<span class='mut'>없음</span>"}</div>
        <div><span class="sm">제목</span> <b>[${D.company.name}] ${perLabel("send")} 세무 자료</b></div>
        <div style="margin-top:10px;white-space:pre-line">안녕하세요, ${D.company.name}입니다. ${perLabel("send")} 세무 자료를 보내 드립니다.
첨부: 정리본 엑셀 · 직원 급여(엑셀)${S.wh.made ? " · 원천세 신고자료" : ""}${raws.length ? ` · 원본 파일 ${raws.length}개 (압축)` : ""}
${remain.length ? "아직 남은 일: " + remain.join(" · ") : "남은 일 없음"}</div></div></div>
    <div class="row" style="gap:12px"><button class="btn btn--primary" data-act="s-send" ${u.to.length ? "" : "disabled"}>${ic("send")}세무사에게 보내기</button><span class="help">${u.to.length ? "" : "받는 사람을 한 명 이상 고르세요"}</span></div>
    <div class="card"><div class="card-pad card-h" style="padding-bottom:12px"><h2>보낸 이력</h2></div>
      <table class="tbl" style="border-top:1px solid var(--border)"><colgroup><col style="width:110px"><col><col style="width:220px"><col style="width:150px"><col style="width:120px"></colgroup>
      <thead><tr><th>보낸 때</th><th>받는 사람</th><th>파일</th><th>남은 일</th><th>상태</th></tr></thead>
      <tbody>${S.sends.map((s, i) => `<tr><td class="tnum">${s.at}</td><td class="ell">${s.to}</td><td class="mut">${s.files}</td><td class="mut">${s.remain}</td><td>${i === 0 && S.changed ? `<span class="badge b-doing">보낸 뒤 바뀜</span>` : `<span class="badge b-done">보냄</span>`}</td></tr>`).join("") || `<tr><td colspan="5" class="mut" style="text-align:center;padding:28px">9월 자료를 아직 보내지 않았습니다</td></tr>`}</tbody></table></div>`;
};
CHG["s-to"] = (d, el) => { const s = S.ui.to; el.checked ? s.push(d.v) : s.splice(s.indexOf(d.v), 1); render(); };
CHG["s-raw"] = (d, el) => { const s = S.ui.raw; el.checked ? s.push(d.id) : s.splice(s.indexOf(d.id), 1); render(); };
ACT["s-send"] = () => {
  const c = counts(), u = S.ui;
  const remain = [c.cand ? `짝 ${c.cand}` : "", c.clsLeft ? `분류 ${c.clsLeft}` : ""].filter(Boolean).join(" · ") || "없음";
  modal({ type: "confirm", icon: "send", title: "세무사에게 보내시겠습니까?", ok: "보내기",
    body: `${u.to.length}명에게 9월 정리본을 보냅니다.${c.cand || c.clsLeft ? `<br>남은 일(${remain})은 메일 본문에 적힙니다.` : ""}`,
    run: () => {
      S.sends.unshift({ at: "10.06 지금", to: u.to.join(", "), files: ["정리본", "직원 급여", S.wh.made ? "원천세" : "", u.raw.length ? `원본 ${u.raw.length}개` : ""].filter(Boolean).join(" · "), remain });
      S.changed = false; toast("세무사에게 보냈습니다");
    } });
};

/* ═════════ S05-11 세무 설정 ═════════ */
/* 칸을 바꿔도 바로 반영하지 않습니다 — 고치는 동안은 사본(draft)에 담고, [저장]을 눌러야 한 번에 반영합니다 */
function draft() {
  if (!S.ui.draft) S.ui.draft = { ...clone(S.settings), type: S.type, sel: { taxEmails: [], accounts: [], cards: [] }, dirty: false };
  return S.ui.draft;
}
function setDirty() { const st = draft(), was = st.dirty; st.dirty = true; if (!was) render(); }
/* 자료를 올린 계좌·카드인지 — 은행 줄 또는 올린 파일의 기관·계좌 이름으로 판단 */
const inUse = (l, x) => (l === "accounts" && S.bank.some((b) => b.acc === x.id)) || S.files.some((f) => x.alias && (f.org || "").includes(x.alias));
const offList = (l) => { const offs = draft()[l].map((x, i) => [x, i]).filter(([x]) => x.off);
  return offs.length ? `<div class="sm" style="margin-top:6px">사용 안 함 · ${offs.map(([x, i]) => `${esc(x.alias || x.no || x.last4)} <button class="btn btn--link" style="font-size:12px" data-act="st-on" data-l="${l}" data-i="${i}">다시 사용</button>`).join(" · ")}</div>` : ""; };
const rowChk = (l, i) => `<input type="checkbox" class="rowchk" data-chg="st-sel" data-l="${l}" data-i="${i}" ${draft().sel[l].includes(i) ? "checked" : ""} aria-label="선택">`;
/* 목록 위 버튼 — 추가 · 삭제 · (계좌·카드) 사용 안 함. 자료를 올린 계좌·카드가 섞이면 삭제가 막힘 */
function listBar(l, addLabel, max) {
  const st = draft(), L = st[l], picked = st.sel[l].map((i) => L[i]).filter(Boolean);
  const used = l !== "taxEmails" && picked.some((x) => inUse(l, x));
  const what = l === "accounts" ? "계좌" : "카드";
  return `<div class="row" style="margin-top:12px"><button class="btn btn--sm" data-act="st-add" data-l="${l}" ${max && L.length >= max ? "disabled" : ""}>${ic("plus", 14)}${addLabel}</button><button class="btn btn--sm btn--danger" data-act="st-del" data-l="${l}" ${picked.length && !used ? "" : "disabled"}>${ic("trash-2", 14)}삭제</button>${l !== "taxEmails" ? `<button class="btn btn--sm" data-act="st-off" data-l="${l}" ${picked.length ? "" : "disabled"}>사용 안 함</button>` : ""}<span class="sm">${used ? `올린 자료가 있는 ${what}는 지울 수 없습니다 — 「사용 안 함」으로 바꾸세요` : picked.length ? `${picked.length}개 선택` : ""}</span></div>`;
}
SCREENS.settings = () => {
  const st = draft(), co = D.company;
  return ctx("세무 설정은 달과 상관없습니다") +
    head("세무 설정", "세무에만 쓰는 값을 정합니다. 처음에 한 번 하고, 바뀔 때만 고칩니다.") +
    `<div class="card card-pad"><div class="between"><div class="sec-t">회사 기본정보</div><span class="sm">삐용 단체관리가 정본입니다 — 여기서는 보기만 합니다</span></div>
      <div class="grid3" style="margin-top:12px">${[["회사 이름", co.name], ["사업자등록번호", co.bizNo], ["법인등록번호", co.corpNo]].map(([k, v]) => `<div><div class="sm">${k}</div><div class="tnum" style="font-size:15px;color:var(--text-heading);margin-top:2px">${v}</div></div>`).join("")}</div></div>
    <div class="card card-pad"><div class="sec-t">사업자 유형</div><p class="help" style="margin-top:4px">분류 항목, 부가세 신고 기간, 마감일이 이 값에 따라 바뀝니다.</p>
      <div class="row" style="margin-top:12px;gap:24px"><label class="chk"><input type="radio" name="ty" data-chg="st-type" value="indiv" ${st.type === "indiv" ? "checked" : ""}>개인 일반과세자</label><label class="chk"><input type="radio" name="ty" data-chg="st-type" value="corp" ${st.type === "corp" ? "checked" : ""}>법인 (유한회사 포함)</label></div></div>
    <div class="card card-pad"><div class="between"><div class="sec-t">세무사 메일</div><span class="sm">최대 3개 · 세무사 사무실 담당자, 대표 참조 등</span></div>
      ${listBar("taxEmails", "메일 추가", 3)}
      <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px">${st.taxEmails.map((e, i) => `<div class="row" style="flex-wrap:nowrap">${rowChk("taxEmails", i)}<input class="input" id="te-n${i}" style="flex:1" value="${esc(e.name)}" placeholder="이름 · 역할" data-inp="st-f" data-l="taxEmails" data-i="${i}" data-k="name"><input class="input" id="te-e${i}" style="flex:1.2" type="email" value="${esc(e.email)}" placeholder="name@example.com" data-inp="st-f" data-l="taxEmails" data-i="${i}" data-k="email"></div>`).join("")}</div></div>
    <div class="grid2">
      <div class="card card-pad"><div class="sec-t">회사 계좌</div><p class="help" style="margin-top:4px">은행 자료를 올릴 때 고르고, 이 계좌끼리 오간 돈은 「내 계좌끼리」로 짝을 맞춥니다.</p>
        ${listBar("accounts", "계좌 추가")}
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px">${st.accounts.map((a, i) => a.off ? "" : `<div class="row" style="flex-wrap:nowrap">${rowChk("accounts", i)}<select class="select" style="width:112px" data-chg="st-f" data-l="accounts" data-i="${i}" data-k="bank">${D.BANKS.map((b) => `<option ${b === a.bank ? "selected" : ""}>${b}</option>`).join("")}</select><input class="input tnum" id="ac-n${i}" style="flex:1;min-width:0" value="${esc(a.no)}" placeholder="계좌번호" data-inp="st-f" data-l="accounts" data-i="${i}" data-k="no"><input class="input" id="ac-a${i}" style="width:100px" value="${esc(a.alias)}" placeholder="별칭" data-inp="st-f" data-l="accounts" data-i="${i}" data-k="alias"></div>`).join("")}${offList("accounts")}</div></div>
      <div class="card card-pad"><div class="sec-t">회사 카드</div><p class="help" style="margin-top:4px">카드 사용 내역을 올릴 때 고르고, 카드대금 출금과 그 달 청구 합계를 짝 맞춥니다.</p>
        ${listBar("cards", "카드 추가")}
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px">${st.cards.map((c, i) => c.off ? "" : `<div class="row" style="flex-wrap:nowrap">${rowChk("cards", i)}<select class="select" style="width:112px" data-chg="st-f" data-l="cards" data-i="${i}" data-k="co">${D.CARDCOS.map((b) => `<option ${b === c.co ? "selected" : ""}>${b}</option>`).join("")}</select><input class="input tnum" id="cd-n${i}" style="width:90px" value="${esc(c.last4)}" maxlength="4" placeholder="끝 4자리" data-inp="st-f" data-l="cards" data-i="${i}" data-k="last4"><input class="input" id="cd-a${i}" style="flex:1;min-width:0" value="${esc(c.alias)}" placeholder="별칭" data-inp="st-f" data-l="cards" data-i="${i}" data-k="alias"></div>`).join("")}${offList("cards")}</div></div></div>
    <div class="card card-pad"><div class="sec-t">우리 회사가 쓰지 않는 자료</div><p class="help" style="margin-top:4px">고른 자료는 매달 자동으로 「없음」이 되어 할 일에서 빠집니다. 이번 달에만 없는 자료는 자료 올리기에서 「이번 달 없음」을 누르세요.</p>
      <div class="grid4" style="margin-top:12px">${D.KINDS.map((k) => `<label class="chk"><input type="checkbox" data-chg="st-unused" data-k="${k.id}" ${st.unused.includes(k.id) ? "checked" : ""}>${k.name}</label>`).join("")}</div></div>
    <div class="card card-pad"><div class="sec-t">원천세 신고 주기</div><p class="help" style="margin-top:4px">원천세 마감일과 신고자료를 만드는 때가 이 값에 따라 바뀝니다.</p>
      <div style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
        <label class="chk"><input type="radio" name="cyc" data-chg="st-half" value="m" ${st.halfYear ? "" : "checked"}><span>매월 <span class="sm">— 다음 달 10일까지 냅니다</span></span></label>
        <label class="chk"><input type="radio" name="cyc" data-chg="st-half" value="h" ${st.halfYear ? "checked" : ""}><span>반기 <span class="sm">— 세무서 승인을 받은 회사만. 6개월 치를 묶어 1월·7월에 냅니다</span></span></label></div></div>
    ${st.errs && st.errs.length ? `<div class="note note--danger">${ic("circle-alert")}<span><b>입력을 확인해 주세요.</b> 빨간 테두리 칸 ${st.errs.length}곳 — 메일은 name@example.com 모양, 계좌번호는 숫자와 - 만(숫자 10~14자리), 카드는 끝 4자리 숫자입니다.</span></div>` : ""}<div class="row" style="gap:12px"><button class="btn btn--primary" data-act="st-save">저장</button>${st.dirty ? `<span class="sm" style="color:var(--color-warning-text);font-weight:700">저장하지 않은 변경이 있습니다</span>` : ""}<span class="help">자료를 올린 계좌·카드는 지울 수 없고 「사용 안 함」으로 바꿉니다 — 목록에서 숨기고, 올린 자료에는 이름이 그대로 보입니다.</span></div>`;
};
CHG["st-type"] = (d, el) => { draft().type = el.value; draft().dirty = true; render(); };
CHG["st-half"] = (d, el) => { draft().halfYear = el.value === "h"; draft().dirty = true; render(); };
CHG["st-f"] = (d, el) => { draft()[d.l][d.i][d.k] = el.value; setDirty(); };
INP["st-f"] = (d, el) => { const st = draft(); st[d.l][d.i][d.k] = el.value; if (st.errs) { st.errs = st.errs.filter((x) => x !== el.id); el.classList.remove("is-err"); } setDirty(); };
CHG["st-sel"] = (d, el) => { const s = draft().sel[d.l], i = Number(d.i); el.checked ? s.push(i) : s.splice(s.indexOf(i), 1); render(); };
CHG["st-unused"] = (d, el) => { const u = draft().unused; el.checked ? u.push(d.k) : u.splice(u.indexOf(d.k), 1); draft().dirty = true; render(); };
ACT["st-add"] = (d) => {
  const L = draft()[d.l];
  if (d.l === "taxEmails") L.push({ name: "", email: "" });
  if (d.l === "accounts") L.push({ id: "a" + Date.now(), bank: D.BANKS[0], no: "", alias: "" });
  if (d.l === "cards") L.push({ id: "c" + Date.now(), co: D.CARDCOS[0], last4: "", alias: "" });
  draft().dirty = true; render();
};
ACT["st-del"] = (d) => {
  const st = draft(), L = st[d.l], idx = [...st.sel[d.l]].sort((a, b) => b - a);
  const del = () => { idx.forEach((i) => L.splice(i, 1)); st.sel[d.l] = []; st.dirty = true; };
  const filled = idx.map((i) => L[i]).filter((x) => x.no || x.last4 || x.alias);
  if (d.l === "taxEmails") {
    const fe = idx.map((i) => L[i]).filter((x) => x.name || x.email);
    if (!fe.length) { del(); render(); return; }
    modal({ type: "confirm", red: true, icon: "trash-2", title: idx.length > 1 ? `메일 ${idx.length}개를 지우시겠습니까?` : "이 메일을 지우시겠습니까?", ok: "삭제",
      body: `${fe.map((x) => `<b>${esc(x.name)}</b> ${esc(x.email)}`).join("<br>")}<br>[저장]을 눌러야 반영됩니다.`, run: del });
    return;
  }
  if (!filled.length) { del(); render(); return; }
  const what = d.l === "accounts" ? "계좌" : "카드";
  modal({ type: "confirm", red: true, icon: "trash-2", title: idx.length > 1 ? `${what} ${idx.length}개를 지우시겠습니까?` : `이 ${what}${jo(what, "을/를")} 지우시겠습니까?`, ok: "삭제",
    body: `${filled.map((x) => `<b>${esc(x.bank || x.co)} · ${esc(x.alias)}</b>`).join("<br>")}<br>이 ${what}${jo(what, "으로")} 올린 자료는 없습니다. [저장]을 눌러야 반영됩니다.`, run: del });
};
ACT["st-off"] = (d) => { const st = draft(); st.sel[d.l].forEach((i) => { st[d.l][i].off = true; }); st.sel[d.l] = []; st.dirty = true; render(); toast("사용 안 함으로 바꿨습니다 · [저장]을 눌러야 반영됩니다"); };
ACT["st-on"] = (d) => { const st = draft(); st[d.l][d.i].off = false; st.dirty = true; render(); };
ACT["st-save"] = () => {
  /* 입력 모양 검사 — 실제는 ERP 공통 숫자·메일 모양 부품을 씀 */
  const st = draft(), errs = [];
  st.taxEmails.forEach((e, i) => { if (e.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email)) errs.push("te-e" + i); });
  st.accounts.forEach((a, i) => { const dg = (a.no || "").replace(/-/g, ""); if (!a.off && a.no && (!/^[\d-]+$/.test(a.no) || dg.length < 10 || dg.length > 14)) errs.push("ac-n" + i); });
  st.cards.forEach((c, i) => { if (!c.off && c.last4 && !/^\d{4}$/.test(c.last4)) errs.push("cd-n" + i); });
  st.errs = errs;
  if (errs.length) { render(); return; }
  const { sel, dirty, type, ...rest } = draft();
  S.settings = clone(rest); S.type = type; S.ui.draft = null; render(); toast("세무 설정을 저장했습니다");
};
