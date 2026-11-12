'use client';

/**
 * 세금 납부 · 4대보험 · 대출내역(2026-11-08 대표 수정 ⑥ — 한 화면의 탭을 메뉴 셋으로 나눔) 공통 — 불러오기 · 파일 띠 · 빈 줄.
 *
 * ★ 세 화면은 같은 API(`/api/tax/payments`, tab = PAY · NTAX · LTAX / SOCIAL / LOAN)를 쓴다. 서버 계산 · 엑셀 시트 함수(세무사 전달 서류가 씀)는 그대로.
 * ★ 짜임은 거래처 · 항목 지정과 같다 — 검색조건 카드 / 목록 카드(목록만 스크롤 · 머리 고정). [엑셀 내려받기]는 2026-11-08 없앴다.
 */
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Icon } from '@/components/ds';
import t from '../common/tax.module.css';
import { TaxEmpty } from '../common/TaxEmpty';
import { TaxPaymentsError, loadPayments, type PaymentsQuery, type TaxPaymentsResponse } from './tax-payments-model';

/** `2026-09-25` → 「09.25」. */
export const shortDate = (date: string): string => `${date.slice(5, 7)}.${date.slice(8, 10)}`;

/** 목록에 없는 값. */
export const DASH = '—';

export const codeName = (list: readonly { code: string; name: string }[], code: string) =>
  list.find((c) => c.code === code)?.name ?? code;

/** 검색조건이 바뀌면 다시 읽는다. */
export function usePayments(query: PaymentsQuery, failText: string) {
  const [data, setData] = useState<TaxPaymentsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const key = JSON.stringify(query);
  const reload = useCallback(
    () =>
      loadPayments(JSON.parse(key) as PaymentsQuery)
        .then((d) => {
          setData(d);
          setLoadError(null);
        })
        .catch((err: unknown) => setLoadError(err instanceof TaxPaymentsError ? err.message : failText)),
    [key, failText],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, loadError };
}

/** 자료 올리기 [보기]로 들어왔을 때 검색조건 오른쪽 — 파일 이름 + [모두 보기](주소에서 파일을 빼면 새로 그린다). */
export function FileNote({ file, month }: { file: { fileName: string } | null; month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  if (!file) return null;
  return (
    <span className={t.row} style={{ gap: 8, flexWrap: 'nowrap' }}>
      <Icon name="file-text" size={16} />
      <span className={t.ell} style={{ maxWidth: 260 }} title={file.fileName}>
        「{file.fileName}」 파일로 들어온 줄만 보는 중
      </span>
      <button type="button" className={`${t.btn} ${t.btnSm}`} onClick={() => router.replace(`${pathname}?month=${month}`)}>
        모두 보기
      </button>
    </span>
  );
}

/** 빈 목록 한 줄. */
export function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className={t.empty}>
        <TaxEmpty icon="receipt" lead="해당하는 줄이 없습니다" />
      </td>
    </tr>
  );
}
