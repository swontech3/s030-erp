/**
 * 세무 빨간 띠 — [저장] 위.
 *
 *   · 입력 오류(서버의 칸별 오류 `errors[]`) — 「**입력을 확인해 주세요.** 빨간 테두리 칸 N곳 — {안내}」(결과서 S05-11 [저장])
 *   · 저장 실패(연결 · 서버 오류 · 404 등) — 서버가 준 문구 그대로. 결과서는 「ERP 공통 처리를 따름」이고,
 *     ERP 화면들은 실패 문구를 빨간 글자로 보여 준다 — 세무는 같은 빨간 띠 모양으로 보여 준다.
 */
import { Icon } from '@/components/ds';
import t from './tax.module.css';

type Props =
  | { kind: 'input'; count: number; guide: string }
  | { kind: 'failed'; message: string };

export function TaxFormErrorBanner(props: Props) {
  return (
    <div className={`${t.note} ${t.noteDanger}`} role="alert">
      <span>
        <Icon name="circle-alert" size={16} />
      </span>
      {props.kind === 'input' ? (
        <span>
          <b>입력을 확인해 주세요.</b> 빨간 테두리 칸 {props.count}곳 — {props.guide}
        </span>
      ) : (
        <span>{props.message}</span>
      )}
    </div>
  );
}
