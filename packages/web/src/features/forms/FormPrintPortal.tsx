'use client';

/**
 * 표양식 인쇄 — 종이에 나갈 문서를 **body 바로 밑으로** 포털해 둔다.
 *
 * ★★★ 계약서(`ContractDocumentModal`)와 같은 방식이다. 화면 트리 깊숙이 있는 미리보기를
 *    그대로 인쇄하려면 조상(스크롤 상자·패널)을 들어내야 하는데, 절대위치로 들어내면
 *    흐름에서 빠져 브라우저가 **장을 나눌 높이를 잃는다**(계약서가 3장인데 2장만 나온
 *    적이 있다). body 밑에 두면 문서가 정상 흐름에 있고, 인쇄 때 형제만 감추면 된다.
 *
 * ★ 화면에서는 보이지 않는다(`printOnly`). `print.css` 의 `form-doc` 규칙이 인쇄 때만
 *   꺼낸다 — 그 규칙은 `body[data-printing='form-doc']` 일 때만 걸린다. 표시는 [인쇄]
 *   를 누른 순간 붙이고 인쇄 창이 닫히면 뗀다. 늘 붙여 두면 다른 화면에서 Ctrl+P 를
 *   눌렀을 때 그 화면 대신 양식이 나간다.
 *
 * ★ 비어 있는 자리표시는 **빈칸**으로 나간다(`showEmpty={false}`).
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FormDefinition } from '@swonbiz/shared/domain/form-template';
import { FormDocument } from './FormDocument';
import styles from './form-doc.module.css';

export const PRINT_MARK = 'form-doc';

interface Props {
  definition: FormDefinition;
  values: Readonly<Record<string, string>>;
}

export function FormPrintPortal({ definition, values }: Props) {
  /* ★ SSR 에는 document 가 없다 — 붙은 뒤에만 포털한다. */
  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => setBody(document.body), []);
  if (!body) return null;

  return createPortal(
    <div data-print-portal={PRINT_MARK} className={styles.printOnly}>
      <FormDocument definition={definition} values={values} showEmpty={false} />
    </div>,
    body,
  );
}

/**
 * 인쇄 창을 연다. 표시를 붙이고, 인쇄 창이 **닫힌 뒤**(`afterprint`) 뗀다.
 *
 * ★ `window.print()` 가 돌아오는 시점에 떼지 않는다 — 크롬은 창이 닫힐 때까지 막히지만
 *   그렇지 않은 브라우저에서는 바로 돌아와서, 표시가 먼저 떨어지면 화면 전체가 인쇄된다.
 */
export function printFormDocument(): void {
  const clear = () => {
    delete document.body.dataset.printing;
    window.removeEventListener('afterprint', clear);
  };
  window.addEventListener('afterprint', clear);
  document.body.dataset.printing = PRINT_MARK;
  window.print();
}
