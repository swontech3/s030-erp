/**
 * 판독은 **첨부를 죽이지 않는다**.
 *
 * 이 파일이 지키는 것은 한 줄이다 — `scanBizReg` 는 **절대 던지지 않는다.**
 * 던지는 순간 첨부 업로드 경로가 그것을 업로드 실패로 받고, 서류가 저장되지 않는다.
 * 사업자등록증은 올라갔는데 판독만 안 된 상태는 완전히 정상이다.
 *
 * ★ Vision 을 부르지 않는다. 바깥 호출은 `readText` 로 주입해서, **실패했을 때
 *   우리가 무엇을 하는지**만 본다. 실제 판독이 맞는지는 파서 테스트(표본 4장)가 본다.
 */
import { describe, it, expect } from 'vitest';
import { scanBizReg } from './bizRegScan.ts';

const log = { warn: () => {}, error: () => {} };
const bytes = Buffer.from('x');

describe('scanBizReg', () => {
  it('Vision 이 던져도 던지지 않고 null 을 준다', async () => {
    const boom = () => Promise.reject(new Error('PERMISSION_DENIED: Cloud Vision API has not been used'));
    await expect(scanBizReg(bytes, 'image/png', log, boom)).resolves.toBeNull();
  });

  it('Vision 이 글자를 못 찾으면 null 을 준다 — 빈 값으로 섹션 1 을 덮지 않는다', async () => {
    await expect(scanBizReg(bytes, 'image/png', log, () => Promise.resolve(''))).resolves.toBeNull();
  });

  it('읽어 낸 텍스트를 파서에 그대로 넘긴다', async () => {
    const text = ['사업자등록증', '(법인사업자)', '등록번호: 111-81-00001', '법인명(단체명): 주식회사 가나다'].join('\n');
    const fields = await scanBizReg(bytes, 'image/png', log, () => Promise.resolve(text));
    expect(fields?.companyName).toBe('주식회사 가나다');
    expect(fields?.bizNumber).toBe('111-81-00001');
  });

  it('PDF 인지 이미지인지를 읽는 쪽에 알려준다 — 호출이 다르다', async () => {
    const seen: string[] = [];
    const record = (_b: Buffer, mime: string) => {
      seen.push(mime);
      return Promise.resolve('');
    };
    await scanBizReg(bytes, 'application/pdf', log, record);
    await scanBizReg(bytes, 'image/jpeg', log, record);
    expect(seen).toEqual(['application/pdf', 'image/jpeg']);
  });
});
