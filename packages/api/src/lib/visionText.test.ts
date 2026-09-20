import { describe, it, expect } from 'vitest';
import { textFromImage, textFromPdf } from './visionText.ts';

/**
 * Vision 응답에서 **텍스트만** 꺼내는 부분. SDK 를 흉내 내는 것이 아니라, SDK 가
 * 돌려주는 **모양**을 그대로 넣어 우리가 꺼내는 규칙을 본다.
 *
 * ★ 왜 따로 두는가: 파서는 「줄」이 정본이다(`biz-reg-ocr.ts`). 페이지를 이어 붙일 때
 *   줄바꿈을 빠뜨리면 앞 페이지 마지막 줄과 뒤 페이지 첫 줄이 **한 줄로 붙는다.**
 *   그러면 라벨 뒤 값이 엉뚱한 것이 되고, 그 사고는 PDF 를 올린 사람만 겪는다.
 */
describe('textFromImage', () => {
  it('fullTextAnnotation 의 text 를 그대로 쓴다', () => {
    expect(textFromImage({ fullTextAnnotation: { text: '등록번호 : 111-81-00001' } })).toBe(
      '등록번호 : 111-81-00001',
    );
  });

  it('인식된 글자가 없으면 빈 문자열이다 — 여기서 던지지 않는다', () => {
    expect(textFromImage({})).toBe('');
    expect(textFromImage({ fullTextAnnotation: null })).toBe('');
  });
});

describe('textFromPdf', () => {
  it('페이지를 줄바꿈으로 잇는다 — 붙이면 앞뒤 줄이 한 줄이 된다', () => {
    const res = {
      responses: [
        { responses: [{ fullTextAnnotation: { text: '사업자등록증\n등록번호 : 111-81-00001' } }] },
      ],
    };
    expect(textFromPdf(res)).toBe('사업자등록증\n등록번호 : 111-81-00001');
  });

  it('여러 페이지가 오면 페이지 사이에도 줄바꿈이 들어간다', () => {
    const res = {
      responses: [
        {
          responses: [
            { fullTextAnnotation: { text: '1쪽 마지막줄' } },
            { fullTextAnnotation: { text: '2쪽 첫줄' } },
          ],
        },
      ],
    };
    expect(textFromPdf(res)).toBe('1쪽 마지막줄\n2쪽 첫줄');
  });

  it('글자가 없는 페이지는 건너뛴다 — 빈 줄만 쌓이지 않는다', () => {
    const res = {
      responses: [
        {
          responses: [
            { fullTextAnnotation: { text: '있는 쪽' } },
            {},
            { fullTextAnnotation: { text: '' } },
          ],
        },
      ],
    };
    expect(textFromPdf(res)).toBe('있는 쪽');
  });

  it('응답이 비어 있으면 빈 문자열이다', () => {
    expect(textFromPdf({})).toBe('');
    expect(textFromPdf({ responses: [] })).toBe('');
  });
});
