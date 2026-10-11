'use client';

/**
 * 양식 편집 — 법무 표시(5-3, 2026-10-11). 붙이면 이 양식이 법인변경 [서류 출력]에 뜬다.
 *
 * 규칙은 shared `legal-form-mark.ts` 다 — 여기는 고르는 칸만 그린다. 고른 값이 규칙에 맞지 않으면
 * (변경 구분을 하나도 안 고름 등) 사유를 띠 끝에 보이고, [저장] 은 편집기가 막는다. 서버도 같은
 * 함수로 한 번 더 거절한다.
 *
 * ★ **한 줄 띠**다(2026-10-11) — 격자에 세로 폭을 돌려주려고 3행 격자를 가로 한 줄로 접었다. 설명 문구는 뺐다.
 *
 *   출력 단위 — 건마다 한 장 · 임원마다 한 장. 임원마다는 임원변경에만 뜻이 있어 변경 구분을
 *              임원변경 하나로 고정한다(다른 구분 칸은 잠근다)
 *   회사유형 — 전체 · 주식회사 · 유한회사(결정 B). 2종 밖 회사에는 「전체」 양식만 뜬다
 *   임원 구분 — 임원마다일 때만. 여럿 고른다
 *
 * ★ 표시를 떼면 표시 칸이 정의에서 **빠진다**(빈 표시를 남기지 않는다).
 * ★ 선택지 이름은 코드에서 온다(`legalOptions`). 코드에서 꺼진 값이 저장돼 있으면 코드값을 그대로
 *   보인다 — 화면이 저장된 표시를 몰래 지우지 않게.
 */
import { CORP_CHANGE_TYPES, OFFICER_CHANGE_KINDS, OFFICER_CHANGE_KIND_LABEL } from '@swonbiz/shared/domain/corp-change';
import {
  LEGAL_FORM_ALL_COMPANIES,
  LEGAL_FORM_COMPANY_TYPES,
  parseLegalMark,
  type LegalFormMark,
} from '@swonbiz/shared/domain/legal-form-mark';
import type { LegalOptions } from './forms-model';
import styles from './forms.module.css';

/** 처음 붙일 때 — 전체 회사 · 건마다 · 변경 구분은 사람이 고른다. */
const FRESH: LegalFormMark = { domain: 'corp-change', changeTypes: [], companyType: LEGAL_FORM_ALL_COMPANIES, unit: 'case' };

/** 목록 안에서 하나를 켜고 끈다 — 순서는 기준 목록(`all`) 그대로. */
function toggle<T extends string>(list: readonly T[], all: readonly T[], value: T, on: boolean): T[] {
  return all.filter((v) => (v === value ? on : list.includes(v)));
}

/** 표시가 규칙에 맞지 않으면 그 사유 — 편집기가 [저장] 을 막을 때 쓴다. */
export function legalMarkProblem(mark: LegalFormMark | undefined): string | null {
  if (!mark) return null;
  const r = parseLegalMark(mark);
  return r.ok ? null : r.message;
}

export function LegalMarkPanel({
  mark,
  options,
  onChange,
}: {
  mark: LegalFormMark | undefined;
  options: LegalOptions;
  onChange: (next: LegalFormMark | undefined) => void;
}) {
  const nameOf = (list: readonly { code: string; name: string }[], code: string) =>
    list.find((o) => o.code === code)?.name ?? code;
  const problem = legalMarkProblem(mark);
  const perOfficer = mark?.unit === 'officer';

  return (
    // ★ 한 줄 띠(2026-10-11) — 출력 단위 · 변경 구분 · 회사유형(· 임원 구분)을 가로로 나란히, 폭이 모자라면
    //   줄바꿈. 표시를 끄면 체크 하나만 남는다. 덜 고른 사유도 같은 줄 끝에 붙는다(줄을 하나 더 쓰지 않게).
    <div className={styles.legalBox}>
      <label className={styles.check}>
        <input type="checkbox" checked={mark !== undefined} onChange={(e) => onChange(e.target.checked ? FRESH : undefined)} />
        <strong>법인변경 서류로 쓴다</strong>
      </label>

      {mark ? (
        <>
          <span className={styles.legalSep} />
          <span className={styles.legalLabel}>출력 단위</span>
          <label className={styles.check}>
            <input
              type="radio"
              name="legal-unit"
              checked={!perOfficer}
              onChange={() => {
                const { officerKinds: _drop, ...rest } = mark;
                onChange({ ...rest, unit: 'case' });
              }}
            />
            건마다 한 장
          </label>
          <label className={styles.check}>
            <input
              type="radio"
              name="legal-unit"
              checked={perOfficer}
              onChange={() => onChange({ ...mark, unit: 'officer', changeTypes: ['OFFICER'], officerKinds: mark.officerKinds ?? [] })}
            />
            임원마다 한 장
          </label>

          <span className={styles.legalSep} />
          <span className={styles.legalLabel}>변경 구분</span>
          {CORP_CHANGE_TYPES.map((t) => (
            <label key={t} className={styles.check}>
              <input
                type="checkbox"
                disabled={perOfficer}
                checked={mark.changeTypes.includes(t)}
                onChange={(e) => onChange({ ...mark, changeTypes: toggle(mark.changeTypes, CORP_CHANGE_TYPES, t, e.target.checked) })}
              />
              {nameOf(options.changeTypes, t)}
            </label>
          ))}

          <span className={styles.legalSep} />
          <label className={styles.legalLabel}>
            회사유형
            <select
              className={styles.legalSelect}
              value={mark.companyType}
              onChange={(e) => onChange({ ...mark, companyType: e.target.value as LegalFormMark['companyType'] })}
            >
              <option value={LEGAL_FORM_ALL_COMPANIES}>전체</option>
              {LEGAL_FORM_COMPANY_TYPES.map((c) => (
                <option key={c} value={c}>
                  {nameOf(options.companyTypes, c)}
                </option>
              ))}
            </select>
          </label>

          {perOfficer ? (
            <>
              <span className={styles.legalSep} />
              <span className={styles.legalLabel}>임원 구분</span>
              {OFFICER_CHANGE_KINDS.map((k) => (
                <label key={k} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={(mark.officerKinds ?? []).includes(k)}
                    onChange={(e) =>
                      onChange({ ...mark, officerKinds: toggle(mark.officerKinds ?? [], OFFICER_CHANGE_KINDS, k, e.target.checked) })
                    }
                  />
                  {OFFICER_CHANGE_KIND_LABEL[k]}
                </label>
              ))}
            </>
          ) : null}

          {problem ? <span className={styles.legalProblem}>{problem}</span> : null}
        </>
      ) : null}
    </div>
  );
}
