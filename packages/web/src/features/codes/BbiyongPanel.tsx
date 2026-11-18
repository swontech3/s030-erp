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
import { Button, Icon } from '@/components/ds';
import { LoadingBar } from '@/components/patterns/LoadingBar';
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

const EMPTY_FILTER = { code: '', name: '' };

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
          <h2 className={styles.panelTitle}>
            {type.cdTpMeaning}({bbiyongTypeLabel(type)})
          </h2>
          <p className={styles.panelSub}>주인 삐용 — 삐용 공통 코드 표에 있습니다. 지우는 대신 「사용 안 함」으로 바꿉니다.</p>
        </div>
        <div className={styles.actions}>
          <Button size="sm" variant="primary" onClick={() => setDialog({ value: null })}>
            <Icon name="plus" size={16} />
            코드값 추가
          </Button>
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
        <button type="button" className={`${styles.btnXs} ${styles.searchBtn}`} onClick={() => setFilter(filterInput)}>
          조회
        </button>
        <button
          type="button"
          className={`${styles.btnXs} ${styles.searchBtn}`}
          onClick={() => {
            setFilterInput(EMPTY_FILTER);
            setFilter(EMPTY_FILTER);
          }}
        >
          초기화
        </button>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>코드값</th>
              <th>코드값 이름</th>
              <th className={styles.num}>순서</th>
              <th className={styles.center}>사용여부</th>
              <th className={styles.center}>동작</th>
            </tr>
          </thead>
          <tbody>
            {busy ? null : shown.length === 0 ? (
              <tr>
                <td colSpan={5} className={styles.center}>
                  {values.length === 0 ? '코드값이 없습니다' : '조회 결과가 없습니다'}
                </td>
              </tr>
            ) : (
              shown.map((v) => (
                <tr key={v.cdV} className={v.useYn === 'Y' ? undefined : styles.rowOff}>
                  <td className={styles.code}>{v.cdV}</td>
                  <td>{v.cdVMeaning}</td>
                  <td className={styles.num}>{v.sortSeq ?? ''}</td>
                  <td className={styles.center}>
                    <span className={`${styles.tag} ${v.useYn === 'Y' ? styles.tagOn : styles.tagOff}`}>
                      {v.useYn === 'Y' ? '사용' : '사용 안 함'}
                    </span>
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <button type="button" className={styles.btnXs} onClick={() => setDialog({ value: v })}>
                        수정
                      </button>
                      <button type="button" className={styles.btnXs} onClick={() => void switchUse(v)}>
                        {v.useYn === 'Y' ? '사용 안 함' : '다시 사용'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
