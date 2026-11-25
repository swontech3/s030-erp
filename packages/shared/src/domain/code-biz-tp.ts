/**
 * 코드 관리(s030100030) 왼쪽 목록의 「업무구분」 — 그 코드가 어느 표에서 왔는가(2026-11-19).
 *
 *   공통 코드 분류 `CODE_BIZ_TP` / 파티션 `000` — 코드값 둘(일회용 40 이 넣는다):
 *     BBIYONG — 삐용 공통 코드 표(`tb_s020_code010`)의 종류
 *     ERP     — ERP 공통 코드 표(`tb_s080_code_*`)의 분류
 *   · 이름 칸(사람이 읽는 이름)이 걸러 보기 선택지 · 목록 딱지에 그대로 보인다 — 화면은 이름을 들고 있지 않다.
 *   · 코드값은 앱이 판정한다(그 줄이 온 표) — 고정 코드(`PINNED_CODES`)라 코드 관리에서 코드값 변경 · 삭제가 막힌다.
 *
 * ★ 이 코드가 없으면(일회용 40 전) 걸러 보기에 「업무구분 전체」만 보이고 딱지에는 코드값이 찍힌다.
 */
export const CODE_BIZ_TP_CATEGORY = 'CODE_BIZ_TP';
export const CODE_BIZ_TP_USE_TP = '000';

/** 화면의 업무구분(`bbiyong` · `erp`) → 공통 코드값. ★ 코드값을 바꾸면 이 표도 바꾼다. */
export const CODE_BIZ_TP_CODES = { bbiyong: 'BBIYONG', erp: 'ERP' } as const;

export type CodeBizTp = keyof typeof CODE_BIZ_TP_CODES;

/** 공통 코드값 → 화면의 업무구분. 모르는 값이면 null. */
export function codeBizTpOf(code: string): CodeBizTp | null {
  for (const k of Object.keys(CODE_BIZ_TP_CODES) as CodeBizTp[]) if (CODE_BIZ_TP_CODES[k] === code) return k;
  return null;
}

/**
 * `GET /codes` 응답 → 업무구분 선택지(받은 순서 = 코드 순서). 이 분류의 줄 가운데 앱이 아는 코드값만 —
 * 모르는 코드값은 고를 줄이 없어 뺀다. 이름이 비면 코드값을 보인다.
 */
export function codeBizTpOptions(
  codes: readonly { category: string; code: string; name: string | null }[],
): { tp: CodeBizTp; code: string; name: string }[] {
  const out: { tp: CodeBizTp; code: string; name: string }[] = [];
  for (const c of codes) {
    if (c.category !== CODE_BIZ_TP_CATEGORY) continue;
    const tp = codeBizTpOf(c.code);
    if (!tp || out.some((o) => o.tp === tp)) continue;
    out.push({ tp, code: c.code, name: c.name?.trim() || c.code });
  }
  return out;
}

/** 목록 딱지 글자 — 선택지에 있으면 그 이름, 없으면(코드를 못 읽음) 코드값. */
export function codeBizTpLabel(tp: CodeBizTp, options: readonly { tp: CodeBizTp; name: string }[]): string {
  return options.find((o) => o.tp === tp)?.name ?? CODE_BIZ_TP_CODES[tp];
}
