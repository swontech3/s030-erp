/**
 * 이관한 DS 컴포넌트가 원본과 같은 마크업을 내는지 대조한다.
 *
 * "같아 보이는지"를 눈이 아니라 마크업으로 확인한다. 원본 .jsx 와 이관본 .tsx 를
 * 같은 props 로 서버 렌더해 HTML 문자열을 비교한다. 인라인 스타일까지 전부 문자열에
 * 들어오므로 색·간격·radius 가 하나라도 달라지면 잡힌다.
 *
 * 한계: hover/focus 는 초기 상태(false)만 비교한다. 상태 전환 코드는 원본과 같으므로
 *       초기 상태가 같으면 함께 간다.
 * Icon 은 대조 대상이 아니다 — CDN fetch 를 로컬 인라인으로 바꾼 것이 의도된 차이다.
 *
 * 사용: npx tsx scripts/compare-ds.tsx
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

// 이관본
import { Button } from '../packages/web/src/components/ds/Button';
import { Input } from '../packages/web/src/components/ds/Input';
import { Checkbox } from '../packages/web/src/components/ds/Checkbox';

// 원본 .jsx 는 클래식 JSX 런타임을 전제로 React 전역을 쓴다. 먼저 심어두고 동적 import 한다.
(globalThis as unknown as { React: typeof React }).React = React;

type Case = { name: string; a: ReactElement; b: ReactElement };

/** useId 가 만드는 «Rxx» / :r0: 는 렌더 순서에 따라 달라지므로 비교에서 제외한다. */
const normalize = (html: string) =>
  html.replace(/«[^»]*»/g, '«id»').replace(/:[rR][0-9a-z]*:/g, ':id:');

async function main() {
  const dir = '../design/_ds/swonbiz/components';
  const { Button: OrigButton } = await import(`${dir}/core/Button.jsx`);
  const { Input: OrigInput } = await import(`${dir}/forms/Input.jsx`);
  const { Checkbox: OrigCheckbox } = await import(`${dir}/forms/Checkbox.jsx`);

  const cases: Case[] = [
    { name: 'Button primary md', a: <OrigButton>로그인</OrigButton>, b: <Button>로그인</Button> },
    {
      name: 'Button ghost sm fullWidth',
      a: <OrigButton variant="ghost" size="sm" fullWidth>상담 예약</OrigButton>,
      b: <Button variant="ghost" size="sm" fullWidth>상담 예약</Button>,
    },
    {
      name: 'Button subtle disabled',
      a: <OrigButton variant="subtle" disabled>내보내기</OrigButton>,
      b: <Button variant="subtle" disabled>내보내기</Button>,
    },
    {
      name: 'Button inverse',
      a: <OrigButton variant="inverse">시작하기</OrigButton>,
      b: <Button variant="inverse">시작하기</Button>,
    },
    { name: 'Button link', a: <OrigButton variant="link">더 보기</OrigButton>, b: <Button variant="link">더 보기</Button> },
    {
      name: 'Input label+hint',
      a: <OrigInput id="x" label="회사명" placeholder="스원비즈 주식회사" hint="사업자등록증과 동일하게" />,
      b: <Input id="x" label="회사명" placeholder="스원비즈 주식회사" hint="사업자등록증과 동일하게" />,
    },
    {
      name: 'Input error sm',
      a: <OrigInput id="y" label="이메일" size="sm" error="이미 가입된 이메일입니다" defaultValue="a@b.c" />,
      b: <Input id="y" label="이메일" size="sm" error="이미 가입된 이메일입니다" defaultValue="a@b.c" />,
    },
    {
      name: 'Input with iconLeft',
      a: <OrigInput id="z" label="검색" iconLeft={<span>i</span>} />,
      b: <Input id="z" label="검색" iconLeft={<span>i</span>} />,
    },
    {
      name: 'Checkbox checked+description',
      a: <OrigCheckbox label="이용약관에 동의합니다" description="필수" checked onChange={() => {}} />,
      b: <Checkbox label="이용약관에 동의합니다" description="필수" checked onChange={() => {}} />,
    },
    {
      name: 'Checkbox unchecked disabled',
      a: <OrigCheckbox label="마케팅 수신" checked={false} disabled onChange={() => {}} />,
      b: <Checkbox label="마케팅 수신" checked={false} disabled onChange={() => {}} />,
    },
  ];

  let diff = 0;
  for (const c of cases) {
    const a = normalize(renderToStaticMarkup(c.a));
    const b = normalize(renderToStaticMarkup(c.b));
    if (a === b) {
      console.log(`OK  ${c.name}`);
    } else {
      diff++;
      console.log(`NG  ${c.name}`);
      let i = 0;
      while (i < Math.max(a.length, b.length) && a[i] === b[i]) i++;
      console.log(`      첫 차이 위치 ${i}`);
      console.log(`      원본  …${a.slice(Math.max(0, i - 40), i + 80)}`);
      console.log(`      이관본…${b.slice(Math.max(0, i - 40), i + 80)}`);
    }
  }
  console.log(`\n${cases.length}건 중 불일치 ${diff}건`);
  process.exit(diff === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
