'use client';

/**
 * 코드 관리 오른쪽 — **주인이 삐용인 종류**를 골랐을 때(통합 방 · 대표 결정 2026-11-18).
 *
 * ★ 삐용 화면 API(명세 118)로 보고 고친다 — 값 목록(사용 안 함 줄도) · 추가 · 수정(이름 · 순서) ·
 *   [사용 안 함] · [다시 사용]. 지우기 · 사용타입이 없다(삐용 표에 그 개념이 없다).
 * ★ 볼 수 있는지 · 고칠 수 있는지는 **삐용이** 정한다 — 버튼을 미리 잠그지 않고, 거절 문구를 그대로 보인다.
 * ★ ERP 쪽 오른쪽(`CodesView`)과 같은 칸 모양 · 같은 「불러오는 중」/「없음」 가르기를 쓴다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Icon, Table, TableEmpty, TableHead, TableRow, tableCell } from '@/components/ds';
import { ListNote } from '@/components/patterns/ListFrame';
import { LoadingBar } from '@/components/patterns/LoadingBar';
import { BTN_XS } from '@/features/billing/BillingTable';
import { cf } from '@/features/facility/ModalShell';
import {
  CodesError,
  bbiyongTypeLabel,
  loadBbiyongValues,
  reuseBbiyongValue,
  unuseBbiyongValue,
  type BbiyongCodeType,
  type BbiyongCodeValue,
} from './codes-model';
import { BbiyongValueDialog } from './BbiyongValueDialog';
import styles from './codes.module.css';
import view from './codes-view.module.css';

const EMPTY_FILTER = { code: '', name: '' };

/*
 * ★ 2026-11-25 센터·기준관리 일관성 — 공통 표(Table) 칸 폭(종전 <table> 자동 폭).
 *   코드값 | 코드값 이름 | 순서 56 | 사용여부 96(「사용 안 함」 딱지) | 동작 152(30px 단추 「수정」「사용 안 함」 + 사이 6)
 */
const VALUE_COLS = 'minmax(0, 1fr) minmax(0, 2fr) 56px 96px 152px';

interface Props {
  type: BbiyongCodeType;
  /** 쓰고 나면 왼쪽 건수도 새로 받는다. */
  onChanged: () => void;
}

export function BbiyongPanel({ type, onChanged }: Props) {
  const [values, setValues] = useState<BbiyongCodeValue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ value: BbiyongCodeValue | null } | null>(null);
  const [filterInput, setFilterInput] = useState(EMPTY_FILTER);
  const [filter, setFilter] = useState(EMPTY_FILTER);

  /* ★ 종류 글자로 다시 받는다 — 왼쪽 건수를 새로 받아 `type` 객체가 바뀌어도 오른쪽은 그대로 둔다. */
  const { category, cdTp } = type;
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const page = await loadBbiyongValues({ category, cdTp });
      setValues(page.values);
      setError(null);
    } catch (err) {
      setValues([]);
      setError(err instanceof CodesError ? err.message : '코드값을 불러오지 못했습니다');
    } finally {
      setBusy(false);
    }
  }, [category, cdTp]);

  useEffect(() => {
    setNotice(null);
    setFilterInput(EMPTY_FILTER);
    setFilter(EMPTY_FILTER);
    void refresh();
  }, [refresh]);

  const shown = useMemo(
    () =>
      values.filter((v) => {
        if (filter.code && !v.cdV.toLowerCase().includes(filter.code.toLowerCase())) return false;
        if (filter.name && !v.cdVMeaning.includes(filter.name)) return false;
        return true;
      }),
    [values, filter],
  );

  const afterWrite = async (message?: string) => {
    setDialog(null);
    setNotice(message ?? null);
    await refresh();
    onChanged();
  };

  async function switchUse(v: BbiyongCodeValue) {
    setNotice(null);
    try {
      const out = await (v.useYn === 'Y' ? unuseBbiyongValue(v) : reuseBbiyongValue(v));
      await afterWrite(out.message || undefined);
    } catch (err) {
      setError(err instanceof CodesError ? err.message : '바꾸지 못했습니다');
    }
  }

  return (
    <>
      {busy ? <LoadingBar /> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {notice ? <p className={styles.formNote}>{notice}</p> : null}

      <div className={styles.panelHead}>
        <div>
          {/* ★ 2026-11-25 일관성 — 구역 제목 = 왼쪽 4px 아쿠아 막대(글자에만) */}
          <h2 className={`${styles.panelTitle} ${view.sectionTitle}`}>
            {type.cdTpMeaning}({bbiyongTypeLabel(type)})
          </h2>
          <p className={styles.panelSub}>주인 삐용 — 삐용 공통 코드 표에 있습니다. 지우는 대신 「사용 안 함」으로 바꿉니다.</p>
        </div>
      </div>

      <div className={styles.panelSearch}>
        <input
          className={`${cf.input} ${styles.panelSearchInput}`}
          value={filterInput.code}
          onChange={(e) => setFilterInput((f) => ({ ...f, code: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && setFilter(filterInput)}
          placeholder="코드값"
          aria-label="코드값"
        />
        <input
          className={`${cf.input} ${styles.panelSearchInput}`}
          value={filterInput.name}
          onChange={(e) => setFilterInput((f) => ({ ...f, name: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && setFilter(filterInput)}
          placeholder="코드값 이름"
          aria-label="코드값 이름"
        />
        {/* ★ 2026-11-25 일관성 — 오른쪽 끝 [초기화][조회](보통 단추) 다음 「n건」 */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setFilterInput(EMPTY_FILTER);
            setFilter(EMPTY_FILTER);
          }}
        >
          초기화
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setFilter(filterInput)}>
          조회
        </Button>
        <ListNote>{busy ? '' : `${shown.length}건`}</ListNote>
      </div>

      {/* ★ 2026-11-25 일관성 — 등록 = 보통 단추 · 표 위 왼쪽(종전 제목 줄 오른쪽 주 단추) */}
      <div className={view.listBar}>
        <Button
          size="sm"
          variant="ghost"
          iconLeft={<Icon name="plus" size={16} />}
          onClick={() => setDialog({ value: null })}
        >
          코드값 추가
        </Button>
      </div>

      <div className={styles.tableWrap}>
        {/* ★ 2026-11-25 일관성 — 공통 표(Table · 머리글 아쿠아) */}
        <Table cols={VALUE_COLS}>
          <TableHead sticky className={view.lineGrid}>
            <span>코드값</span>
            <span>코드값 이름</span>
            <span className={tableCell.right}>순서</span>
            <span className={tableCell.center}>사용여부</span>
            <span className={tableCell.center}>동작</span>
          </TableHead>
          {busy ? null : shown.length === 0 ? (
            <TableEmpty>{values.length === 0 ? '코드값이 없습니다' : '조회 결과가 없습니다'}</TableEmpty>
          ) : (
            shown.map((v) => (
              <TableRow key={v.cdV} className={view.lineGrid} muted={v.useYn !== 'Y'}>
                <span className={styles.code}>{v.cdV}</span>
                <span>{v.cdVMeaning}</span>
                <span className={`${styles.num} ${tableCell.right}`}>{v.sortSeq ?? ''}</span>
                <span className={tableCell.center}>
                  <span className={`${styles.tag} ${v.useYn === 'Y' ? styles.tagOn : styles.tagOff}`}>
                    {v.useYn === 'Y' ? '사용' : '사용 안 함'}
                  </span>
                </span>
                <span className={styles.rowActions}>
                  <Button variant="ghost" size="sm" style={BTN_XS} onClick={() => setDialog({ value: v })}>
                    수정
                  </Button>
                  <Button variant="ghost" size="sm" style={BTN_XS} onClick={() => void switchUse(v)}>
                    {v.useYn === 'Y' ? '사용 안 함' : '다시 사용'}
                  </Button>
                </span>
              </TableRow>
            ))
          )}
        </Table>
      </div>

      <div className={styles.panelFoot}>
        <span>
          코드값 {values.length}개 · 사용 {values.filter((v) => v.useYn === 'Y').length}개
        </span>
        {!busy && shown.length !== values.length ? <span className={styles.panelFootSub}>조회 {shown.length}건</span> : null}
      </div>

      {dialog ? (
        <BbiyongValueDialog
          type={type}
          value={dialog.value}
          onClose={() => setDialog(null)}
          onSaved={() => void afterWrite()}
        />
      ) : null}
    </>
  );
}
