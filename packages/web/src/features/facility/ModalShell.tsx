'use client';

/**
 * 센터 관리 팝업의 공통 껍데기 — **화면코드가 없다.** 마크업 재사용일 뿐이다.
 *
 * ★ 화면코드를 가진 것은 이것을 쓰는 네 폼(p1~p4)과 삭제 확인(p5)이다. 껍데기에 코드를
 *   붙이면 등록 대상이 하나 늘어나는데, 사람이 보는 화면은 늘지 않는다.
 *
 * ★★ 모달 CSS 는 계약 폼의 것을 **그대로 쓴다**(`contract-form.module.css`). 같은 모양의
 *    모달을 두 번 정의하면 한쪽만 고쳐지는 날이 온다 — `SettlementCard` 도 같은 이유로
 *    그 파일을 가져다 쓴다.
 *
 * ★ 폭을 480px 그대로 둔다. 레거시 호실 표는 넓었지만 우리는 **한 실씩 고치는 폼**이라
 *   (결정 2026-10-03) 계약 폼의 모달과 같은 폭이 맞다.
 */
import { comma, formatMoneyInput } from '@/features/contracts/form-model';
import cf from '@/features/contracts/contract-form.module.css';

interface Props {
  title: string;
  desc?: string;
  /** 저장·삭제 중에는 닫기와 확정을 함께 막는다 — 두 번 눌러 두 번 저장되지 않게. */
  busy: boolean;
  /** 사람이 읽을 실패 사유. ★ 409(쓰고 있어서 못 지움)는 `blocked` 로 넘긴다. */
  error?: string | null;
  /** 오류가 아니라 **안내**다 — 못 지우는 이유와 대안. */
  blocked?: string | null;
  okLabel: string;
  okDanger?: boolean;
  okDisabled?: boolean;
  onClose: () => void;
  onOk: () => void;
  children: React.ReactNode;
}

export function ModalShell({
  title,
  desc,
  busy,
  error,
  blocked,
  okLabel,
  okDanger,
  okDisabled,
  onClose,
  onOk,
  children,
}: Props) {
  return (
    <div
      className={cf.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) onClose();
      }}
    >
      <div className={cf.modal} role="dialog" aria-modal="true" aria-label={title}>
        <h3 className={cf.modalTitle}>{title}</h3>
        {desc ? <p className={cf.modalDesc}>{desc}</p> : null}

        {/*
          ★ 안내와 오류를 **가른다.** 「쓰고 있어서 못 지웁니다」는 운영자가 잘못한 것이
            아니라 지금 상태가 그런 것이다 — 붉은 오류로 그리면 고장처럼 읽힌다.
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

        <div className={cf.modalExtra}>{children}</div>

        <div className={cf.modalFoot}>
          <button type="button" className={`${cf.btn} ${cf.btnGhost}`} disabled={busy} onClick={onClose}>
            닫기
          </button>
          <button
            type="button"
            className={`${cf.btn} ${okDanger ? cf.btnPrimaryDanger : cf.btnPrimary}`}
            disabled={busy || okDisabled}
            onClick={onOk}
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 한 칸. `label` 과 입력을 묶는다 — 계약 폼과 같은 모양이다. */
export function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={cf.field} style={full ? { gridColumn: '1 / -1' } : undefined}>
      <span className={cf.label}>{label}</span>
      {children}
    </label>
  );
}

/**
 * 금액 칸 — **입력하는 동안 천단위를 끊는다.**
 *
 * ★★ 계약 폼과 **같은 함수**다(`formatMoneyInput`). 캐럿 자리까지 그쪽이 맞춰 준다 —
 *    직접 `toLocaleString` 을 부르면 콤마가 늘 때마다 커서가 앞으로 튄다.
 * ★ 서버는 콤마를 떼고 읽는다(`routes/facility.ts` 의 `int`·`decimal`) — 보낼 때
 *   되돌리지 않아도 된다.
 */
export function MoneyInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <input
      className={`${cf.input} ${cf.inputMoney}`}
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(formatMoneyInput(e.currentTarget))}
    />
  );
}

/** 숫자 → 금액 칸의 초기값. `null` 은 빈칸이다 — 0 과 「모름」은 다르다. */
export const moneyValue = (n: number | null | undefined): string =>
  n === null || n === undefined ? '' : comma(n);

export { cf };
