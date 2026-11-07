// Cloudflare Pages Function → 주소 /api/jbch (POST)
// 화면에서 { api: '이름', params: {...} } 를 보내면 api.jbch.org 로 중계합니다.
// tokenId 는 Cloudflare 환경 변수 JBCH_TOKEN 에서만 읽고, 화면에는 절대 내보내지 않습니다.
// 사진 올리기(board_upload)만 multipart/form-data 로 받습니다.

const BASE = 'https://api.jbch.org';
const DEV_NAME = 'teach_bible';
// api.jbch.org 는 User-Agent 가 없는 요청을 417 로 막습니다 (Cloudflare 서버는 기본으로 안 붙임)
const UA = 'young_adult/1.0 (Cloudflare Pages)';

// 글쓰기·사진 올리기를 허락한 게시판 (청년회교제실)
const WRITE_BOARDS = ['2122'];

// 중계를 허락한 API만 등록 (여기 없는 주소는 호출 불가)
const APIS = {
  login:         { path: '/in/login.php' },                              // Userid, password → hash
  me:            { path: '/in/member_json.php', needHash: true },        // 로그인한 사람 이름·관리자 여부
  rosters:       { path: '', needHash: true },                           // 부서별 명단 (환경 변수 ROSTERS)
  member_search: { path: '/in/load_member_search.php', needHash: true },
  board_post:    { path: '/in/load_boardb_post.php' },                   // 회원 전용 게시판은 hash 필요
  board_latest:  { path: '/in/load_boardb_latest.php' },
  board_comment: { path: '/in/load_boardb_comment.php' },
  board_write:   { path: '/in/boardb_write_json.php', needHash: true, write: true },
  board_upload:  { path: '/in/boardb_upload_json.php', needHash: true },  // multipart 전용
  comment:       { path: '/in/boardb_pro_json.php', needHash: true },    // 댓글 달기·지우기 (mode)
  schedule:      { path: '/ex/church_schedule.php' },                   // 교회 일정 (청년회 부서)
};

const json = (o) =>
  new Response(JSON.stringify(o), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

// 화면에서 보낸 값 정리 (문자/숫자, 글쓰기 첨부용 문자 배열만. 인증값은 덮어쓰기 금지)
function cleanParams(params) {
  const clean = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (k === 'dev_name' || k === 'tokenId') continue;
    if (typeof v === 'string' || typeof v === 'number') clean[k] = String(v).trim();
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) clean[k] = v;
  }
  return clean;
}

async function relay(path, init) {
  let res;
  try {
    res = await fetch(BASE + path, { method: 'POST', ...init, headers: { 'User-Agent': UA, ...(init.headers || {}) } });
  } catch {
    return { status: 'error', result: 'API 서버에 연결하지 못했습니다' };
  }
  // 토큰 불일치 때 API가 HTTP 500을 주므로, 화면에는 항상 200으로 넘기고 status로 판단
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: 'error', result: `API 응답 오류 (HTTP ${res.status})`, raw: text.slice(0, 300) };
  }
}

// 로그인: 비밀번호는 api.jbch.org 로 넘기기만 하고 어디에도 남기지 않습니다.
async function login(env, p) {
  if (!p.Userid || !p.password) return { status: 'error', result: '아이디와 비밀번호를 입력해 주세요' };
  let res;
  try {
    res = await fetch(BASE + APIS.login.path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({
        dev_name: DEV_NAME, tokenId: env.JBCH_TOKEN,
        Userid: p.Userid, password: p.password, device: 'Web', output: '1',
      }),
    });
  } catch {
    return { status: 'error', result: 'API 서버에 연결하지 못했습니다' };
  }
  const text = await res.text();
  let hash = '';
  let msg = '';
  try {
    const j = JSON.parse(text);
    hash = j.hash || (j.result && j.result.hash) || '';
    msg = j.comment || (typeof j.result === 'string' && j.result !== 'ok' ? j.result : '');
  } catch {
    // output=1 이 아닐 때의 글자 응답: status@@ok@@hash
    const parts = text.split('@@');
    if (parts[1] === 'ok') hash = parts[2] || '';
    else msg = parts.slice(1).join(' ');
  }
  hash = String(hash).trim();
  if (hash) return { status: 'ok', hash };
  return { status: 'error', result: msg || '아이디나 비밀번호를 확인해 주세요' };
}

// 관리자 아이디 목록: Cloudflare 환경 변수 ADMINS (쉼표로 구분, 예: "wk5018,hong123")
const adminsOf = (env) => String(env.ADMINS || '').split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);

// 내 정보: 화면에 필요한 이름만 돌려줍니다 (주소·연락처 등은 버림)
async function me(env, p) {
  const r = await relay(APIS.me.path, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dev_name: DEV_NAME, tokenId: env.JBCH_TOKEN, hash: p.hash }),
  });
  const u = r && r.result && typeof r.result === 'object' ? r.result : null;
  if (r.status !== 'ok' || !u) return { status: r.status || 'error', result: typeof r.result === 'string' ? r.result : '회원 정보를 찾지 못했습니다' };
  const userid = String(u.userid || '');
  return {
    status: 'ok',
    result: {
      userid, name: u.username || u.name || '', sex: u.sex || '', church: u.churchname || '',
      admin: adminsOf(env).includes(userid.toLowerCase()),
    },
  };
}

// 부서별 명단: Cloudflare 환경 변수 ROSTERS (JSON). 저장소가 공개라 코드에는 넣지 않습니다.
// 예: {"순종부":["김민수b","이다정s"],"사랑부":["…"]}  — 로그인한 회원에게만 돌려줌
async function rosters(env, p) {
  const who = await me(env, p);
  if (who.status !== 'ok') return who;
  if (!env.ROSTERS) return { status: 'ok', result: {} };
  let data;
  try { data = JSON.parse(env.ROSTERS); } catch { return { status: 'error', result: 'ROSTERS 환경 변수 JSON 모양이 올바르지 않습니다' }; }
  const out = {};
  for (const [dept, names] of Object.entries(data || {})) {
    if (Array.isArray(names)) out[String(dept)] = names.map((n) => String(n).trim()).filter(Boolean);
  }
  return { status: 'ok', result: out };
}

// 댓글 달기(add_comment)·지우기(del_comment): 청년회교제실 글에만 허락
const CH_ID = '86';
async function comment(env, p) {
  const mode = p.mode;
  if (mode !== 'add_comment' && mode !== 'del_comment') return { status: 'error', result: '허용되지 않은 댓글 명령입니다' };
  if (!/^\d+$/.test(p.board_uid || '')) return { status: 'error', result: '글 번호가 없습니다' };
  const text = String(p.comment || '').trim();
  if (mode === 'add_comment' && text.length < 2) return { status: 'error', result: '댓글은 2자 이상 써 주세요' };
  if (text.length > 1000) return { status: 'error', result: '댓글이 너무 깁니다 (1000자 이하)' };
  if (mode === 'del_comment' && !/^\d+$/.test(p.comment_uid || '')) return { status: 'error', result: '댓글 번호가 없습니다' };

  // 이 글이 정말 허락한 게시판의 글인지 확인
  const post = await relay(APIS.board_post.path, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dev_name: DEV_NAME, tokenId: env.JBCH_TOKEN, hash: p.hash, chId: CH_ID, use_kind: '1', flag: '1', uid: p.board_uid }),
  });
  const row = post.status === 'ok' && Array.isArray(post.result) ? post.result.find((x) => String(x.postUid) === p.board_uid) : null;
  if (!row || !WRITE_BOARDS.includes(String(row.position))) return { status: 'error', result: '댓글을 달 수 없는 글입니다' };

  const body = { dev_name: DEV_NAME, tokenId: env.JBCH_TOKEN, hash: p.hash, mode, board_uid: p.board_uid, chId: CH_ID };
  if (mode === 'add_comment') { body.comment = text; body.url = String(p.url || '').slice(0, 300); }
  else body.comment_uid = p.comment_uid;
  return relay(APIS.comment.path, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function upload(env, request) {
  const form = await request.formData().catch(() => null);
  if (!form) return { status: 'error', result: '사진을 읽지 못했습니다' };
  const hash = String(form.get('hash') || '');
  const file = form.get('file');
  const boardId = String(form.get('boardId') || '');
  if (!hash) return { status: 'error', result: 'hash가 필요합니다' };
  if (!WRITE_BOARDS.includes(boardId)) return { status: 'error', result: '사진을 올릴 수 없는 게시판입니다' };
  if (!file || typeof file === 'string') return { status: 'error', result: '사진 파일이 없습니다' };
  if (file.size > 10 * 1024 * 1024) return { status: 'error', result: '사진이 너무 큽니다 (10MB 이하)' };
  const out = new FormData();
  out.append('dev_name', DEV_NAME);
  out.append('tokenId', env.JBCH_TOKEN);
  out.append('hash', hash);
  if (form.get('chId')) out.append('chId', String(form.get('chId')));
  out.append('file', file, file.name || 'photo.jpg');
  return relay(APIS.board_upload.path, { body: out });
}

export async function onRequestPost({ request, env }) {
  if (!env.JBCH_TOKEN) return json({ status: 'error', result: 'JBCH_TOKEN 환경 변수가 설정되지 않았습니다' });

  if ((request.headers.get('Content-Type') || '').includes('multipart/form-data')) {
    return json(await upload(env, request));
  }

  const { api = '', params = {} } = await request.json().catch(() => ({}));
  const spec = APIS[api];
  if (!spec || api === 'board_upload') return json({ status: 'error', result: `허용되지 않은 API: ${api}` });

  const clean = cleanParams(params);
  if (api === 'login') return json(await login(env, clean));
  if (spec.needHash && !clean.hash) return json({ status: 'error', result: 'hash가 필요합니다' });
  if (api === 'me') return json(await me(env, clean));
  if (api === 'rosters') return json(await rosters(env, clean));
  if (api === 'comment') return json(await comment(env, clean));
  if (spec.write && !WRITE_BOARDS.includes(clean.boardId)) return json({ status: 'error', result: '글을 쓸 수 없는 게시판입니다' });

  return json(await relay(spec.path, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dev_name: DEV_NAME, tokenId: env.JBCH_TOKEN, ...clean }),
  }));
}

export function onRequest() {
  return json({ status: 'error', result: 'POST로만 호출할 수 있습니다' });
}
