/**
 * Cloud Vision 응답에서 **텍스트만** 꺼낸다. SDK 호출은 `routes/ocr.ts` 가 한다.
 *
 * ★ 파서(`@swonbiz/shared/domain/biz-reg-ocr`)는 **줄이 정본**이다. 그래서 여기서
 *   가장 중요한 일은 「페이지를 이을 때 줄바꿈을 반드시 넣는 것」이다. 빠뜨리면
 *   앞 페이지의 마지막 줄과 뒤 페이지의 첫 줄이 한 줄로 붙고, 라벨 뒤 값이
 *   엉뚱한 것이 된다.
 */

/** SDK 응답 중 우리가 쓰는 부분만. 전부 있을 수도, 없을 수도 있다. */
interface TextAnnotation {
  fullTextAnnotation?: { text?: string | null } | null;
}
interface FileResponse {
  responses?: (TextAnnotation | null | undefined)[] | null;
}
interface BatchFileResponse {
  responses?: (FileResponse | null | undefined)[] | null;
}

const textOf = (a: TextAnnotation | null | undefined): string => a?.fullTextAnnotation?.text ?? '';

/** 이미지 한 장 — `documentTextDetection` 의 응답. */
export function textFromImage(res: TextAnnotation | null | undefined): string {
  return textOf(res);
}

/**
 * PDF — `batchAnnotateFiles` 의 응답. 파일마다, 그 안에서 다시 페이지마다 한 덩어리다.
 * ★ 글자가 없는 페이지는 건너뛴다. 넣으면 빈 줄만 쌓여서 파서가 보는 줄 수가 늘어난다.
 */
export function textFromPdf(res: BatchFileResponse | null | undefined): string {
  return (res?.responses ?? [])
    .flatMap((file) => file?.responses ?? [])
    .map(textOf)
    .filter((t) => t.trim() !== '')
    .join('\n');
}
