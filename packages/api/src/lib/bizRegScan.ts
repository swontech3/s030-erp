/**
 * 사업자등록증 판독 — 첨부 업로드(`routes/files.ts`)가 **올라온 바이트 그대로** 부른다.
 *
 * =============================================================================
 * ★★★ **절대 던지지 않는다**
 * =============================================================================
 * 이 함수의 실패는 첨부의 실패가 아니다. 서류는 올라갔는데 판독만 안 된 상태는
 * 완전히 정상이고, 그때 운영자는 섹션 1 을 손으로 채우면 된다. 그래서 여기서
 * 던지면 안 된다 — 던지는 순간 업로드 경로가 그것을 업로드 실패로 받는다.
 *
 * 읽지 못하면 `null` 이고, 그 뜻은 「섹션 1 을 건드리지 않는다」다.
 *
 * ★ 반대 방향도 같다. 첨부가 실패해도 이미 읽은 값은 화면으로 돌아간다 —
 *   그쪽은 `routes/files.ts` 와 `lib/forward.ts` 가 맡는다.
 *
 * =============================================================================
 * ★★ 아무것도 남기지 않는다
 * =============================================================================
 * 바이트는 메모리에서만 산다. 여기서 DB 도 스토리지도 만지지 않고, **OCR 원문을
 * 돌려주지도 않는다.** 원문에는 개인사업자의 생년월일까지 들어 있고, 화면은
 * 판독된 7칸 말고는 쓸 데가 없다. 쓰지 않는 값은 내보내지 않는다.
 */
import { parseBizReg, type BizRegFields } from '@swonbiz/shared/domain/biz-reg-ocr';
import { env } from '../env.ts';
import { textFromImage, textFromPdf } from './visionText.ts';

/** 로그만 받는다. Fastify 의 `req.log` 를 그대로 넘기면 된다. */
interface ScanLog {
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

/**
 * Vision 클라이언트는 **처음 부를 때 한 번** 만든다.
 *
 * ★ 모듈을 읽는 시점에 만들지 않는다. gRPC 연결과 키 파일 읽기가 딸려 오는데,
 *   사업자등록증을 한 번도 안 올리는 배포에서도 기동이 그만큼 늦어진다.
 */
let client: unknown = null;
async function visionClient(keyFilename: string) {
  if (!client) {
    const vision = await import('@google-cloud/vision');
    client = new vision.default.ImageAnnotatorClient({ keyFilename });
  }
  return client as {
    documentTextDetection: (req: unknown) => Promise<[unknown]>;
    batchAnnotateFiles: (req: unknown) => Promise<[unknown]>;
  };
}

/** 바이트에서 글자를 뽑는 일. 기본은 Cloud Vision 이고, 테스트가 여기를 갈아 끼운다. */
export type ReadText = (body: Buffer, mimeType: string) => Promise<string>;

/** 기본 구현 — Cloud Vision. 이미지와 PDF 의 호출이 다르다. */
async function readTextWithVision(body: Buffer, mimeType: string): Promise<string> {
  const keyFilename = env.ocrCredentialsPath;
  if (!keyFilename) throw new Error('GOOGLE_APPLICATION_CREDENTIALS 가 없다');

  const vision = await visionClient(keyFilename);
  if (mimeType === 'application/pdf') {
    const [res] = await vision.batchAnnotateFiles({
      requests: [
        {
          inputConfig: { mimeType: 'application/pdf', content: body },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        },
      ],
    });
    return textFromPdf(res as Parameters<typeof textFromPdf>[0]);
  }
  const [res] = await vision.documentTextDetection({ image: { content: body } });
  return textFromImage(res as Parameters<typeof textFromImage>[0]);
}

/**
 * 사업자등록증 이미지·PDF 를 읽어 계약 폼 섹션 1 의 7칸을 돌려준다.
 * 키가 없거나 Vision 이 실패하면 `null` — **던지지 않는다**(파일 머리말).
 *
 * @param readText 바깥 호출. 기본은 Vision 이고 테스트만 갈아 끼운다 — 그래야
 *   「실패했을 때 무엇을 하는가」를 과금·네트워크 없이 확인할 수 있다.
 */
export async function scanBizReg(
  body: Buffer,
  mimeType: string,
  log: ScanLog,
  readText: ReadText = readTextWithVision,
): Promise<BizRegFields | null> {
  // 설정이 없는 것은 오류가 아니다 — OCR 없이 첨부만 쓰는 배포가 있을 수 있다.
  if (readText === readTextWithVision && !env.ocrCredentialsPath) {
    log.warn({}, '사업자등록증 판독을 건너뛴다 — GOOGLE_APPLICATION_CREDENTIALS 가 없다');
    return null;
  }

  try {
    const text = await readText(body, mimeType);
    // ★ 글자를 못 찾았으면 **파서를 부르지 않는다.** 전부 null 인 7칸을 돌려주면
    //   화면이 「0개 불러왔습니다」를 띄우는데, 그건 「판독 못 함」과 다른 말이다.
    if (text.trim() === '') return null;
    return parseBizReg(text);
  } catch (err) {
    // ★ 원인은 로그에만 남긴다. 밖으로 내보내면 프로젝트명·키 경로가 브라우저까지 간다.
    //   그리고 **첨부는 그대로 진행된다** — 그게 이 catch 의 목적이다.
    log.error({ err }, 'Vision 호출 실패 — 첨부는 그대로 두고 판독만 건너뛴다');
    return null;
  }
}
