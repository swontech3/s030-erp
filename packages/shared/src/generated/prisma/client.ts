/**
 * Prisma 타입 shim — S-WonERP 에서 파일째 옮겨온 순수 함수 4종을 **한 글자도 고치지 않고**
 * 컴파일시키기 위한 자리다.
 *
 * 사정: `domain/contract-settlement.ts` · `contract-invoices.ts` · `invoice-recalc.ts` 가
 * `import type { Prisma } from "@/generated/prisma/client"` 로 시작한다. 이 저장소는
 * Drizzle 을 쓰므로 그 경로에 아무것도 없다. 원본 파일을 고치면 "파일째 복사"가 깨지고
 * 나중에 원본과 대조할 수 없게 되므로, 파일 대신 **경로를 만들어 준다**
 * (tsconfig 의 `@/*` → `./src/*` 별칭이 여기로 온다).
 *
 * 이 타입들이 실제로 쓰이는 방식은 "트랜잭션 핸들을 받아서 그대로 넘긴다" 하나뿐이다
 * (`tx: Prisma.TransactionClient`). 구조를 들여다보지 않으므로 느슨하게 둔다.
 *
 * ★ 이 파일은 임시다. 페이즈 4(계약)·페이즈 5(예약)에서 이 함수들을 실제로 호출할 때
 *   `TransactionClient` 를 Drizzle 트랜잭션 타입으로 바꾸고, 그때 원본 파일의 import 도
 *   함께 고친다. 그 전까지는 함수를 호출하지 않는다(지시서 2-2).
 */

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Prisma {
  /** Prisma 의 대화형 트랜잭션 핸들. 여기서는 통과시키기만 하므로 구조를 특정하지 않는다. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type TransactionClient = Record<string, any>;
}
