/**
 * 세무 빈 목록 — ERP 월별 청구(`BillingEmpty`) · 법무 목록(`Empty`)과 같은 꼴: 가운데 아이콘 40px + 16px 문구(+ 14px 보조 문구).
 * ★ 2026-11-07 ERP 디자인 컨셉에 맞춤. 표 안이면 `<td className={t.empty}>` 에 넣는다.
 * ★ 아이콘은 ERP 처럼 그 화면의 사이드바 아이콘을 쓴다(청구 receipt · 법무 scale 과 같은 방식).
 */
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ds';
import t from './tax.module.css';

export function TaxEmpty({ icon, lead, sub }: { icon: IconName; lead: ReactNode; sub?: ReactNode }) {
  return (
    <>
      <span className={t.emptyIcon}>
        <Icon name={icon} size={40} />
      </span>
      <p className={t.emptyLead}>{lead}</p>
      {sub ? <p className={t.emptySub}>{sub}</p> : null}
    </>
  );
}
