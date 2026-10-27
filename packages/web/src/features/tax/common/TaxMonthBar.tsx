'use client';

/**
 * 세무 「작업할 달」 줄 — 결과서 0-2 · 시안 `ctx()`.
 *
 *   「작업할 달」 라벨 · [‹ 2026년 9월 ›] · [지난달로](작업할 달이 지난달이 아닐 때만) · 오른쪽 안내(13px 회색)
 *
 * ★ 달은 **주소 `?month=`** 에 싣는다(결정 2026-10-26) — 세무 화면끼리 같은 달로 이어지고 새로고침해도 남는다.
 *   처음 값은 지난달, 고를 수 있는 끝은 이번 달(`workMonthOf`). 바꾸면 같은 화면을 그 달로 다시 연다.
 * ★ 거래처 · 세무 설정처럼 달과 상관없는 화면은 이 줄 대신 안내 글만 둔다(결과서 0-2).
 */
import { usePathname, useRouter } from 'next/navigation';
import { addMonths, previousMonthOf, thisMonthOf } from '@swonbiz/shared/domain/tax-uploads';
import { Icon } from '@/components/ds';
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
  /** 오른쪽 안내 — 「오늘 2026년 10월 26일 · 법인」. */
  note: string;
}

export function TaxMonthBar({ month, note }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const today = new Date();
  const last = previousMonthOf(today);
  const go = (m: string) => router.push(`${pathname}?month=${m}`);

  return (
    <div className={t.ctx}>
      <div className={t.ctxL}>
        <span className={t.ctxLab}>작업할 달</span>
        <span className={t.month}>
          <button type="button" aria-label="이전 달" onClick={() => go(addMonths(month, -1))}>
            <Icon name="chevron-left" size={16} />
          </button>
          <span className={t.monthV}>{monthLabel(month)}</span>
          <button
            type="button"
            aria-label="다음 달"
            disabled={month >= thisMonthOf(today)}
            onClick={() => go(addMonths(month, 1))}
          >
            <Icon name="chevron-right" size={16} />
          </button>
        </span>
        {month !== last ? (
          <button type="button" className={`${t.btn} ${t.btnLink}`} style={{ fontSize: 13 }} onClick={() => go(last)}>
            지난달로
          </button>
        ) : null}
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
