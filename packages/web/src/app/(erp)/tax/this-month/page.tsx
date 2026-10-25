/** @screen s050000010 이번 달 할 일 · 000 · 세무 서비스(s05) */

/**
 * 이번 달 할 일 — 세무 서비스의 첫 화면(2026-10-25).
 *
 * ★ 1-0 은 **빈 껍데기다.** 화면 번호 배선(screens.ts · 사이드바 · 모의 계정)만 확인하려고 둔다.
 *   본문은 다음 단계에서 시안(`doc/tax-service/prototypes/s05-tax` 의 S05-01)대로 채운다.
 */
import { requireScreen } from '@/lib/session';

export default async function TaxThisMonthPage() {
  await requireScreen('s050000010', '/tax/this-month');
  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, lineHeight: 1.3, color: 'var(--text-heading)' }}>
        이번 달 할 일
      </h1>
      <p style={{ marginTop: 12, fontSize: 14, color: 'var(--text-muted)' }}>준비 중입니다.</p>
    </div>
  );
}
