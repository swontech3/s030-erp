/**
 * Icon — 유일한 아이콘 프리미티브. DS 원본: design/_ds/swonbiz/components/core/Icon.jsx
 *
 * 원본과 달라진 것 두 가지 (둘 다 의도한 것):
 *
 * 1. **CDN 을 끊었다.** 원본은 unpkg 에서 매번 `fetch(BASE + name + '.svg')` 한다.
 *    CDN 이 죽으면 아이콘이 통째로 사라지고, 외부 요청이라 CSP 에 도메인을 열어야 하며,
 *    런타임 fetch 라 첫 페인트에 늦게 뜬다. 11종을 번들에 넣어 셋 다 없앴다.
 *    부수 효과로 useState/useEffect 가 사라져 서버 컴포넌트에서도 쓸 수 있다.
 *
 * 2. **name 을 IconName 유니온으로 좁혔다.** 원본 .d.ts 는 `name: string` 이다.
 *    lucide 는 `circle-check` 가 맞고 `check-circle` 은 404 인데(실제 확인),
 *    **오타가 에러를 내지 않는다** — 아이콘이 안 보일 뿐이고 콘솔도 조용하며
 *    리뷰에서도 안 걸린다. 유니온으로 좁혀 컴파일에서 잡는다.
 *    ★ string 으로 넓히지 않는다. 아이콘이 필요하면 svg/ 에 파일을 넣고
 *      `node scripts/build-icons.js --write` 로 유니온을 다시 만든다.
 *
 * 크기는 16(인라인·캡션) / 20(기본·버튼) / 24(기능 불릿)만 쓴다. — Icon.prompt.md
 */
import type { CSSProperties, HTMLAttributes } from 'react';
import { ICON_MARKUP, type IconName } from '../icons/icons.generated';

export type { IconName };

export interface IconProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'dangerouslySetInnerHTML'> {
  name: IconName;
  /** 16 · 20(기본) · 24 */
  size?: number;
  style?: CSSProperties;
}

export function Icon({ name, size = 20, style, ...rest }: IconProps) {
  return (
    <span
      aria-hidden="true"
      style={{ display: 'inline-flex', width: size, height: size, flex: '0 0 auto', ...style }}
      {...rest}
    >
      {/*
        마크업은 저장소 안의 svg 파일에서 빌드 시점에 생성된다(icons.generated.ts).
        사용자 입력이 들어올 여지가 없다.
        stroke="currentColor" 라 색은 상위 color 를 그대로 상속한다.
      */}
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: ICON_MARKUP[name] }}
      />
    </span>
  );
}
