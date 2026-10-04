/**
 * 끝난 세션 치우기 — 손으로 돌리는 길.
 *
 * ★★ **판정을 여기 다시 적지 않는다.** 지우는 조건은 API 의
 *    `packages/api/src/session/purge.ts` 한 곳이고, 서버의 하루 한 번 타이머
 *    (`session/purgeTimer.ts`)와 이 스크립트가 **같은 함수**를 부른다.
 *    SQL 을 여기 베껴 두면 언젠가 한쪽만 고쳐지고, 그날 둘은 다른 것을 지운다.
 *
 * ★ **기본은 미리보기다.** 그냥 돌리면 세어서 보여주기만 하고 아무것도 안 지운다.
 *   지우려면 `--apply` 를 붙인다. 되돌릴 수 없는 일에 오타 한 번으로 들어가지 않는다.
 *
 * ★ 살아 있는 세션 수를 **지우기 전후로 세어 확인한다.** 「살아 있는 것은 안 건드린다」를
 *   말로만 두지 않는다 — 한 건이라도 줄면 그 자리에서 실패로 알린다.
 *
 * ★ 평소에는 이 스크립트가 할 일이 없다. 로그아웃은 그 자리에서 지우고, 만료된 것은
 *   서버가 하루 한 번 치운다. 이것은 **한 번에 몰아 치우거나 수를 눈으로 볼 때** 쓴다.
 *
 * 사용:
 *   node --experimental-strip-types scripts/purge-sessions.js            미리보기
 *   node --experimental-strip-types scripts/purge-sessions.js --apply    실제로 지운다
 */
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { purgeDeadSessions } from '../packages/api/src/session/purge.ts';

const apply = process.argv.slice(2).includes('--apply');

/** 상태별 건수. 「살아 있음」이 이 스크립트가 지켜야 할 수다. */
async function census() {
  const { rows } = await pool.query(`
    SELECT count(*) FILTER (WHERE revoked_at IS NOT NULL)                     AS revoked,
           count(*) FILTER (WHERE revoked_at IS NULL AND expires_at <= now()) AS expired,
           count(*) FILTER (WHERE revoked_at IS NULL AND expires_at >  now()) AS alive,
           count(*)                                                           AS total
      FROM public.tb_s080_auth_session`);
  const r = rows[0];
  return { revoked: +r.revoked, expired: +r.expired, alive: +r.alive, total: +r.total };
}

const line = (c) => `  만료 ${c.expired} · 폐기 ${c.revoked} · 살아 있음 ${c.alive}  (계 ${c.total})`;

(async () => {
  const before = await census();
  const dead = before.expired + before.revoked;

  console.log(`\n세션 정리${apply ? '' : ' — 미리보기(아무것도 안 지운다)'}`);
  console.log('\n지금');
  console.log(line(before));
  console.log(`\n지울 것 ${dead}건 · 남길 것(살아 있음) ${before.alive}건`);

  if (!apply) {
    console.log(
      dead === 0 ? '\n지울 것이 없다.' : '\n실제로 지우려면 --apply 를 붙여 다시 돌린다.',
    );
    await closePool();
    return;
  }

  const deleted = await purgeDeadSessions();
  const after = await census();

  console.log(`\n지웠다 — ${deleted}건`);
  console.log('남은 것');
  console.log(line(after));

  // ★ 여기가 이 스크립트의 안전장치다. 살아 있는 세션이 하나라도 줄면 실패다.
  if (after.alive !== before.alive) {
    console.error(
      `\n✘ 살아 있는 세션이 ${before.alive} → ${after.alive} 로 바뀌었다. 지우면 안 되는 것을 지웠다.`,
    );
    await closePool();
    process.exit(1);
  }
  console.log(`✔ 살아 있는 세션 ${after.alive}건은 그대로다`);
  await closePool();
})().catch(async (err) => {
  console.error('✘ 정리 중 오류:', err.message);
  await closePool().catch(() => {});
  process.exit(1);
});
