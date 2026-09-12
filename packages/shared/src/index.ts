/**
 * @swonbiz/shared — web 과 api 가 **둘 다** import 하는 것만 여기 둔다.
 * 한쪽만 쓰면 그 패키지 안에 둔다 (doc/SWONBIZ_PROJECT_STRUCTURE.md §9).
 *
 * domain/ 의 순수 함수는 여기서 재export 하지 않는다 — 페이즈 1에서는 옮겨만 두고
 * 호출하지 않기 때문이다(지시서 2-2). 쓸 때가 되면 `@swonbiz/shared/domain/*` 로
 * 직접 import 한다.
 */
export * from './screens';
export * from './constants';
export * from './session';
export * from './tenant-registration';
