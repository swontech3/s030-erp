/**
 * CONT-17 첨부 서류 — **살아 있는 서버에 대고** 확인한다.
 *
 * ★ 타입 검사나 단위 시험으로는 이 기능의 완료를 말할 수 없다. 이 기능의 위험은
 *   «스토리지와 DB 두 곳이 어긋나는 것»이고, 그건 두 곳을 **실제로 들여다봐야**
 *   알 수 있다. 그래서 이 스크립트는 API·스토리지·DB 셋을 모두 직접 본다.
 *
 * 사전 조건 — Fastify(127.0.0.1:3001)가 떠 있어야 한다.
 *
 * 사용: node scripts/verify-cont17.js .env
 */
const fs = require('fs');
const { Client } = require('pg');

const readEnvFile = (p) =>
  Object.fromEntries(
    fs
      .readFileSync(p, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );

const env = readEnvFile(process.argv[2] || '.env');
const apiEnv = readEnvFile('packages/api/.env');

const API = 'http://127.0.0.1:3001';
const STORAGE = apiEnv.SUPABASE_URL;
const SERVICE_KEY = apiEnv.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'erp-files';
// ★ 회원구분은 여기 적지 않는다 — [7] 이 필요할 때 직접 세우고 되돌린다. 화면에서
//   고칠 수 있는 값을 머리말에 적어 두면 그 값이 바뀌는 날 시험이 뒤집힌다.
const COMPANY = 'MOCK_TENANT_9001';

const { itemCountGate } = require('./verify-count.js');

/**
 * 기대 항목 수 — 모자라면 **실패**다. 항목이 조용히 사라지는 것을 막는 유일한 장치이고,
 * 경위는 `verify-count.js` 머리말에 있다. 항목을 늘리면 끝에서 이 수를 고치라고 알려 준다.
 */
const EXPECTED_ITEMS = 47;
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  ✔ ${label}`);
  } else {
    fail++;
    console.log(`  ✘ ${label}${detail !== undefined ? ` — ${detail}` : ''}`);
  }
}

/** 최소한의 JPEG. 스토리지는 내용을 검사하지 않지만 진짜 파일로 확인한다. */
const jpeg = (size) => {
  const b = Buffer.alloc(Math.max(size, 4));
  b[0] = 0xff;
  b[1] = 0xd8;
  b[b.length - 2] = 0xff;
  b[b.length - 1] = 0xd9;
  return b;
};

// ★ 2026-10-22 — 로그인은 삐용 토큰 → ERP 세션이다(규격서 Q6 · 서버는 비밀번호를 받지 않는다).
//   MOCK 모드(BBIYONG_MOCK=true)의 토큰 = mock-access.{회원번호} · mock-refresh.{회원번호}
//   (packages/api/src/bbiyong/MockBbiyongAuth.ts — 이메일 → 회원번호는 그 파일의 MOCK_ACCOUNTS)
const MOCK_MEMBER_IDS = { 'admin@s-wontech.co.kr': 1001, 'operator@s-wontech.co.kr': 1002, 'tenant@test.com': 2001, 'noaccess@test.com': 2002 };
const mockTokens = (email) => ({ accessToken: `mock-access.${MOCK_MEMBER_IDS[email]}.verify`, refreshToken: `mock-refresh.${MOCK_MEMBER_IDS[email]}.verify` });
async function login(email) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(mockTokens(email)),
  });
  if (!res.ok) throw new Error(`로그인 실패 ${email}: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const sid = body.erpSid ?? body.sid ?? body.session?.erpSid;
  if (!sid) throw new Error(`로그인 응답에 erp_sid 가 없다: ${JSON.stringify(body).slice(0, 200)}`);
  return sid;
}

const withSid = (sid, extra = {}) => ({ cookie: `erp_sid=${encodeURIComponent(sid)}`, ...extra });

const upload = (sid, purpose, body, contentType, name = 'test.jpg') =>
  fetch(`${API}/companies/${COMPANY}/files?purpose=${purpose}`, {
    method: 'POST',
    headers: withSid(sid, { 'content-type': contentType, 'x-file-name': encodeURIComponent(name) }),
    body,
  });

/** 스토리지에 실물이 있는가 — **service_role 로** 본다(비공개 버킷이라 그래야 보인다). */
async function objectExists(path) {
  const res = await fetch(
    `${STORAGE}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`,
    { headers: { authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY } },
  );
  return res.status === 200;
}

(async () => {
  const db = new Client({
    host: env.DB_HOST,
    port: +env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    connectionTimeoutMillis: 15000,
  });
  await db.connect();
  const dbRows = async (purpose) =>
    (
      await db.query(
        `SELECT id, storage_path, original_name, file_size, mime_type
           FROM public.tb_cm_file
          WHERE target_type='COMPANY' AND target_id=$1 AND file_purpose=$2`,
        [COMPANY, purpose],
      )
    ).rows;

  console.log('\nCONT-17 — 스토리지와 DB 두 곳이 어긋나지 않는가');

  const operator = await login('operator@s-wontech.co.kr');
  const tenant = await login('tenant@test.com');

  // ══ ① 올리면 양쪽에 다 있다 ══════════════════════════════════════════
  console.log('\n[1] 올리면 스토리지 실물 + DB 기록 둘 다 있다');
  const up1 = await upload(operator, 'CEO_ID', jpeg(2048), 'image/jpeg', '최현수_신분증.jpg');
  const up1Body = await up1.json().catch(() => ({}));
  check('업로드가 201 이다', up1.status === 201, `${up1.status} ${JSON.stringify(up1Body).slice(0, 160)}`);

  const rows1 = await dbRows('CEO_ID');
  check('DB 기록이 정확히 1행이다', rows1.length === 1, `${rows1.length}행`);
  const path1 = rows1[0]?.storage_path;
  check('스토리지에 실물이 있다', path1 ? await objectExists(path1) : false, path1);
  check('원본 이름(한글)이 보존된다', rows1[0]?.original_name === '최현수_신분증.jpg', rows1[0]?.original_name);
  check('★ 경로에 사람 이름이 없다', path1 ? !/[가-힣]/.test(path1) : false, path1);
  check('응답의 url 이 서명 URL 이다(token 포함)', /token=/.test(up1Body.file?.url ?? ''), up1Body.file?.url?.slice(0, 80));

  // ══ ② 재업로드하면 옛 실물이 안 남는다 ══════════════════════════════
  console.log('\n[2] 같은 종류 재업로드 시 옛 파일이 스토리지에 안 남는다');
  const up2 = await upload(operator, 'CEO_ID', jpeg(4096), 'image/jpeg', '최현수_신분증_재발급.jpg');
  const up2Body = await up2.json().catch(() => ({}));
  check('재업로드가 201 이다', up2.status === 201, up2.status);
  check('replaced=true 로 알려준다', up2Body.replaced === true, JSON.stringify(up2Body.replaced));

  const rows2 = await dbRows('CEO_ID');
  check('DB 는 여전히 1행이다 (두 장이 남지 않는다)', rows2.length === 1, `${rows2.length}행`);
  const path2 = rows2[0]?.storage_path;
  check('경로가 새 것으로 바뀌었다', path2 && path2 !== path1, `${path1} → ${path2}`);
  check('새 실물이 있다', path2 ? await objectExists(path2) : false, path2);
  check('★ 옛 실물이 스토리지에서 사라졌다', path1 ? !(await objectExists(path1)) : false, path1);

  // ══ ④ 공개 URL 로는 안 열린다 ════════════════════════════════════════
  console.log('\n[4] 공개 URL 로는 안 열린다 (주소를 직접 친다)');
  const encoded = path2.split('/').map(encodeURIComponent).join('/');
  const pub = await fetch(`${STORAGE}/storage/v1/object/public/${BUCKET}/${encoded}`);
  check('공개 엔드포인트가 200 을 주지 않는다', pub.status !== 200, `status ${pub.status}`);

  const noAuth = await fetch(`${STORAGE}/storage/v1/object/${BUCKET}/${encoded}`);
  check('인증 없는 요청이 200 을 주지 않는다', noAuth.status !== 200, `status ${noAuth.status}`);

  const anonRes = await fetch(`${STORAGE}/storage/v1/object/${BUCKET}/${encoded}`, {
    headers: { authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, apikey: env.SUPABASE_ANON_KEY },
  });
  check('anon 키로도 200 이 아니다', anonRes.status !== 200, `status ${anonRes.status}`);

  // 반대 확인 — 서명 URL 은 **열린다**. 안 열리면 위 셋은 의미가 없다.
  const signed = up2Body.file?.url;
  const signedRes = signed ? await fetch(signed) : { status: 0 };
  check('서명 URL 은 실제로 열린다 (대조군)', signedRes.status === 200, `status ${signedRes.status}`);

  // DB 에 주소가 저장되지 않았는지
  const urlCol = await db.query(
    `SELECT count(*)::int n FROM information_schema.columns
      WHERE table_schema='public' AND table_name='tb_cm_file' AND column_name='storage_url'`,
  );
  check('★ DB 에 URL 을 저장할 칸 자체가 없다', urlCol.rows[0].n === 0);

  // ══ ⑤ 형식·크기를 서버에서도 막는다 ═════════════════════════════════
  console.log('\n[5] 형식·크기를 서버에서도 막는다 (API 직접 호출)');
  const gif = await upload(operator, 'CEO_ID', jpeg(512), 'image/gif');
  check('image/gif 를 막는다', gif.status === 415, `status ${gif.status}`);

  const html = await upload(operator, 'CEO_ID', Buffer.from('<script>x</script>'), 'text/html');
  check('text/html 을 막는다', html.status === 415, `status ${html.status}`);

  /**
   * ★ 10MB 를 넘으면 Fastify 가 **본문을 다 받기 전에 연결을 끊는다**(bodyLimit).
   *   그래서 클라이언트에는 응답이 아니라 소켓 오류로 온다 — 그것이 정상이다.
   *   «413 이 와야 한다»고 적으면 올바른 동작을 실패로 읽는다.
   *   중요한 것은 ① 막혔다 ② 서버가 살아 있다 ③ 아무것도 안 남았다 — 셋이다.
   */
  let tooBigBlocked = false;
  let tooBigDetail = '';
  try {
    const tooBig = await upload(operator, 'CEO_ID', jpeg(10 * 1024 * 1024 + 1), 'image/jpeg');
    tooBigBlocked = tooBig.status === 413 || tooBig.status === 400;
    tooBigDetail = `status ${tooBig.status}`;
  } catch (err) {
    // 연결 끊김 = 막혔다. 다만 «서버가 죽은 것»과 구분해야 한다 — 아래에서 확인한다.
    tooBigBlocked = true;
    tooBigDetail = `연결 끊김(${err.cause?.code ?? err.message}) — bodyLimit 이 본문을 다 받기 전에 끊었다`;
  }
  check('10MB + 1바이트를 막는다', tooBigBlocked, tooBigDetail);

  const alive = await fetch(`${API}/health`).then((r) => r.status).catch(() => 0);
  check('★ 막은 뒤에도 서버가 살아 있다 (죽어서 막힌 것이 아니다)', alive === 200, `health ${alive}`);

  // ★ 경계 — **정확히 10MB 는 통과해야 한다.** 위 시험만 있으면 상한이 9MB 여도 통과한다.
  const atLimit = await upload(operator, 'EXISTING_CONTRACT', jpeg(10 * 1024 * 1024), 'image/jpeg', '10mb.jpg');
  check('경계 — 정확히 10MB 는 통과한다', atLimit.status === 201, `status ${atLimit.status}`);

  const empty = await upload(operator, 'BIZ_REG', Buffer.alloc(0), 'image/jpeg');
  check('빈 파일을 막는다', empty.status === 400 || empty.status === 415, `status ${empty.status}`);

  const noName = await fetch(`${API}/companies/${COMPANY}/files?purpose=CEO_ID`, {
    method: 'POST',
    headers: withSid(operator, { 'content-type': 'image/jpeg' }),
    body: jpeg(256),
  });
  check('파일 이름 없는 요청을 막는다', noName.status === 400, `status ${noName.status}`);

  const badPurpose = await upload(operator, 'PASSPORT', jpeg(256), 'image/jpeg');
  check('모르는 서류 종류를 막는다', badPurpose.status === 400, `status ${badPurpose.status}`);

  // 막힌 요청들이 DB·스토리지에 흔적을 남기지 않았는지
  const stillOne = await dbRows('CEO_ID');
  check('거절된 요청이 DB 를 바꾸지 않았다', stillOne.length === 1 && stillOne[0].storage_path === path2);

  /* ══ ⑦ 법인이 아니면 CORP_REG ═══════════════════════════════════════
   *
   * ★★ **회원구분을 이 시험이 직접 세운다.** 예전에는 `MOCK_TENANT_9001` 이 개인사업자
   *    라고 머리말에 적어 두고 그 값을 믿었다. 그런데 그 회사는 **화면에서 고칠 수
   *    있는 회사**다. 실제로 2026-10-04 에 법인(R)으로 바뀌어 있었고, 그 순간 이
   *    항목은 «법인에게 등기부등본을 거절하라»는 뒤집힌 시험이 됐다 — 영원히
   *    실패하면서 정작 진짜 회귀는 못 잡는 상태다. 주변 값에 기대지 않는다.
   *    세웠다가 **반드시 되돌린다**(finally).
   */
  console.log('\n[7] 법인 아니면 CORP_REG (카드도 안 보이고 API 도 막는다)');

  const memberTypeOf = async () =>
    (
      await db.query(`SELECT member_type FROM public.tb_s080_companies WHERE company_id=$1`, [
        COMPANY,
      ])
    ).rows[0]?.member_type ?? null;
  const setMemberType = (code) =>
    db.query(`UPDATE public.tb_s080_companies SET member_type=$2 WHERE company_id=$1`, [
      COMPANY,
      code,
    ]);

  const originalMemberType = await memberTypeOf();
  try {
    // ★ 대조군 먼저 — 법인(R)에서는 **통과해야 한다.** 이것이 없으면 아래의 「막혔다」가
    //   서류 종류 때문인지 회원구분과의 조합 때문인지 가릴 수 없다.
    await setMemberType('R');
    const asCorp = await upload(operator, 'CORP_REG', jpeg(256), 'image/jpeg', '등기부등본.jpg');
    const asCorpBody = await asCorp.json().catch(() => ({}));
    check(
      '대조군 — 법인(R)에서는 CORP_REG 가 통과한다',
      asCorp.status === 201,
      `${asCorp.status} ${JSON.stringify(asCorpBody).slice(0, 120)}`,
    );

    /* ★★ **올린 뒤에 회원구분을 바꾼다.** 올리는 길은 막혀 있는데도 「개인사업자에게
     *     법인등기부등본이 붙어 있는」 상태가 생기는 유일한 길이 이것이다. */
    await setMemberType('P');

    const blocked = await upload(operator, 'CORP_REG', jpeg(256), 'image/jpeg');
    const blockedBody = await blocked.json().catch(() => ({}));
    check(
      '개인사업자(P) 회사에 CORP_REG 를 막는다',
      blocked.status === 400 && /회원구분/.test(blockedBody.message ?? ''),
      `${blocked.status} ${blockedBody.message}`,
    );

    const corpRows = await dbRows('CORP_REG');
    check(
      '막힌 요청이 DB 를 바꾸지 않았다 (대조군이 올린 1행 그대로)',
      corpRows.length === 1 && corpRows[0].id === asCorpBody.file?.fileId,
      `${corpRows.length}행`,
    );

    /* ★ 목록 API 가 이것을 **숨기면 안 된다.** 숨기는 순간 화면에 칸이 없어지고,
     *   그 서류는 보이지도 지워지지도 않는다 — 운영자에게는 없는 셈인데 스토리지에는
     *   남는다. 화면은 이 서류를 「규칙 밖」으로 그리고 삭제만 열어 둔다. */
    const offList = await fetch(`${API}/companies/${COMPANY}/files`, { headers: withSid(operator) });
    const offBody = await offList.json().catch(() => ({}));
    check(
      '★ 규칙 밖이 돼도 목록이 그 서류를 돌려준다 (화면이 치울 수 있어야 한다)',
      (offBody.files ?? []).some((f) => f.purpose === 'CORP_REG'),
      (offBody.files ?? []).map((f) => f.purpose).join(',') || '빈 목록',
    );

    const corpPath = corpRows[0]?.storage_path;
    const delOff = await fetch(`${API}/companies/${COMPANY}/files/${asCorpBody.file?.fileId}`, {
      method: 'DELETE',
      headers: withSid(operator),
    });
    check('★ 규칙 밖이 된 서류를 지울 수 있다', delOff.status === 204, `status ${delOff.status}`);
    check(
      '지운 실물이 스토리지에서도 사라졌다',
      corpPath ? !(await objectExists(corpPath)) : false,
      corpPath,
    );
  } finally {
    // ★ 던지든 말든 원래 값으로 돌려놓는다. 시험이 남의 데이터를 바꿔 둔 채 끝나면,
    //   다음 번 이 시험이 또 엉뚱한 것을 보게 된다 — 지금 고치고 있는 바로 그 병이다.
    await setMemberType(originalMemberType);
  }
  check(
    '★ 회원구분을 원래대로 돌려놨다',
    (await memberTypeOf()) === originalMemberType,
    `${originalMemberType}`,
  );

  // ══ ⑥ 입주사 계정은 셋 다 막힌다 ════════════════════════════════════
  console.log('\n[6] 입주사 계정으로 업로드·조회·삭제 전부 막힌다');
  const tList = await fetch(`${API}/companies/${COMPANY}/files`, { headers: withSid(tenant) });
  check('조회가 403 이다', tList.status === 403, `status ${tList.status}`);

  const tUp = await upload(tenant, 'BIZ_REG', jpeg(256), 'image/jpeg');
  check('업로드가 403 이다', tUp.status === 403, `status ${tUp.status}`);

  const tDel = await fetch(`${API}/companies/${COMPANY}/files/${rows2[0].id}`, {
    method: 'DELETE',
    headers: withSid(tenant),
  });
  check('삭제가 403 이다', tDel.status === 403, `status ${tDel.status}`);

  const afterTenant = await dbRows('CEO_ID');
  check('입주사 시도가 아무것도 바꾸지 않았다', afterTenant.length === 1, `${afterTenant.length}행`);

  /*
   * DB 쪽 2차 방어선 — 라우트를 지나쳤다고 가정해도 RLS 가 막는가.
   *
   * ★★ **`erp_app` 으로 붙어서 본다.** 위의 `db` 는 `postgres` 이고 그 역할은
   *    `rolbypassrls = true` 라 **정책이 아예 적용되지 않는다.** postgres 로
   *    「0건이 보인다」를 확인하면 빈 테이블에서만 통과하는 가짜 시험이 된다
   *    (실제로 그렇게 적었다가 여기서 잡혔다 — 2026-09-20).
   *    API 가 쓰는 역할이 `erp_app`(BYPASSRLS 없음)이므로 그것으로 봐야 한다.
   */
  const appDb = new Client({ connectionString: apiEnv.ERP_DATABASE_URL, connectionTimeoutMillis: 15000 });
  await appDb.connect();
  const seenAs = async (role) => {
    await appDb.query('BEGIN');
    await appDb.query(`SELECT set_config('app.current_role', $1, true)`, [role]);
    await appDb.query(`SELECT set_config('app.current_company_id', $1, true)`, [COMPANY]);
    let n;
    try {
      n = (await appDb.query(`SELECT count(*)::int n FROM public.tb_cm_file`)).rows[0].n;
    } catch (e) {
      n = `오류 ${e.code}`;
    }
    await appDb.query('ROLLBACK');
    return n;
  };

  const asOperator = await seenAs('operator');
  const asTenant = await seenAs('tenant');
  // ★ 대조군이 없으면 「0건」이 정책 덕인지 테이블이 비어서인지 알 수 없다.
  check('대조군 — 운영사 스코프는 행을 본다', asOperator > 0, `본 건수 ${asOperator}`);
  check('★ 라우트를 지나쳐도 RLS 가 0건으로 막는다 (erp_app)', asTenant === 0, `본 건수 ${asTenant}`);

  let tenantInsert = 'ok';
  try {
    await appDb.query('BEGIN');
    await appDb.query(`SELECT set_config('app.current_role', 'tenant', true)`);
    await appDb.query(`SELECT set_config('app.current_company_id', $1, true)`, [COMPANY]);
    await appDb.query(
      `INSERT INTO public.tb_cm_file (id,target_type,target_id,file_purpose,original_name,storage_path,mime_type,file_size,operator_id)
       VALUES ('__rls_probe__','COMPANY',$1,'BIZ_REG','p.jpg','1/p.jpg','image/jpeg',10,1)`,
      [COMPANY],
    );
  } catch (e) {
    tenantInsert = e.code;
  } finally {
    await appDb.query('ROLLBACK');
  }
  check('★ 입주사 스코프의 INSERT 를 DB 가 막는다 (42501)', tenantInsert === '42501', `코드 ${tenantInsert}`);

  let noGuc;
  try {
    noGuc = (await appDb.query(`SELECT count(*)::int n FROM public.tb_cm_file`)).rows[0].n;
  } catch (e) {
    noGuc = `오류 ${e.code}`;
  }
  check('★ 스코프를 아예 안 걸면 0건이다 (fail-closed)', noGuc === 0, `본 건수 ${noGuc}`);
  await appDb.end();

  // ══ ③ 삭제하면 양쪽에서 사라진다 ════════════════════════════════════
  console.log('\n[3] 삭제하면 양쪽에서 사라진다');
  const del = await fetch(`${API}/companies/${COMPANY}/files/${rows2[0].id}`, {
    method: 'DELETE',
    headers: withSid(operator),
  });
  check('삭제가 204 다', del.status === 204, `status ${del.status}`);
  check('DB 기록이 사라졌다', (await dbRows('CEO_ID')).length === 0);
  check('★ 스토리지 실물도 사라졌다', !(await objectExists(path2)), path2);

  const delAgain = await fetch(`${API}/companies/${COMPANY}/files/${rows2[0].id}`, {
    method: 'DELETE',
    headers: withSid(operator),
  });
  check('없는 것을 또 지우면 404 다', delAgain.status === 404, `status ${delAgain.status}`);

  // ══ 뒷정리 — 이 스크립트가 남긴 것이 없어야 한다 ═════════════════════
  console.log('\n[뒷정리] 검증이 남긴 것이 없다');
  const leftovers = (
    await db.query(`SELECT id, file_purpose, storage_path FROM public.tb_cm_file WHERE target_id=$1`, [COMPANY])
  ).rows;
  for (const row of leftovers) {
    await fetch(`${API}/companies/${COMPANY}/files/${row.id}`, { method: 'DELETE', headers: withSid(operator) });
  }
  /*
   * ★★ **이 시험이 쓴 회사만 본다.** 예전에는 `tb_cm_file` 과 버킷을 **통째로** 세어
   *    「비어 있어야 한다」고 했다. 운영자가 화면에서 실제 입주사에 서류를 올리는 순간
   *    그 수가 0 이 아니게 되고, 이 두 항목은 **이 기능과 상관없이 영원히 실패한다**
   *    (2026-10-04 에 8행·12건으로 걸려 있었다). 늘 빨간 시험은 아무도 안 본다.
   */
  const finalRows = (
    await db.query(`SELECT count(*)::int n FROM public.tb_cm_file WHERE target_id=$1`, [COMPANY])
  ).rows[0].n;
  check('이 시험이 쓴 회사에 남은 기록이 없다', finalRows === 0, `${finalRows}행`);

  const objs = (
    await db.query(
      `SELECT count(*)::int n FROM storage.objects
        WHERE bucket_id=$1 AND name LIKE '%/companies/' || $2 || '/%'`,
      [BUCKET, COMPANY],
    )
  ).rows[0].n;
  check('★ 이 시험이 쓴 회사 경로에 남은 실물이 없다', objs === 0, `${objs}건`);

  await db.end();
  console.log(`\n  통과 ${pass} · 실패 ${fail}`);
  // ★ 항목이 사라졌는지 본다 — 통과·실패만 세면 **덜 돈 것**을 알 수 없다.
  const short = itemCountGate({ expected: EXPECTED_ITEMS, actual: pass + fail, script: 'verify-cont17.js' });
  process.exit(fail === 0 && !short ? 0 : 1);
})().catch((e) => {
  console.error('\n검증 중단:', e.message);
  process.exit(1);
});
