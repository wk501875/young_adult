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
/* ═══ 부서 · 권한 ═══════════════════════════════
 * 저장소: Cloudflare KV (바인딩 이름 CAL)
 *  config            { depts: [부서], deptAdmins: {부서: [깨사모아이디]}, rosters: {부서: [이름]} }
 *  month:YYYY-MM     { theme, memo, image: bool }
 *  img:YYYY-MM       월정표 원본 그림
 *  ev:YYYY-MM:shared       교회 전체·청년회 일정 (시작일이 그 달인 것)
 *  ev:YYYY-MM:dept:부서    그 부서 일정
 * 권한
 *  최고 관리자(ADMINS): 모두 보기·쓰기, 부서·관리자·명단 관리
 *  부서 관리자(config.deptAdmins): 그 부서 일정 쓰기
 *  회원: 교회 전체·청년회 + 자기 부서(명단에 이름이 있는 부서) 일정 보기
 */
const nameKey = (s) => String(s || '').trim().replace(/^([가-힣]{2,5})\s*[bsBS]$/, '$1').replace(/\s*\((형제|자매)\)$/, '');
const strList = (a, max = 300) => (Array.isArray(a) ? a : []).map((x) => String(x).trim()).filter(Boolean).slice(0, max);

async function getConfig(env) {
  const c = (env.CAL && (await env.CAL.get('config', 'json'))) || {};
  return { depts: strList(c.depts, 50), deptAdmins: c.deptAdmins || {}, rosters: c.rosters || {} };
}
function rostersOf(env, cfg) {
  if (cfg.rosters && Object.keys(cfg.rosters).length) return cfg.rosters;
  try { return JSON.parse(env.ROSTERS || '{}') || {}; } catch { return {}; }
}
// 로그인한 사람 + 볼 수 있는·쓸 수 있는 부서
async function whoAmI(env, hash) {
  const m = await me(env, { hash });
  if (m.status !== 'ok') return { error: m };
  const u = m.result;
  const cfg = await getConfig(env);
  const rosters = rostersOf(env, cfg);
  const id = u.userid.toLowerCase();
  const depts = [...new Set([...cfg.depts, ...Object.keys(rosters)])];
  const adminOf = Object.entries(cfg.deptAdmins).filter(([, ids]) => strList(ids).map((s) => s.toLowerCase()).includes(id)).map(([d]) => d);
  const memberOf = Object.entries(rosters).filter(([, names]) => strList(names).map(nameKey).includes(nameKey(u.name))).map(([d]) => d);
  const sup = !!u.admin;
  return {
    u, cfg, rosters, depts, superAdmin: sup, adminOf, memberOf,
    viewDepts: sup ? depts : [...new Set([...memberOf, ...adminOf])],
    editDepts: sup ? depts : adminOf,
  };
}

// 쓰기 화면용 부서 명단: 최고 관리자는 전부, 나머지는 자기 부서만
async function rosters(env, p) {
  const who = await whoAmI(env, p.hash);
  if (who.error) return who.error;
  const out = {};
  for (const d of who.viewDepts) {
    if (Array.isArray(who.rosters[d])) out[d] = strList(who.rosters[d]);
  }
  return { status: 'ok', result: out };
}

/* ═══ 월정표 (일정) ═════════════════════════════ */
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s));
const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));
const prevMonth = (m) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 2, 1)); return d.toISOString().slice(0, 7); };
const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const bucketOf = (e) => (e.scope === 'dept' ? `dept:${e.dept}` : 'shared');
const needKV = (env) => (env.CAL ? null : { status: 'error', result: '일정 저장소(KV)가 아직 연결되지 않았어요. 관리자에게 알려 주세요.' });

function canEdit(who, scope, dept) {
  if (scope === 'church' || scope === 'youth') return who.superAdmin;
  if (scope === 'dept') return who.editDepts.includes(dept);
  return false;
}
function cleanEvent(e, who) {
  const scope = ['church', 'youth', 'dept'].includes(e?.scope) ? e.scope : '';
  const title = String(e?.title || '').trim().slice(0, 80);
  const start = String(e?.start || '');
  let end = String(e?.end || '') || start;
  if (!scope || !title || !isDate(start)) return { error: '구분·제목·날짜를 확인해 주세요' };
  if (!isDate(end) || end < start) end = start;
  if (end.slice(0, 7) > start.slice(0, 7) && Date.parse(end) - Date.parse(start) > 62 * 86400e3) return { error: '일정 기간이 너무 길어요 (두 달 이내)' };
  const dept = scope === 'dept' ? String(e?.dept || '').trim() : '';
  if (scope === 'dept' && !dept) return { error: '부서를 골라 주세요' };
  return {
    ev: {
      id: String(e?.id || '') || crypto.randomUUID(),
      scope, dept, title, start, end,
      time: String(e?.time || '').trim().slice(0, 30),
      place: String(e?.place || '').trim().slice(0, 40),
      note: String(e?.note || '').trim().slice(0, 300),
      by: who.u.name, at: new Date().toISOString(),
    },
  };
}
async function readBucket(env, month, bucket) { return (await env.CAL.get(`ev:${month}:${bucket}`, 'json')) || []; }
async function writeBucket(env, month, bucket, list) {
  list.sort((a, b) => a.start.localeCompare(b.start) || (a.time || '').localeCompare(b.time || ''));
  if (list.length) await env.CAL.put(`ev:${month}:${bucket}`, JSON.stringify(list));
  else await env.CAL.delete(`ev:${month}:${bucket}`);
}

async function calendar(env, api, p, raw) {
  const kv = needKV(env);
  const who = await whoAmI(env, p.hash);
  if (who.error) return who.error;
  const perms = { superAdmin: who.superAdmin, editShared: who.superAdmin, editDepts: who.editDepts, viewDepts: who.viewDepts, depts: who.depts, memberOf: who.memberOf };

  if (api === 'cal_get') {
    if (kv) return { ...kv, perms };
    const month = isMonth(p.month) ? p.month : new Date().toISOString().slice(0, 7);
    const from = `${month}-01`, to = monthEnd(month);
    const buckets = ['shared', ...who.viewDepts.map((d) => `dept:${d}`)];
    const events = [];
    for (const m of [prevMonth(month), month]) {
      for (const b of buckets) {
        for (const e of await readBucket(env, m, b)) if (e.start <= to && (e.end || e.start) >= from) events.push(e);
      }
    }
    const meta = (await env.CAL.get(`month:${month}`, 'json')) || {};
    return { status: 'ok', month, meta, events, perms };
  }
  if (kv) return kv;

  if (api === 'cal_save' || api === 'cal_bulk') {
    const input = api === 'cal_bulk' ? (Array.isArray(raw.events) ? raw.events.slice(0, 120) : []) : [raw.event];
    const changes = new Map(); // "month|bucket" → list
    const load = async (month, bucket) => {
      const k = `${month}|${bucket}`;
      if (!changes.has(k)) changes.set(k, await readBucket(env, month, bucket));
      return changes.get(k);
    };
    const saved = [];
    for (const item of input) {
      const { ev, error } = cleanEvent(item, who);
      if (error) return { status: 'error', result: error };
      if (!canEdit(who, ev.scope, ev.dept)) return { status: 'error', result: '이 일정을 저장할 권한이 없어요' };
      // 고치는 경우: 원래 자리에서 빼기
      const orig = raw.orig;
      if (api === 'cal_save' && orig && isDate(orig.start)) {
        if (!canEdit(who, orig.scope, orig.dept)) return { status: 'error', result: '원래 일정을 고칠 권한이 없어요' };
        const ol = await load(orig.start.slice(0, 7), bucketOf(orig));
        const i = ol.findIndex((x) => x.id === ev.id);
        if (i >= 0) ol.splice(i, 1);
      }
      const list = await load(ev.start.slice(0, 7), bucketOf(ev));
      const i = list.findIndex((x) => x.id === ev.id);
      if (i >= 0) list[i] = ev; else list.push(ev);
      saved.push(ev);
    }
    for (const [k, list] of changes) { const [m, b] = k.split('|'); await writeBucket(env, m, b, list); }
    return { status: 'ok', result: saved };
  }
  if (api === 'cal_delete') {
    const e = raw.event || {};
    if (!isDate(e.start) || !canEdit(who, e.scope, e.dept)) return { status: 'error', result: '이 일정을 지울 권한이 없어요' };
    const month = e.start.slice(0, 7);
    const list = await readBucket(env, month, bucketOf(e));
    const left = list.filter((x) => x.id !== e.id);
    if (left.length === list.length) return { status: 'error', result: '일정을 찾지 못했어요' };
    await writeBucket(env, month, bucketOf(e), left);
    return { status: 'ok' };
  }
  // 아래는 최고 관리자만
  if (!who.superAdmin) return { status: 'error', result: '최고 관리자만 할 수 있어요' };
  if (api === 'cal_meta_save') {
    if (!isMonth(p.month)) return { status: 'error', result: '달을 확인해 주세요' };
    const old = (await env.CAL.get(`month:${p.month}`, 'json')) || {};
    const meta = { ...old, theme: String(raw.theme || '').trim().slice(0, 80), memo: String(raw.memo || '').trim().slice(0, 3000) };
    await env.CAL.put(`month:${p.month}`, JSON.stringify(meta));
    return { status: 'ok', result: meta };
  }
  if (api === 'cal_img_del') {
    if (!isMonth(p.month)) return { status: 'error', result: '달을 확인해 주세요' };
    await env.CAL.delete(`img:${p.month}`);
    const old = (await env.CAL.get(`month:${p.month}`, 'json')) || {};
    await env.CAL.put(`month:${p.month}`, JSON.stringify({ ...old, image: false }));
    return { status: 'ok' };
  }
  if (api === 'cal_config_get') return { status: 'ok', result: { ...who.cfg, rosters: who.rosters } };
  if (api === 'cal_config_save') {
    const depts = strList(raw.depts, 50);
    const deptAdmins = {}, rost = {};
    for (const d of depts) {
      deptAdmins[d] = strList(raw.deptAdmins?.[d], 30);
      rost[d] = strList(raw.rosters?.[d], 300);
    }
    await env.CAL.put('config', JSON.stringify({ depts, deptAdmins, rosters: rost }));
    return { status: 'ok' };
  }
  return { status: 'error', result: `허용되지 않은 API: ${api}` };
}

// 월정표 원본 그림: 올리기(multipart) · 받기
async function calImagePut(env, form) {
  const kv = needKV(env);
  if (kv) return kv;
  const who = await whoAmI(env, String(form.get('hash') || ''));
  if (who.error) return who.error;
  if (!who.superAdmin) return { status: 'error', result: '최고 관리자만 할 수 있어요' };
  const month = String(form.get('month') || '');
  const file = form.get('file');
  if (!isMonth(month) || !file || typeof file === 'string') return { status: 'error', result: '그림을 확인해 주세요' };
  if (file.size > 5 * 1024 * 1024) return { status: 'error', result: '그림이 너무 커요 (5MB 이하)' };
  const type = /^image\/(png|jpeg|webp|gif)$/.test(file.type) ? file.type : 'image/jpeg';
  await env.CAL.put(`img:${month}`, await file.arrayBuffer(), { metadata: { type } });
  const old = (await env.CAL.get(`month:${month}`, 'json')) || {};
  await env.CAL.put(`month:${month}`, JSON.stringify({ ...old, image: true }));
  return { status: 'ok' };
}
async function calImageGet(env, p) {
  if (!env.CAL || !isMonth(p.month)) return json({ status: 'error', result: '그림이 없어요' });
  const who = await whoAmI(env, p.hash);
  if (who.error) return json(who.error);
  const { value, metadata } = await env.CAL.getWithMetadata(`img:${p.month}`, 'arrayBuffer');
  if (!value) return json({ status: 'error', result: '그림이 없어요' });
  return new Response(value, { headers: { 'Content-Type': metadata?.type || 'image/jpeg', 'Cache-Control': 'private, max-age=600' } });
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

async function upload(env, form) {
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
    const form = await request.formData().catch(() => null);
    if (form && form.get('api') === 'cal_img_put') return json(await calImagePut(env, form));
    return json(await upload(env, form));
  }

  const { api = '', params = {} } = await request.json().catch(() => ({}));
  const clean = cleanParams(params);

  // 월정표: 로그인 필요, 값 모양은 calendar() 안에서 직접 확인
  if (/^cal_/.test(api)) {
    if (!clean.hash) return json({ status: 'error', result: 'hash가 필요합니다' });
    if (api === 'cal_img_get') return calImageGet(env, clean);
    return json(await calendar(env, api, clean, params || {}));
  }

  const spec = APIS[api];
  if (!spec || api === 'board_upload') return json({ status: 'error', result: `허용되지 않은 API: ${api}` });
  if (api === 'login') return json(await login(env, clean));
  if (spec.needHash && !clean.hash) return json({ status: 'error', result: 'hash가 필요합니다' });
  if (api === 'me') {
    // 이름·관리자 여부 + 부서 관리자·소속 부서
    const who = await whoAmI(env, clean.hash);
    if (who.error) return json(who.error);
    return json({ status: 'ok', result: { ...who.u, deptAdminOf: who.adminOf, depts: who.viewDepts } });
  }
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
