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
