/* S05-12 직원 급여 (s050300030) — 급여대장 업로드 대신 이 화면에서 적습니다 */
const EMP_KINDS = ["정규직", "프리랜서(3.3%)"];          // 구분 선택지 — 실제는 코드 표에서 읽음
/* 끝수 처리 — 10원 미만 버림. 실제는 코드 표에서 읽고 근거 조문을 함께 둠 */
const fl10 = (n) => Math.floor(n / 10) * 10;
const empTot = (e) => e.base + e.bonus + e.allow;
const isFree = (e) => e.kind !== "정규직";
function freeTax(e) { const p = empTot(e), tax = fl10(p * 0.03), local = fl10(tax * 0.1); return { tax, local, net: p - tax - local }; }
const socOf = (e) => D.socialPeople[e.no];   // 4대보험 자료에서 사번으로 찾음
/* 4대보험 자료에 없는 정규직 수 — 할 일 2단계 숫자와 같은 값 (실제는 서버 한 곳에서 셈) */
const empMiss = () => S.emps.filter((e) => !e.off && !isFree(e) && !socOf(e)).length;
const empBadge = () => (!S.empSaved ? `<span class="badge b-todo">저장 전</span>` : empMiss() ? `<span class="badge b-doing">4대보험 자료에 없음 ${empMiss()}명</span>` : `<span class="badge b-done">모두 맞음</span>`);
const socSum = (s) => s.pension + s.health + s.ltc + s.emp;

/* 원천세(S05-07)가 쓰는 값 — 정규직 소득세 · 지방소득세는 세무사 계산(null) */
function payrollRows() {
  return S.emps.filter((e) => !e.off).map((e) => isFree(e)
    ? { name: e.name, kind: "사업", pay: empTot(e), tax: freeTax(e).tax, local: freeTax(e).local, note: "프리랜서 3.3%" }
    : { name: e.name, kind: "근로", pay: empTot(e), tax: null, local: null });
}
const txv = (v) => (v == null ? `<span class="mut">세무사 계산</span>` : won(v));

/* 고치는 동안은 사본에 담고 [저장]을 눌러야 반영 */
function edraft() { if (!S.ui.edraft) S.ui.edraft = { rows: clone(S.emps), sel: [], dirty: false }; return S.ui.edraft; }

SCREENS.emp = () => {
  const m = S.month, sep = m === D.DEFAULT_MONTH, next1 = m === "2026-10";
  if (!sep && !next1) return ctx() + head("직원 급여") + notSep();
  const st = edraft(), act = st.rows.map((e, i) => [e, i]).filter(([e]) => !e.off), offs = st.rows.map((e, i) => [e, i]).filter(([e]) => e.off);
  const reg = act.filter(([e]) => !isFree(e)), fr = act.filter(([e]) => isFree(e));
  const miss = reg.filter(([e]) => !socOf(e));
  const n = st.sel.length;
  const sumK = (L, f) => L.reduce((s, [e]) => s + f(e), 0);
  const row = ([e, i]) => {
    const on = st.sel.includes(i), s = socOf(e), t = isFree(e) ? freeTax(e) : null;
    const ded = t
      ? `<div class="sm tnum">소득세 ${won(t.tax)} · 지방소득세 ${won(t.local)}</div><div class="sm tnum">실지급 <b style="color:var(--text-heading)">${won(t.net)}</b></div>`
      : s ? `<div class="sm tnum">연금 ${won(s.pension)} · 건강 ${won(s.health)} · 장기요양 ${won(s.ltc)} · 고용 ${won(s.emp)}</div><div class="sm">소득세 · 지방소득세 <b>세무사 계산</b></div>`
      : `<span class="badge b-danger b-sm">4대보험 자료에 없음</span><div class="sm">사번 ${esc(e.no)}로 찾지 못했습니다 · 세금은 세무사 계산</div>`;
    return `<tr class="clickable ${on ? "pick" : ""}" data-act="e-row" data-i="${i}"><td><input type="checkbox" class="rowchk" ${on ? "checked" : ""} aria-label="선택"></td>
      <td class="ell" style="font-weight:700">${esc(e.name)}</td><td class="tnum mut">${esc(e.no)}</td><td><span class="badge ${isFree(e) ? "b-line" : "b-todo"}">${isFree(e) ? "프리랜서" : "정규직"}</span></td>
      <td class="num">${won(e.base)}</td><td class="num">${won(e.bonus)}</td><td class="num">${won(e.allow)}</td><td class="num" style="font-weight:700">${won(empTot(e))}</td><td>${ded}</td></tr>`;
  };
  const foot = (lab, L, ded) => `<tr><td></td><td colspan="3" style="font-weight:700">${lab} <span class="sm">${L.length}명</span></td><td class="num" style="font-weight:700">${won(sumK(L, (e) => e.base))}</td><td class="num" style="font-weight:700">${won(sumK(L, (e) => e.bonus))}</td><td class="num" style="font-weight:700">${won(sumK(L, (e) => e.allow))}</td><td class="num" style="font-weight:700">${won(sumK(L, empTot))}</td><td class="sm tnum">${ded}</td></tr>`;
  return ctx() +
    head("직원 급여", "직원마다 그 달에 준 돈을 적습니다. 새 달을 열면 지난달 값을 그대로 불러오므로 바뀐 상여금만 고치면 됩니다. 4대보험 직원 부담은 「4대보험」 자료에서 사번으로 붙여 보여 줍니다.", empBadge()) +
    (next1 ? `<div class="note note--info">${ic("copy")}<span><b>10월 급여는 9월 값을 그대로 불러왔습니다.</b> 바뀐 상여금만 고치고 [저장]하세요.</span></div>` : "") +
    `<div class="note">${ic("info")}<span>정규직 소득세 · 지방소득세는 <b>세무사가 계산</b>합니다. 프리랜서(3.3%)는 소득세 3% · 지방소득세 0.3%를 계산해 보여 줍니다 — 10원 미만은 버립니다.</span></div>` +
    (miss.length ? `<div class="note note--warn">${ic("triangle-alert")}<span><b>4대보험 자료에 없는 정규직 ${miss.length}명</b> — ${miss.map(([e]) => `${esc(e.name)}(${esc(e.no)})`).join(" · ")}. 사번을 확인하거나 4대보험 자료를 다시 올리세요.</span></div>` : "") +
    `<div class="card"><div class="card-pad card-h" style="padding-bottom:12px"><h2>${mShort(m)} 직원 급여 · ${act.length}명</h2><span class="sub">4대보험 직원 부담은 고칠 수 없습니다 — 「4대보험」 자료에서 붙여 옴</span></div>
      <div class="tbar"><button class="btn btn--sm" data-act="e-add">${ic("plus", 14)}추가</button><button class="btn btn--sm" data-act="e-edit" ${n === 1 ? "" : "disabled"}>${ic("pencil", 14)}수정</button><button class="btn btn--sm" data-act="e-off" ${n ? "" : "disabled"}>사용 안 함</button><button class="btn btn--sm btn--primary" data-act="e-save">저장</button><button class="btn btn--sm" data-act="e-xls">${ic("download", 14)}엑셀 내려받기</button><span class="sm" style="color:var(--text-body)">정규직 소득세는 비어 있습니다. 세무사에게 보내 계산을 받으세요.</span>
        <span class="sm">${st.dirty ? `<b style="color:var(--color-warning-text)">저장하지 않은 변경이 있습니다</b>` : n ? `${n}명 선택` : "줄을 고르세요 · 수정은 한 명, 사용 안 함은 여러 명"}</span></div>
      <table class="tbl" style="border-top:1px solid var(--border)"><colgroup><col class="w-chk"><col><col style="width:64px"><col style="width:92px"><col style="width:100px"><col style="width:92px"><col style="width:84px"><col style="width:104px"><col style="width:264px"></colgroup>
      <thead><tr><th></th><th>이름</th><th>사번</th><th>구분</th><th class="num">기본급</th><th class="num">상여금</th><th class="num">수당</th><th class="num">지급 합계</th><th>공제 (직원 부담 · 세금)</th></tr></thead>
      <tbody>${act.map(row).join("") || `<tr><td colspan="9" class="mut" style="text-align:center;padding:32px">직원이 없습니다 · [추가]로 넣으세요</td></tr>`}
      ${reg.length ? foot("정규직 합계", reg, `4대보험 직원 부담 ${won(reg.reduce((s, [e]) => s + (socOf(e) ? socSum(socOf(e)) : 0), 0))} · 세금 세무사 계산`) : ""}
      ${fr.length ? foot("프리랜서 합계", fr, `소득세 ${won(sumK(fr, (e) => freeTax(e).tax))} · 지방소득세 ${won(sumK(fr, (e) => freeTax(e).local))} · 실지급 ${won(sumK(fr, (e) => freeTax(e).net))}`) : ""}</tbody></table>
      ${offs.length ? `<div class="card-pad sm" style="padding-top:10px;padding-bottom:12px;border-top:1px solid var(--border)">사용 안 함 · ${offs.map(([e, i]) => `${esc(e.name)} <button class="btn btn--link" style="font-size:12px" data-act="e-on" data-i="${i}">다시 사용</button>`).join(" · ")}</div>` : ""}</div>`;
};
ACT["e-row"] = (d) => { const s = edraft().sel, i = Number(d.i), k = s.indexOf(i); k < 0 ? s.push(i) : s.splice(k, 1); render(); };
ACT["e-add"] = () => modal({ type: "emp", i: null, v: { name: "", no: "", kind: "정규직", base: "", bonus: "0", allow: "0" }, err: {} });
ACT["e-edit"] = () => { const st = edraft(), i = st.sel[0], e = st.rows[i]; modal({ type: "emp", i, v: { name: e.name, no: e.no, kind: e.kind, base: String(e.base), bonus: String(e.bonus), allow: String(e.allow) }, err: {} }); };
ACT["e-off"] = () => { const st = edraft(); st.sel.forEach((i) => { st.rows[i].off = true; }); st.sel = []; st.dirty = true; render(); toast("사용 안 함으로 바꿨습니다 · [저장]을 눌러야 반영됩니다"); };
ACT["e-on"] = (d) => { const st = edraft(); st.rows[Number(d.i)].off = false; st.dirty = true; render(); };
ACT["e-save"] = () => { S.emps = clone(edraft().rows); S.empSaved = true; S.ui.edraft = null; touched(); render(); toast("직원 급여를 저장했습니다"); };
ACT["e-xls"] = () => toast("직원 급여 엑셀을 내려받습니다 (시안)");
MODALS.emp = (m) => {
  const f = (k, lab, extra = "") => `<label class="field"><span class="lab">${lab}</span><input class="input ${m.err[k] ? "is-err" : ""} ${extra ? "tnum" : ""}" id="em-${k}" value="${esc(m.v[k])}" ${extra} data-inp="em" data-k="${k}">${m.err[k] ? `<span class="err-t">${m.err[k]}</span>` : ""}</label>`;
  return `<div class="modal modal--sm" role="dialog" aria-modal="true"><div class="m-h"><div><h3>${m.i == null ? "직원 추가" : "직원 수정"}</h3><p>[적용] 뒤 목록 위 [저장]을 눌러야 반영됩니다</p></div><button class="icon-btn" data-act="close" aria-label="닫기">${ic("x", 20)}</button></div>
  <div class="m-b"><div class="grid2">${f("name", "이름")}${f("no", "사번")}</div>
    <label class="field"><span class="lab">구분</span><select class="select" data-chg="em-kind">${EMP_KINDS.map((k) => `<option ${(k.startsWith("프리") ? !m.v.kind.startsWith("정규") : m.v.kind === k) ? "selected" : ""}>${k}</option>`).join("")}</select></label>
    <div class="grid3">${f("base", "기본급", 'inputmode="numeric"')}${f("bonus", "상여금", 'inputmode="numeric"')}${f("allow", "수당", 'inputmode="numeric"')}</div></div>
  <div class="m-f"><span class="sp"></span><button class="btn" data-act="close">취소</button><button class="btn btn--primary" data-act="em-ok">적용</button></div></div>`;
};
INP.em = (d, el) => { const m = S.ui.modal; m.v[d.k] = el.value; if (m.err[d.k]) { delete m.err[d.k]; el.classList.remove("is-err"); } };
CHG["em-kind"] = (d, el) => { S.ui.modal.v.kind = el.value.startsWith("프리") ? "프리랜서" : "정규직"; };
ACT["em-ok"] = () => {
  const m = S.ui.modal, v = m.v, st = edraft(), err = {};
  if (!v.name.trim()) err.name = "이름을 입력해 주세요";
  if (!v.no.trim()) err.no = "사번을 입력해 주세요";
  else if (st.rows.some((e, i) => i !== m.i && e.no === v.no.trim())) err.no = "같은 사번이 있습니다";
  ["base", "bonus", "allow"].forEach((k) => { if (!/^\d+$/.test(String(v[k]).replace(/,/g, ""))) err[k] = "숫자만 입력해 주세요"; });
  if (Object.keys(err).length) { m.err = err; render(); return; }
  const row = { name: v.name.trim(), no: v.no.trim(), kind: v.kind, base: +String(v.base).replace(/,/g, ""), bonus: +String(v.bonus).replace(/,/g, ""), allow: +String(v.allow).replace(/,/g, "") };
  if (m.i == null) { row.id = "p" + Date.now(); st.rows.push(row); } else Object.assign(st.rows[m.i], row);
  st.dirty = true; S.ui.modal = null; render(); toast(m.i == null ? "직원을 추가했습니다 · [저장]을 눌러야 반영됩니다" : "고쳤습니다 · [저장]을 눌러야 반영됩니다");
};
