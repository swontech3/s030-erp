# 계산·입력 로직

모든 금액은 천단위 콤마 + `tabular-nums` + 우측 정렬.

---

## 1. 행 단위 계산 (계약 항목)

```
호실 선택
  → 그 행의 월회비   = Room.baseFee        (ReadOnly)
  → 그 행의 예치금   = Room.baseFee        (수정 가능)
  → 그 행의 월이용료 = Room.baseFee        (수정 가능)
  ※ 호실을 다시 바꾸면 세 값 모두 갱신 — 사용자 수정분을 덮어씁니다.
     호실이 새 기준선이기 때문입니다.

월이용료 변경 또는 계산서발행 토글
  → 그 행의 부가세액 = 계산서발행 ? round(월이용료 × 0.1) : 0
  → 그 행의 납부액   = 월이용료 + 부가세액

월이용료 ≠ 월회비
  → 그 행 월이용료 아래에 차액 표시 "-50,000" (12px/700 --color-primary)
```

부가세액이 0일 때도 빈칸이 아니라 **"0"** 을 표시합니다.

---

## 2. 합계

```js
const totals = items.reduce((t, it) => ({
  deposit: t.deposit + (it.deposit || 0),
  base:    t.base    + baseFeeOf(it.room),
  fee:     t.fee     + (it.fee || 0),
  vat:     t.vat     + (it.invoice === false ? 0 : Math.round((it.fee || 0) * 0.1)),
}), { deposit: 0, base: 0, fee: 0, vat: 0 });

totals.monthly = totals.fee + totals.vat;
```

부가세는 **행별 플래그를 따릅니다.** 합계에 일괄 0.1 을 곱하지 마세요 —
일부 항목만 계산서를 발행하는 경우 금액이 어긋납니다.

---

## 3. 계약 조건 계산

### 종료일
```js
// 시작일 + 기간(개월) − 1일
const d = new Date(startDate);
d.setMonth(d.getMonth() + months);
d.setDate(d.getDate() - 1);
endDate = d;
```

### 첫달납부액
```
월납    첫달납부액 = 예치금 합계 + 월납부액 합계
일시불  첫달납부액 = 예치금 합계 + (기간 × 월납부액 합계)
```

일시불일 때만 필드 아래 12px `--text-muted` 로 산식을 표시합니다.
`"예치금 + " + months + "개월 × " + comma(monthly) + "원"`

---

## 4. 할인 계산

```js
const diff = totals.fee - totals.base;              // 음수면 할인
const pct  = Math.abs(diff / totals.base * 100).toFixed(1);
const line = "기준가 대비 " + (diff < 0 ? "-" : "+") + comma(Math.abs(diff)) +
             "원 (" + pct + (diff < 0 ? "% 할인)" : "% 추가)");
```

**특기사항 첫 줄에 자동 기재합니다.**

```js
const lines   = textarea.value.split("\n");
const hasAuto = lines[0] && lines[0].startsWith("기준가 대비 ");
const rest    = hasAuto ? lines.slice(1) : lines;        // 사용자 입력분 보존
textarea.value = line ? [line, ...rest].join("\n") : rest.join("\n");
```

- 금액이 바뀌면 **첫 줄만 교체**합니다 (중복 누적 금지)
- 할인이 사라지면 첫 줄을 제거합니다
- 사용자가 직접 수정·삭제할 수 있습니다

---

## 5. 입력 포맷

### 천단위 콤마 + 커서 보정 — ★ 필수

콤마를 다시 넣으면 커서가 맨 앞으로 튀어 **두 번째 글자부터 입력이 막힙니다.**

```js
function formatMoney(el) {
  const prevLen = el.value.length;
  const prevPos = el.selectionStart;

  const digits    = el.value.replace(/[^0-9]/g, "");
  const formatted = digits ? Number(digits).toLocaleString("ko-KR") : "";
  el.value = formatted;

  const pos = Math.max(0, Math.min(formatted.length, prevPos + (formatted.length - prevLen)));
  try { el.setSelectionRange(pos, pos); } catch (err) { /* detached */ }
}

el.setAttribute("inputmode", "numeric");
el.addEventListener("input", () => formatMoney(el));
el.addEventListener("paste", () => setTimeout(() => formatMoney(el), 0));
```

- `type="number"` 를 쓰지 않습니다 (콤마 불가)
- `maxlength` 로 제한하지 않습니다 (콤마가 포함돼 실제 숫자보다 빨리 걸림)
- **입력 중에 행 전체를 다시 렌더링하지 마세요** — 포커스를 잃습니다.
  파생 셀(부가세액·납부액·합계)의 값만 직접 갱신하세요.

### 마스크 3종

```js
function mask(el, kind) {
  const max = kind === "corpno" ? 13 : kind === "phone" ? 11 : 10;
  const d = el.value.replace(/\D/g, "").slice(0, max);

  if (kind === "bizno") {          // 000-00-00000
    el.value = d.length > 5 ? d.slice(0,3) + "-" + d.slice(3,5) + "-" + d.slice(5)
             : d.length > 3 ? d.slice(0,3) + "-" + d.slice(3) : d;
  } else if (kind === "corpno") {  // 000000-0000000
    el.value = d.length > 6 ? d.slice(0,6) + "-" + d.slice(6) : d;
  } else {                         // 010-0000-0000 / 02-000-0000
    const mid = d.startsWith("010") || d.length > 10 ? 7 : 6;
    el.value = d.length > mid ? d.slice(0,3) + "-" + d.slice(3,mid) + "-" + d.slice(mid)
             : d.length > 3 ? d.slice(0,3) + "-" + d.slice(3) : d;
  }
}
```

placeholder — `000-00-00000` / `000000-0000000` / `010-0000-0000`
기간(월)은 숫자 3자리까지만 받습니다.

---

## 6. 재계산 트리거

| 변경 | 갱신 대상 |
|---|---|
| 행 호실 선택 | 그 행 월회비·예치금·월이용료 → 부가세액·납부액 → 전체 합계 → 첫달납부액 → 할인 줄 |
| 행 예치금 변경 | 예치금 합계 → 첫달납부액 |
| 행 월이용료 변경 | 그 행 부가세액·납부액 → 월이용료·부가세액·월납부액 합계 → 첫달납부액 → 할인 줄 |
| 행 계산서발행 토글 | 그 행 부가세액·납부액 → 부가세액·월납부액 합계 → 첫달납부액 |
| 행 추가·삭제 | 전체 합계 재계산 |
| 납부방법 변경 | 첫달납부액 (+ 산식 표시 여부) |
| 기간(월) 변경 | 종료일, 첫달납부액(일시불일 때) |
| 시작일 변경 | 종료일 |
| 회원구분 변경 | 법인등록번호 활성 여부, 첨부 서류 뱃지·카드 표시 |
| 섹션 1 대표자·연락처·이메일 변경 | 섹션 3 1행 미러링 |
| 계약구분 변경 | 없음 (섹션 3 행 수와 연동하지 않습니다) |
