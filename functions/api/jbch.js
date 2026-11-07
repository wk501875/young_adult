// Cloudflare Pages Function → 주소 /api/jbch (POST)
// 화면에서 { api: '이름', params: {...} } 를 보내면 api.jbch.org 로 중계합니다.
// tokenId 는 Cloudflare 환경 변수 JBCH_TOKEN 에서만 읽고, 화면에는 절대 내보내지 않습니다.

const BASE = 'https://api.jbch.org';
const DEV_NAME = 'teach_bible';

// 중계를 허락한 API만 등록 (여기 없는 주소는 호출 불가)
const APIS = {
  member_search: { path: '/in/load_member_search.php', needHash: true },
  board_post:    { path: '/in/load_boardb_post.php' },
  board_latest:  { path: '/in/load_boardb_latest.php' },
  board_comment: { path: '/in/load_boardb_comment.php' },
};

const json = (o) =>
  new Response(JSON.stringify(o), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export async function onRequestPost({ request, env }) {
  if (!env.JBCH_TOKEN) return json({ status: 'error', result: 'JBCH_TOKEN 환경 변수가 설정되지 않았습니다' });

  const { api = '', params = {} } = await request.json().catch(() => ({}));
  const spec = APIS[api];
  if (!spec) return json({ status: 'error', result: `허용되지 않은 API: ${api}` });

  // 화면에서 보낸 값 정리 (문자/숫자만, 인증값은 덮어쓰기 금지)
  const clean = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (k === 'dev_name' || k === 'tokenId') continue;
    if (typeof v === 'string' || typeof v === 'number') clean[k] = String(v).trim();
  }
  if (spec.needHash && !clean.hash) return json({ status: 'error', result: 'hash가 필요합니다' });

  let res;
  try {
    res = await fetch(BASE + spec.path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dev_name: DEV_NAME, tokenId: env.JBCH_TOKEN, ...clean }),
    });
  } catch (e) {
    return json({ status: 'error', result: 'API 서버에 연결하지 못했습니다' });
  }

  // 토큰 불일치 때 API가 HTTP 500을 주므로, 화면에는 항상 200으로 넘기고 status로 판단
  const text = await res.text();
  try {
    return json(JSON.parse(text));
  } catch {
    return json({ status: 'error', result: `API 응답 오류 (HTTP ${res.status})`, raw: text.slice(0, 500) });
  }
}

export function onRequest() {
  return json({ status: 'error', result: 'POST로만 호출할 수 있습니다' });
}
