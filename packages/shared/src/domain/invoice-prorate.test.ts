import { describe, it, expect } from 'vitest';
import { prorateInvoiceLines } from './invoice-plan.ts';

/**
 * 해지 달 청구서를 일할로 낮출 때, **줄도 같이 낮춰야 한다.**
 *
 * 레거시는 줄에 `updateMany` 로 **같은 금액을 전부** 박았다. 레거시는 한 청구서에
 * 줄이 언제나 하나였기 때문에 드러나지 않았다 — 계약 1건 = 호실 1개였다.
 * 지금은 계약 하나에 호실이 최대 10개라 그대로 두면 **줄 합계가 머리의 N 배**가 된다.
 */
describe('prorateInvoiceLines', () => {
  it('줄이 하나면 목표 금액 그대로다', () => {
    expect(
      prorateInvoiceLines({
        lines: [{ invoiceLineId: 'l1', supplyAmount: 500_000, vatAmount: 50_000 }],
        supplyAmount: 250_000,
        vatAmount: 25_000,
      }),
    ).toEqual([
      { invoiceLineId: 'l1', supplyAmount: 250_000, vatAmount: 25_000, totalAmount: 275_000 },
    ]);
  });

  it('줄이 둘이면 원래 비율대로 가른다', () => {
    const out = prorateInvoiceLines({
      lines: [
        { invoiceLineId: 'l1', supplyAmount: 600_000, vatAmount: 60_000 },
        { invoiceLineId: 'l2', supplyAmount: 400_000, vatAmount: 40_000 },
      ],
      // 절반만 사용
      supplyAmount: 500_000,
      vatAmount: 50_000,
    });
    expect(out).toEqual([
      { invoiceLineId: 'l1', supplyAmount: 300_000, vatAmount: 30_000, totalAmount: 330_000 },
      { invoiceLineId: 'l2', supplyAmount: 200_000, vatAmount: 20_000, totalAmount: 220_000 },
    ]);
  });

  /*
   * ★★ 여기가 1원이 새는 자리다. 비율로 나누면 반올림이 남고, 그 나머지를 아무도
   *    가져가지 않으면 **줄 합계와 머리가 어긋난다.** 청구서는 맞는데 명세가 안 맞는
   *    상태가 되고, 그 1원은 영원히 미수금으로 남는다.
   *    마지막 줄이 나머지를 흡수한다 — 합은 **반드시** 목표와 같다.
   */
  it('★ 나머지는 마지막 줄이 흡수한다 — 합이 목표와 정확히 같다', () => {
    const out = prorateInvoiceLines({
      lines: [
        { invoiceLineId: 'l1', supplyAmount: 1, vatAmount: 0 },
        { invoiceLineId: 'l2', supplyAmount: 1, vatAmount: 0 },
        { invoiceLineId: 'l3', supplyAmount: 1, vatAmount: 0 },
      ],
      supplyAmount: 100, // 3 으로 나누어떨어지지 않는다
      vatAmount: 10,
    });
    expect(out.reduce((s, l) => s + l.supplyAmount, 0)).toBe(100);
    expect(out.reduce((s, l) => s + l.vatAmount, 0)).toBe(10);
    expect(out.reduce((s, l) => s + l.totalAmount, 0)).toBe(110);
  });

  it('줄마다 합계는 공급가 + 부가세다', () => {
    const out = prorateInvoiceLines({
      lines: [
        { invoiceLineId: 'l1', supplyAmount: 700_000, vatAmount: 70_000 },
        { invoiceLineId: 'l2', supplyAmount: 300_000, vatAmount: 0 },
      ],
      supplyAmount: 500_000,
      vatAmount: 35_000,
    });
    for (const line of out) {
      expect(line.totalAmount).toBe(line.supplyAmount + line.vatAmount);
    }
  });

  it('★ 원래 금액이 전부 0 이면 나누지 않는다 (0으로 나누기)', () => {
    const out = prorateInvoiceLines({
      lines: [
        { invoiceLineId: 'l1', supplyAmount: 0, vatAmount: 0 },
        { invoiceLineId: 'l2', supplyAmount: 0, vatAmount: 0 },
      ],
      supplyAmount: 0,
      vatAmount: 0,
    });
    expect(out).toEqual([
      { invoiceLineId: 'l1', supplyAmount: 0, vatAmount: 0, totalAmount: 0 },
      { invoiceLineId: 'l2', supplyAmount: 0, vatAmount: 0, totalAmount: 0 },
    ]);
  });

  it('줄이 없으면 빈 목록이다', () => {
    expect(prorateInvoiceLines({ lines: [], supplyAmount: 0, vatAmount: 0 })).toEqual([]);
  });
});
