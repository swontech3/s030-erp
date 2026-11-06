'use client';

/**
 * 세무 달 고르기 줄 — 결과서 0-2 · 시안 `ctx()`. 11-06 대표 수정: 연도 · 월 선택 상자 두 개로 바로 고른다.
 *
 *   [2026년 ▾] [9월 ▾] · 오른쪽 안내(13px 회색). 「작업할 달」 · 「지난달로」 글자는 없다.
 *
 * ★ 달은 **주소 `?month=`** 에 싣는다(결정 2026-10-26) — 세무 화면끼리 같은 달로 이어지고 새로고침해도 남는다.
 *   처음 값은 지난달, 고를 수 있는 끝은 이번 달(`workMonthOf`). 바꾸면 같은 화면을 그 달로 다시 연다.
 * ★ 연도 선택지는 올해 포함 최근 3년(작업할 달이 더 앞이면 그 해부터) — shared `taxYearOptions`(11-06 대표 결정).
 * ★ `picker` 를 주면 선택 상자 대신 그것을 그 자리에 둔다 — 부가세 조회의 신고 기간 선택 상자(11-06).
 * ★ 거래처 · 세무 설정처럼 달과 상관없는 화면은 이 줄 대신 안내 글만 둔다(결과서 0-2).
 */
import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { pickTaxMonth, taxMonthOptions, taxYearOptions, thisMonthOf } from '@swonbiz/shared/domain/tax-uploads';
import t from './tax.module.css';

/** `2026-09` → 「2026년 9월」. */
export const monthLabel = (month: string): string => {
  const [y, m] = month.split('-');
  return `${y}년 ${Number(m)}월`;
};

/** 「{M}월」 — 칸 이름 · 배지에 쓴다. */
export const monthShort = (month: string): string => `${Number(month.split('-')[1])}월`;

interface Props {
  month: string;
  /** 오른쪽 안내 — 「오늘 2026년 10월 26일 · 법인」 · 「부가세를 뺀 금액입니다.」 · 마감 + 버튼. */
  note: ReactNode;
  /** 연도 · 월 선택 상자 대신 둘 것(부가세 조회의 신고 기간). */
  picker?: ReactNode;
}

const SELECT_STYLE = { height: 32, width: 'auto' } as const;

export function TaxMonthBar({ month, note, picker }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const now = thisMonthOf(new Date());
  const year = month.slice(0, 4);
  const go = (m: string) => {
    if (m !== month) router.push(`${pathname}?month=${m}`);
  };

  return (
    <div className={t.ctx}>
      <div className={t.ctxL}>
        {picker ?? (
          <>
            <select
              className={t.select}
              style={SELECT_STYLE}
              aria-label="연도"
              value={year}
              onChange={(e) => go(pickTaxMonth(e.target.value, month.slice(5), now))}
            >
              {taxYearOptions(month, now).map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
            <select className={t.select} style={SELECT_STYLE} aria-label="월" value={month} onChange={(e) => go(e.target.value)}>
              {taxMonthOptions(year, now).map((m) => (
                <option key={m} value={m}>
                  {monthShort(m)}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <span className={t.ctxNote}>{note}</span>
    </div>
  );
}

/** 「오늘 2026년 10월 26일」 + 사업자 유형(있으면). */
export function todayNote(bizTypeName: string | null): string {
  const d = new Date();
  const base = `오늘 ${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  return bizTypeName ? `${base} · ${bizTypeName}` : base;
}
