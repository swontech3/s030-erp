'use client';

/** @screen s030100010p1 건물 등록·수정 · 010 기준설정 */

/**
 * 건물 등록·수정.
 *
 * ★ 칸은 레거시 `BuildingForm` 과 **같다** — 건물명\* · 건물주 · 건물주 연락처 ·
 *   사업자등록번호 · 주소 · 계약 시작일/종료일 · 센터장 · 은행명 · 계좌번호 · 예금주 · 비고.
 *
 * ★★ **임대차계약서 첨부가 들어왔다**(2026-10-03). `tb_cm_file.target_type` 에
 *    `'BUILDING'` 을 더해서, 계약 서류와 **같은 기계**로 붙인다 — 새로 만든 것은 없다
 *    (`AttachField`, `domain/facility-files`). 선택이라 없어도 저장된다.
 *
 * ★★ 신규 등록일 때는 붙일 `build_id` 가 **아직 없다.** 그래서 고른 파일을 이 창이
 *    붙들었다가 **저장 직후에** 올린다(`SectionDocs` 가 회사가 없을 때 하는 그 방식).
 *    저장은 됐는데 첨부만 실패하면 **창을 닫지 않고** 사실을 그대로 말한다 — 그때
 *    `savedId` 를 들고 있으므로 다시 [저장] 을 눌러도 건물이 두 개 생기지 않는다.
 *
 * ★ 센터장은 레거시가 직원 셀렉트였다. ERP 에 직원 화면(`tb_s080_employees`)이 아직
 *   없어서 **글 칸**으로 둔다. 멤버 관리(s030200050)가 생기면 셀렉트로 바꾼다.
 */
import { useState } from 'react';
import { FacilityError, saveBuilding, uploadFacilityFile, type Building } from './facility-model';
import { AttachField } from './AttachField';
import { Field, ModalShell, cf } from './ModalShell';
import styles from './facility.module.css';

interface Props {
  /** `null` 이면 신규다. */
  building: Building | null;
  onClose: () => void;
  onSaved: () => void;
}

export function BuildingDialog({ building, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    name: building?.name ?? '',
    address: building?.address ?? '',
    ownerName: building?.ownerName ?? '',
    ownerPhone: building?.ownerPhone ?? '',
    bizRegNo: building?.bizRegNo ?? '',
    contractFrom: building?.contractFrom ?? '',
    contractTo: building?.contractTo ?? '',
    centerManager: building?.centerManager ?? '',
    bankName: building?.bankName ?? '',
    bankAccount: building?.bankAccount ?? '',
    accountHolder: building?.accountHolder ?? '',
    memo: building?.memo ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 아직 건물이 없어 붙들고 있는 임대차계약서. 저장 직후에 올린다. */
  const [doc, setDoc] = useState<File | null>(null);
  /**
   * ★★ 이 창에서 **방금 만든** 건물의 id. 신규 등록에서 저장은 됐는데 첨부만 실패한
   *    경우에 쓴다 — 이 값이 있으면 다음 [저장] 은 POST 가 아니라 PATCH 다.
   */
  const [savedId, setSavedId] = useState<string | null>(null);

  const targetId = building?.buildId ?? savedId;

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await saveBuilding(targetId, form);
      setSavedId(res.buildId);

      if (doc) {
        try {
          await uploadFacilityFile('buildings', res.buildId, doc);
          setDoc(null);
        } catch (err) {
          /*
           * ★ 건물은 이미 저장됐다. 「저장하지 못했습니다」라고 말하면 거짓이 된다 —
           *   무엇이 됐고 무엇이 안 됐는지 그대로 적는다.
           */
          const why = err instanceof FacilityError ? err.message : '파일을 올리지 못했습니다';
          setError(`건물은 저장했습니다 — 첨부만 실패했습니다(${why}). 다시 [저장] 을 누르면 첨부만 올라갑니다`);
          return;
        }
      }
      onSaved();
    } catch (err) {
      setError(err instanceof FacilityError ? err.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title={building ? '건물 수정' : '건물 등록'}
      busy={busy}
      error={error}
      okLabel="저장"
      /* ★ 건물명이 비면 저장을 막는다 — 서버도 400 으로 막지만 눌러 보게 하지 않는다. */
      okDisabled={form.name.trim() === ''}
      /*
       * ★ 이미 저장된 뒤에 닫으면 **목록을 새로 받아야 한다**(`onSaved`). 첨부만 실패해
       *   창이 열려 있는 경우가 그렇다 — `onClose` 로 닫으면 방금 만든 건물이 트리에
       *   나타나지 않는다.
       */
      onClose={savedId ? onSaved : onClose}
      onOk={submit}
    >
      <div className={styles.grid2}>
        <Field label="건물명" full>
          <input className={cf.input} value={form.name} onChange={set('name')} autoFocus />
        </Field>
        <Field label="주소" full>
          <input className={cf.input} value={form.address} onChange={set('address')} />
        </Field>
        <Field label="건물주">
          <input className={cf.input} value={form.ownerName} onChange={set('ownerName')} />
        </Field>
        <Field label="건물주 연락처">
          <input className={cf.input} value={form.ownerPhone} onChange={set('ownerPhone')} />
        </Field>
        <Field label="사업자등록번호">
          <input className={cf.input} value={form.bizRegNo} onChange={set('bizRegNo')} />
        </Field>
        <Field label="센터장">
          <input className={cf.input} value={form.centerManager} onChange={set('centerManager')} />
        </Field>
        <Field label="계약 시작일">
          <input type="date" className={cf.input} value={form.contractFrom} onChange={set('contractFrom')} />
        </Field>
        <Field label="계약 종료일">
          <input type="date" className={cf.input} value={form.contractTo} onChange={set('contractTo')} />
        </Field>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>임대료 입금 계좌</p>
        <div className={styles.grid3}>
          <Field label="은행명">
            <input className={cf.input} value={form.bankName} onChange={set('bankName')} />
          </Field>
          <Field label="계좌번호">
            <input className={cf.input} value={form.bankAccount} onChange={set('bankAccount')} />
          </Field>
          <Field label="예금주">
            <input className={cf.input} value={form.accountHolder} onChange={set('accountHolder')} />
          </Field>
        </div>
      </div>

      <div className={styles.section}>
        <Field label="비고" full>
          <textarea className={cf.textarea} rows={2} value={form.memo} onChange={set('memo')} />
        </Field>
      </div>

      {/* 레거시 `BuildingForm` 의 파일 칸. ★ 화면코드는 늘지 않는다 — p1 안의 칸이다. */}
      <AttachField kind="buildings" targetId={targetId} pending={doc} onPending={setDoc} />
    </ModalShell>
  );
}
