'use client';

/** @screen s040300010p1 사업목적 문구 추가·수정 · 030 사업목적 · 법무 서비스(s04) */

/**
 * 사업목적 문구 추가 · 수정 — ★ 2026-11-16 부터 사업목적 화면(s040300010)의 **오른쪽 상세**다
 * (대표 지시: 왼쪽 목록 5 : 오른쪽 상세 5. 옛 수정 창 `BizPurposeDialog` 를 자리만 옮겼다 — 화면코드는 그대로).
 *
 * ★ 칸은 문구와 사용여부 둘뿐이다(지금은 문구만 쓴다 — 결정 2026-10-11). 사용여부는 수정에만 있다
 *   (새 문구는 켜진 채로 들어간다).
 * ★ 지우기는 없다 — 「사용 안 함」으로 끈다. 끄면 회사의 고르기 팝업에서 빠진다.
 * ★ 문구 검사(앞뒤 공백 · 200자 · 한 줄)는 shared `checkBizPurposeText` 와 같은 규칙을 서버가 한다.
 *   화면은 빈 칸 · 길이만 미리 막는다.
 * ★ 안내(409 같은 문구)와 오류를 가르는 것 · [닫기] · [저장] 은 옛 창(`ModalShell`)과 같다. [닫기] 는 고른 줄을 비운다.
 *   (2026-11-25 일관성 — 두 단추 자리는 제목 줄 오른쪽)
 */
import { useState } from 'react';
import { BIZ_PURPOSE_TEXT_MAX } from '@swonbiz/shared/domain/biz-purpose';
import { Button } from '@/components/ds';
import { Field, cf } from '@/features/facility/ModalShell';
import { BizPurposeError, createBizPurpose, saveBizPurpose, type BizPurposeItem } from './biz-purposes-model';
import styles from '@/features/codes/codes.module.css';
import ls from './corp-changes.module.css';

interface Props {
  /** `null` 이면 신규다. */
  item: BizPurposeItem | null;
  onClose: () => void;
  /** 저장한 줄(신규는 새로 생긴 줄) — 목록을 다시 받고 그 줄을 고른 채로 둔다. */
  onSaved: (saved: BizPurposeItem) => void;
}

export function BizPurposeDetail({ item, onClose, onSaved }: Props) {
  const [text, setText] = useState(item?.text ?? '');
  const [active, setActive] = useState(item?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setBlocked(null);
    try {
      let saved: BizPurposeItem = item ?? { id: '', text, active: true };
      if (item) {
        const patch: { text?: string; active?: boolean } = {};
        if (text.trim() !== item.text) patch.text = text;
        if (active !== item.active) patch.active = active;
        if (patch.text !== undefined || patch.active !== undefined) saved = await saveBizPurpose(item.id, patch);
      } else {
        saved = await createBizPurpose(text);
      }
      onSaved(saved);
    } catch (err) {
      /* ★ 409(같은 문구)는 안내다 — 이미 있다는 뜻이지 잘못이 아니다. */
      if (err instanceof BizPurposeError && err.duplicate) setBlocked(err.message);
      else setError(err instanceof BizPurposeError ? err.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  const okDisabled = text.trim() === '' || text.trim().length > BIZ_PURPOSE_TEXT_MAX;

  return (
    <div className={ls.paneForm} role="region" aria-label={item ? '문구 수정' : '문구 추가'}>
      {/*
        ★ 2026-11-25 법무 일관성 — 구역 제목 = 왼쪽 4px 아쿠아 막대(글자에만). [저장](주) = 상세 제목 줄 오른쪽,
          [닫기](보통)는 그 옆(종전 아래 줄 [닫기][저장] 에서 옮김).
      */}
      <div className={ls.paneHead}>
        <h2 className={`${styles.panelTitle} ${ls.sectionTitle}`}>{item ? '문구 수정' : '문구 추가'}</h2>
        <div className={ls.paneActions}>
          <Button variant="primary" size="sm" disabled={busy || okDisabled} onClick={() => void submit()}>
            저장
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>

      {/*
        ★ 안내와 오류를 **가른다**(옛 창과 같다). 「같은 문구가 있습니다」는 운영자가 잘못한 것이 아니다.
      */}
      {blocked ? (
        <p className={cf.modalDesc} role="status" data-facility-blocked="1">
          {blocked}
        </p>
      ) : null}
      {error ? (
        <p className={cf.fieldError} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.grid2}>
        <Field label="사업목적 문구" full>
          <input
            className={cf.input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="소프트웨어 개발 및 공급업"
            autoFocus
          />
        </Field>
        {item ? (
          <Field label="사용여부">
            <select className={cf.input} value={active ? 'on' : 'off'} onChange={(e) => setActive(e.target.value === 'on')}>
              <option value="on">사용</option>
              <option value="off">사용 안 함</option>
            </select>
          </Field>
        ) : null}
      </div>

      <p className={styles.formNote}>
        문구는 한 줄 {BIZ_PURPOSE_TEXT_MAX}자 이내이고, 같은 문구(앞뒤 공백 무시)는 둘 둘 수 없습니다. 지우기는 없고
        「사용 안 함」으로 끕니다 — 끄면 회사의 [목록에서 고르기]에서 빠집니다. 문구를 고쳐도 이미 법인변경에 적힌 글은
        바뀌지 않습니다.
      </p>
    </div>
  );
}
