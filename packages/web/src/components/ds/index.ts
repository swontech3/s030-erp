/**
 * 디자인 시스템 컴포넌트 — 1차에 필요한 4종만 이관돼 있다.
 * 나머지 11종(IconButton·Card·Badge·Tag·Select·Radio·Switch·Tabs·Dialog·Toast·Tooltip)은
 * 필요해질 때 design/_ds/swonbiz/components/ 에서 가져온다. 옮기기 전에 같은 폴더의
 * .prompt.md 를 먼저 읽고, .d.ts 의 props 시그니처와 이름을 그대로 유지한다.
 */
export { Icon, type IconProps, type IconName } from './Icon';
export { Button, type ButtonProps } from './Button';
export { Input, type InputProps } from './Input';
export { Checkbox, type CheckboxProps } from './Checkbox';
/* ★ 2026-11-25 입주관리 일관성 — 공통 팝업 · 공통 표(대표 지시). 모양은 삐용 기준(각 파일 머리 주석) */
export { Dialog, type DialogProps } from './Dialog';
export {
  Table, TableHead, TableRow, TableEmpty, tableCell,
  type TableProps, type TableHeadProps, type TableRowProps,
} from './Table';
