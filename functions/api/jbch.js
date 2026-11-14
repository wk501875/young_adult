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
  bible:         { path: '/in/load_bible.php' },                     // 토브성경 본문 조회·검색 (bCode·eCode·langCode)
  memory:        { path: '/ex/bible_memory.php' },                   // 우리 교회 이번 주 암송 구절 (chId)
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
  // 깨사모 프로필 사진 (항목 이름이 정해져 있지 않아 사진 주소처럼 생긴 값을 찾음)
  const picKey = Object.keys(u).find((k) => /pic|photo|img|profile/i.test(k) && /^https:\/\//.test(String(u[k] || '')));
  const pic = picKey ? String(u[picKey]) : (Object.values(u).find((v) => /^https:\/\/[^\s]*member\/profile/.test(String(v || ''))) || '');
  return {
    status: 'ok',
    result: {
      userid, name: u.username || u.name || '', sex: u.sex || '', church: u.churchname || '', pic,
      admin: adminsOf(env).includes(userid.toLowerCase()),
    },
  };
}

/* ═══ 프로필 사진 ════════════════════════════════
 * - 깨사모 사진: 회원이 앱을 열 때 주소를 기억해 둠 (pic:아이디) → 다른 회원 글·댓글에도 보이게
 * - 앱에서 바꾼 사진: 256px로 줄인 JPEG를 KV에 (avatar:아이디). 깨사모 사진은 바뀌지 않음
 * - 로그인한 회원에게만 돌려줌 (앱 밖으로 공개하지 않음) */
async function avatars(env, api, p, raw) {
  const kv = needKV(env);
  if (kv) return kv;
  const who = await whoAmI(env, p.hash);
  if (who.error) return who.error;
  const id = who.u.userid;
  if (api === 'avatar_set') {
    const img = String(raw.image || '');
    if (!/^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(img)) return { status: 'error', result: '사진 모양이 올바르지 않아요' };
    if (img.length > 120000) return { status: 'error', result: '사진이 너무 커요' };
    await env.CAL.put(`avatar:${id}`, img);
    return { status: 'ok', result: img };
  }
  if (api === 'avatar_del') { await env.CAL.delete(`avatar:${id}`); return { status: 'ok', result: who.u.pic || '' }; }
  if (api === 'avatar_get') {
    const ids = (Array.isArray(raw.ids) ? raw.ids : []).map(String).filter((x) => /^[\w.-]{1,40}$/.test(x)).slice(0, 60);
    const out = {};
    await Promise.all(ids.map(async (x) => {
      out[x] = (await env.CAL.get(`avatar:${x}`)) || (await env.CAL.get(`pic:${x}`)) || '';
    }));
    return { status: 'ok', result: out };
  }
  return { status: 'error', result: `허용되지 않은 API: ${api}` };
}

/* ═══ 성경읽기 (맥체인) 체크 ══════════════════════
 * rd:아이디:연도  = 365일 × 4곳을 '0'/'1' 1460글자로 (어느 기기에서든 같은 체크)
 * rdc:날짜:아이디 = 그날 네 곳을 다 읽은 사람 (몇 명이 읽었는지만 셈, 3일 뒤 자동 삭제) */
async function reading(env, api, p, raw) {
  const kv = needKV(env);
  if (kv) return kv;
  const who = await whoAmI(env, p.hash);
  if (who.error) return who.error;
  // 자유롭게 읽기: 성경 1189장마다 읽음 '0'/'1' (rf:아이디, 연도와 상관없이 쌓임)
  if (api === 'rf_get' || api === 'rf_set') {
    const fkey = `rf:${who.u.userid}`;
    let fm = ((await env.CAL.get(fkey)) || '').padEnd(1189, '0').slice(0, 1189);
    if (api === 'rf_set') {
      const i = Number(raw.idx);
      if (!Number.isInteger(i) || i < 0 || i > 1188) return { status: 'error', result: '장을 확인해 주세요' };
      fm = fm.slice(0, i) + (raw.on ? '1' : '0') + fm.slice(i + 1);
      await env.CAL.put(fkey, fm);
    }
    return { status: 'ok', result: fm };
  }
  const year = String(raw.year || '');
  if (!/^20\d\d$/.test(year)) return { status: 'error', result: '연도를 확인해 주세요' };
  const key = `rd:${who.u.userid}:${year}`;
  let marks = (await env.CAL.get(key)) || '';
  marks = marks.padEnd(1460, '0').slice(0, 1460);
  const countToday = async (date) => (/^\d{4}-\d\d-\d\d$/.test(date) ? (await env.CAL.list({ prefix: `rdc:${date}:` })).keys.length : 0);
  if (api === 'rd_get') return { status: 'ok', result: marks, doneToday: await countToday(String(raw.date || '')) };
  if (api === 'rd_set') {
    const day = Number(raw.day), idx = Number(raw.idx);
    if (!Number.isInteger(day) || day < 0 || day > 364 || !Number.isInteger(idx) || idx < 0 || idx > 3) return { status: 'error', result: '읽기 칸을 확인해 주세요' };
    const i = day * 4 + idx;
    marks = marks.slice(0, i) + (raw.on ? '1' : '0') + marks.slice(i + 1);
    await env.CAL.put(key, marks);
    const date = String(raw.date || '');
    if (/^\d{4}-\d\d-\d\d$/.test(date)) {
      const all = marks.slice(day * 4, day * 4 + 4) === '1111';
      const ck = `rdc:${date}:${who.u.userid}`;
      if (all) await env.CAL.put(ck, '1', { expirationTtl: 3 * 86400 }); else await env.CAL.delete(ck);
    }
    return { status: 'ok', result: marks, doneToday: await countToday(date) };
  }
  return { status: 'error', result: `허용되지 않은 API: ${api}` };
}

/* ═══ 교제록 템플릿 ══════════════════════════════
 * 자주 쓰는 양식(참석자·말씀·나눔·기도제목·기타)을 이름 붙여 저장 → 어느 기기에서든 불러오기. 한 사람에 10개까지 */
async function templates(env, api, p, raw) {
  const kv = needKV(env);
  if (kv) return kv;
  const who = await whoAmI(env, p.hash);
  if (who.error) return who.error;
  const key = `tpl:${who.u.userid}`;
  const list = (await env.CAL.get(key, 'json')) || [];
  if (api === 'tpl_list') return { status: 'ok', result: list };
  if (api === 'tpl_save') {
    const name = String(raw.name || '').trim().slice(0, 30);
    if (!name) return { status: 'error', result: '템플릿 이름을 적어 주세요' };
    const data = raw.data && typeof raw.data === 'object' ? raw.data : {};
    const json = JSON.stringify(data);
    if (json.length > 20000) return { status: 'error', result: '템플릿 내용이 너무 길어요' };
    const old = list.findIndex((t) => t.name === name);
    const item = { id: old >= 0 ? list[old].id : crypto.randomUUID().slice(0, 8), name, data: JSON.parse(json), at: new Date().toISOString() };
    if (old >= 0) list[old] = item; else list.unshift(item);
    await env.CAL.put(key, JSON.stringify(list.slice(0, 10)));
    return { status: 'ok', result: list.slice(0, 10) };
  }
  if (api === 'tpl_del') {
    const next = list.filter((t) => t.id !== String(raw.id || ''));
    await env.CAL.put(key, JSON.stringify(next));
    return { status: 'ok', result: next };
  }
  return { status: 'error', result: `허용되지 않은 API: ${api}` };
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

/* ═══ 번개 모임 ═════════════════════════════════
 * 형제 번개(m) · 자매 번개(f)를 따로 저장하고, 깨사모 회원정보의 성별로만 고름.
 * 화면에서 보낸 값으로는 다른 게시판에 닿을 수 없음 (키에 게시판이 들어감).
 *  bgm:{b}:{id}              번개 하나 (값: 전체, metadata: 목록용 요약)
 *  bgj:{b}:{id}:{userid}     참여 (metadata: 이름·시각)
 *  bgc:{b}:{id}:{시각}-{id}  댓글 (metadata: 이름·내용)
 */
const boardOf = (u) => (/자매|여/.test(u.sex || '') ? 'f' : /형제|남/.test(u.sex || '') ? 'm' : '');
const BOARD_NAME = { m: '형제', f: '자매' };
async function listAll(env, prefix) {
  const out = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const r = await env.CAL.list({ prefix, cursor });
    out.push(...r.keys);
    if (r.list_complete || !r.cursor) break;
    cursor = r.cursor;
  }
  return out;
}
const isTime = (s) => !s || /^\d{2}:\d{2}$/.test(s);
function cleanMeetup(m) {
  const title = String(m?.title || '').trim().slice(0, 60);
  const date = String(m?.date || '');
  const time = String(m?.time || '');
  if (!title || !isDate(date) || !isTime(time)) return { error: '제목·날짜·시간을 확인해 주세요' };
  const placeUrl = String(m?.placeUrl || '').trim().slice(0, 300);
  if (placeUrl && !/^https:\/\//.test(placeUrl)) return { error: '장소 링크는 https:// 로 시작해야 해요' };
  const cap = Math.max(0, Math.min(200, parseInt(m?.cap, 10) || 0));
  const deadline = String(m?.deadline || '');
  if (deadline && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(deadline)) return { error: '마감 시각을 확인해 주세요' };
  return {
    m: {
      title, date, time, cap, deadline,
      place: String(m?.place || '').trim().slice(0, 60), placeUrl,
      note: String(m?.note || '').trim().slice(0, 1000),
    },
  };
}
const summary = (m) => ({ title: m.title, date: m.date, time: m.time, place: m.place, cap: m.cap, deadline: m.deadline, closed: !!m.closed, by: m.by?.name || '', byId: m.by?.userid || '', review: !!m.review });
// 마감 판단: 직접 마감했거나, 마감 시각이 지났거나, 모임 날이 지났으면
function isClosed(m, now = new Date()) {
  if (m.closed) return true;
  const kst = new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 16); // 한국 시각 YYYY-MM-DDTHH:MM
  if (m.deadline && kst > m.deadline) return true;
  return kst.slice(0, 10) > m.date;
}

async function meetup(env, api, p, raw) {
  const kv = needKV(env);
  if (kv) return kv;
  const who = await whoAmI(env, p.hash);
  if (who.error) return who.error;
  // 형제는 형제 번개, 자매는 자매 번개만. 최고 관리자는 둘 다 골라서 볼 수 있음
  let b = boardOf(who.u);
  if (who.superAdmin && ['m', 'f'].includes(raw.board)) b = raw.board;
  else if (who.superAdmin && !b) b = 'm';
  if (!b) return { status: 'error', result: '깨사모 회원정보에 성별이 없어 번개 게시판을 열 수 없어요' };
  const me = { userid: who.u.userid, name: who.u.name };
  const base = { board: b, boardName: BOARD_NAME[b], boards: who.superAdmin ? ['m', 'f'] : [b] };

  if (api === 'bg_list') {
    const [ms, js] = await Promise.all([listAll(env, `bgm:${b}:`), listAll(env, `bgj:${b}:`)]);
    const joins = new Map();
    for (const k of js) {
      const id = k.name.split(':')[2];
      if (!joins.has(id)) joins.set(id, []);
      joins.get(id).push({ userid: k.name.split(':').slice(3).join(':'), ...(k.metadata || {}) });
    }
    const items = ms.map((k) => {
      const id = k.name.split(':')[2];
      const js2 = (joins.get(id) || []).sort((a, c) => String(a.at).localeCompare(String(c.at)));
      const s = k.metadata || {};
      return { id, ...s, closed: isClosed(s), joined: js2.some((j) => j.userid === me.userid), count: js2.length, people: js2.slice(0, 5).map((j) => j.name) };
    });
    return { status: 'ok', ...base, me, items };
  }

  const id = String(raw.id || '');
  const key = `bgm:${b}:${id}`;
  if (api === 'bg_save') {
    const { m, error } = cleanMeetup(raw.meetup);
    if (error) return { status: 'error', result: error };
    let cur = null;
    if (id) {
      cur = await env.CAL.get(key, 'json');
      if (!cur) return { status: 'error', result: '번개를 찾지 못했어요' };
      if (cur.by.userid !== me.userid && !who.superAdmin) return { status: 'error', result: '연 사람만 고칠 수 있어요' };
    }
    const next = { ...(cur || { id: crypto.randomUUID().slice(0, 8), by: me, at: new Date().toISOString(), closed: false }), ...m, edited: cur ? new Date().toISOString() : undefined };
    await env.CAL.put(`bgm:${b}:${next.id}`, JSON.stringify(next), { metadata: summary(next) });
    // 연 사람은 자동으로 참여
    if (!cur) await env.CAL.put(`bgj:${b}:${next.id}:${me.userid}`, '1', { metadata: { name: me.name, at: new Date().toISOString() } });
    // 새 번개면 같은 쪽(형제/자매) 사람들에게 바로 알림 (연 사람 빼고)
    if (!cur) await notifyMeetup(env, b, next).catch(() => {});
    return { status: 'ok', result: { id: next.id } };
  }

  const cur = id ? await env.CAL.get(key, 'json') : null;
  if (!cur) return { status: 'error', result: '번개를 찾지 못했어요' };
  const isOwner = cur.by.userid === me.userid || who.superAdmin;

  if (api === 'bg_get') {
    const [js, cs] = await Promise.all([listAll(env, `bgj:${b}:${id}:`), listAll(env, `bgc:${b}:${id}:`)]);
    const joins = js.map((k) => ({ userid: k.name.split(':').slice(3).join(':'), ...(k.metadata || {}) })).sort((a, c) => String(a.at).localeCompare(String(c.at)));
    const comments = cs.map((k) => ({ cid: k.name.split(':').slice(3).join(':'), ...(k.metadata || {}) })).sort((a, c) => a.cid.localeCompare(c.cid));
    return { status: 'ok', ...base, me, isOwner, item: { ...cur, closedNow: isClosed(cur) }, joins, comments };
  }
  if (api === 'bg_join') {
    const jk = `bgj:${b}:${id}:${me.userid}`;
    if (raw.on) {
      if (isClosed(cur)) return { status: 'error', result: '마감된 번개예요' };
      if (cur.cap) {
        const n = (await listAll(env, `bgj:${b}:${id}:`)).filter((k) => !k.name.endsWith(`:${me.userid}`)).length;
        if (n >= cur.cap) return { status: 'error', result: '정원이 다 찼어요' };
      }
      await env.CAL.put(jk, '1', { metadata: { name: me.name, at: new Date().toISOString() } });
    } else {
      if (cur.by.userid === me.userid) return { status: 'error', result: '연 사람은 참여를 취소할 수 없어요. 번개를 지우거나 마감해 주세요' };
      await env.CAL.delete(jk);
    }
    return { status: 'ok' };
  }
  if (api === 'bg_comment') {
    const text = String(raw.text || '').trim().slice(0, 200);
    if (text.length < 1) return { status: 'error', result: '댓글을 적어 주세요' };
    const cid = `${Date.now()}-${me.userid}`;
    await env.CAL.put(`bgc:${b}:${id}:${cid}`, '1', { metadata: { name: me.name, userid: me.userid, text, at: new Date().toISOString() } });
    return { status: 'ok', result: { cid } };
  }
  if (api === 'bg_comment_del') {
    const cid = String(raw.cid || '');
    if (!cid.endsWith(`-${me.userid}`) && !who.superAdmin) return { status: 'error', result: '내 댓글만 지울 수 있어요' };
    await env.CAL.delete(`bgc:${b}:${id}:${cid}`);
    return { status: 'ok' };
  }
  if (!isOwner) return { status: 'error', result: '연 사람만 할 수 있어요' };
  if (api === 'bg_close' || api === 'bg_review') {
    const next = api === 'bg_close' ? { ...cur, closed: !!raw.closed } : { ...cur, review: String(raw.review || '').trim().slice(0, 2000) };
    await env.CAL.put(key, JSON.stringify(next), { metadata: summary(next) });
    return { status: 'ok' };
  }
  if (api === 'bg_delete') {
    const keys = [key, ...(await listAll(env, `bgj:${b}:${id}:`)).map((k) => k.name), ...(await listAll(env, `bgc:${b}:${id}:`)).map((k) => k.name)];
    for (const k of keys) await env.CAL.delete(k);
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
// 댓글·좋아요: 교제록 + 청년회 앨범·결혼식 앨범 글에만
const REACT_BOARDS = ['2122', '7159', '7161'];
async function comment(env, p) {
  const mode = p.mode;
  if (!['add_comment', 'del_comment', 'chkLike', 'processLike'].includes(mode)) return { status: 'error', result: '허용되지 않은 댓글 명령입니다' };
  if (!/^\d+$/.test(p.board_uid || '')) return { status: 'error', result: '글 번호가 없습니다' };
  // 내가 좋아요를 눌렀는지 보기만 하는 건 게시판 확인 없이 바로
  if (mode === 'chkLike') {
    return relay(APIS.comment.path, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dev_name: DEV_NAME, tokenId: env.JBCH_TOKEN, hash: p.hash, mode, board_uid: p.board_uid, chId: CH_ID }) });
  }
  if (mode === 'processLike' && !['1', '2'].includes(String(p.sw))) return { status: 'error', result: '좋아요 값이 올바르지 않아요' };
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
  if (!row || !REACT_BOARDS.includes(String(row.position))) return { status: 'error', result: mode === 'processLike' ? '좋아요를 누를 수 없는 글입니다' : '댓글을 달 수 없는 글입니다' };

  const body = { dev_name: DEV_NAME, tokenId: env.JBCH_TOKEN, hash: p.hash, mode, board_uid: p.board_uid, chId: CH_ID };
  if (mode === 'add_comment') { body.comment = text; body.url = String(p.url || '').slice(0, 300); }
  else if (mode === 'processLike') body.sw = String(p.sw);
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

/* ═══ 휴대폰 알림 (Web Push) ═════════════════════
 * - 알림용 열쇠(VAPID)는 서버가 처음 쓸 때 직접 만들어 KV에만 둠 (코드·화면에 비밀값 없음)
 * - 알림은 내용 없이 보내고, 휴대폰의 서비스 워커(/sw.js)가 push_latest로 문구를 받아 보여 줌
 * - push_run: GitHub Actions가 10분마다 부르지만 실제 확인은 50분에 한 번
 *   · 앨범(청년회·결혼식)은 공개라 그냥 확인
 *   · 교제록(회원 전용)은 최고 관리자가 앱을 열 때 저장해 둔 로그인 정보로 확인
 * - 무료 요금제는 한 번에 바깥 요청 50개까지라, 받는 사람이 많으면 40명씩 나눠 보냄 (more: true)
 */
const PUSH_GAP = 50 * 60 * 1000;
const PUSH_CHUNK = 40;
const PUSH_BOARDS = [
  { key: 'album:7159', boardId: '7159', use_kind: '3', name: '청년회 앨범', kind: 'album' },
  { key: 'album:7161', boardId: '7161', use_kind: '3', name: '결혼식 앨범', kind: 'album' },
  { key: 'board:2122', boardId: '2122', use_kind: '1', name: '교제록', kind: 'post', member: true },
];
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uText = (s) => b64u(new TextEncoder().encode(s));
async function vapidKeys(env) {
  const old = await env.CAL.get('push:vapid', 'json');
  if (old) return old;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const k = { priv: await crypto.subtle.exportKey('jwk', pair.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', pair.publicKey)) };
  await env.CAL.put('push:vapid', JSON.stringify(k));
  return k;
}
async function vapidAuth(endpoint, k) {
  const head = b64uText(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64uText(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://young-adult.pages.dev' }));
  const key = await crypto.subtle.importKey('jwk', k.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${k.pub}`;
}
const subId = async (endpoint) => b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))).slice(0, 32);
const deptOfTitle = (s) => (String(s).match(/\[\s*\d{4}\s*([^\]]+?)\s*\]/) || [])[1] || (/청년회/.test(s) ? '청년회' : '');

async function latestRows(env, b, hash) {
  const r = await relay(APIS.board_post.path, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dev_name: DEV_NAME, tokenId: env.JBCH_TOKEN, chId: '86', flag: '1', use_kind: b.use_kind, boardId: b.boardId, page: '1', limit: '10', ...(hash ? { hash } : {}) }),
  });
  return r.status === 'ok' && Array.isArray(r.result) ? r.result.filter((x) => x.postUid && x.subject) : null;
}
// 지난번 확인 뒤에 올라온 글 (글 번호가 커지는 걸로 판단, 처음엔 기준만 잡고 알림 없음)
async function newSince(env, key, rows) {
  const seenKey = `push:seen:${key}`;
  const seen = Number(await env.CAL.get(seenKey)) || 0;
  const max = Math.max(0, ...rows.map((x) => Number(x.postUid) || 0));
  if (max > seen) await env.CAL.put(seenKey, String(max));
  return seen ? rows.filter((x) => Number(x.postUid) > seen) : [];
}
function pushMessage(found) {
  const posts = found.filter((f) => f.kind === 'post');
  const albums = found.filter((f) => f.kind === 'album');
  if (found.length === 1) {
    const f = found[0];
    return f.kind === 'post'
      ? { title: '새 교제록이 올라왔어요', body: `${f.dept || '청년회'} 교제록을 확인해 보세요`, url: f.url }
      : { title: `${f.name}에 새 글이 올라왔어요`, body: f.title, url: f.url };
  }
  const depts = [...new Set(posts.map((f) => f.dept || '청년회'))];
  const parts = [];
  if (posts.length) parts.push(`교제록 ${posts.length}개 (${depts.join(', ')})`);
  if (albums.length) parts.push(`앨범 ${albums.length}개`);
  return { title: `새 글 ${found.length}개가 올라왔어요`, body: parts.join(' · '), url: posts.length ? '/#/' : '/#/album' };
}
// 보내기 작업(pjob:*) 하나를 40명씩 처리. job.board가 있으면 그쪽(형제 m/자매 f) 사람만, job.skip은 뺄 사람(글 연 사람)
async function pushSendChunk(env, jobKey, job) {
  const k = await vapidKeys(env);
  const page = await env.CAL.list({ prefix: 'psub:', limit: PUSH_CHUNK, ...(job.cursor ? { cursor: job.cursor } : {}) });
  let sent = 0, gone = 0;
  for (const key of page.keys) {
    const md = key.metadata || {};
    if (!md.endpoint) continue;
    if (job.board && md.board !== job.board) continue;
    if (job.skip && md.userid === job.skip) continue;
    try {
      const res = await fetch(md.endpoint, { method: 'POST', headers: { TTL: '86400', Urgency: 'normal', Authorization: await vapidAuth(md.endpoint, k), 'Content-Length': '0' } });
      if (res.status === 404 || res.status === 410) { await env.CAL.delete(key.name); gone++; } else if (res.ok) sent++;
    } catch { /* 한 사람 실패는 넘어감 */ }
  }
  if (page.list_complete) { await env.CAL.delete(jobKey); return { sent, gone, more: false }; }
  await env.CAL.put(jobKey, JSON.stringify({ ...job, cursor: page.cursor }));
  return { sent, gone, more: true };
}
// 남은 보내기 작업이 있으면 한 덩어리 처리 (오래된 작업은 버림)
async function pushNextJob(env) {
  const { keys } = await env.CAL.list({ prefix: 'pjob:', limit: 5 });
  for (const key of keys) {
    const job = await env.CAL.get(key.name, 'json');
    if (!job || Date.now() - job.at > PUSH_GAP) { await env.CAL.delete(key.name); continue; }
    const r = await pushSendChunk(env, key.name, job);
    return { ...r, more: r.more || keys.length > 1 };
  }
  return null;
}
// 새 번개: 그쪽 사람들에게 바로 알림 (첫 40명은 지금, 나머지는 예약 작업이 이어서)
async function notifyMeetup(env, b, m) {
  const when = m.date ? `${Number(m.date.slice(5, 7))}월 ${Number(m.date.slice(8, 10))}일${m.time ? ` ${m.time}` : ''}` : '';
  const at = Date.now();
  await env.CAL.put(`push:latest:bg:${b}`, JSON.stringify({ title: '새 번개가 열렸어요', body: [m.title, when, m.place].filter(Boolean).join(' · '), url: `/#/meetup/${m.id}`, at }));
  const jobKey = `pjob:bg:${m.id}`;
  return pushSendChunk(env, jobKey, { cursor: '', at, board: b, skip: m.by?.userid });
}
async function pushRun(env) {
  const pending = await pushNextJob(env);
  if (pending) return { status: 'ok', result: pending };
  const now = Date.now();
  const last = Number(await env.CAL.get('push:lastRun')) || 0;
  if (now - last < PUSH_GAP - 60e3) return { status: 'ok', result: { skip: true, nextInMin: Math.ceil((last + PUSH_GAP - now) / 60e3) } };
  await env.CAL.put('push:lastRun', String(now));
  const reader = await env.CAL.get('push:reader');
  const found = [];
  for (const b of PUSH_BOARDS) {
    if (b.member && !reader) continue;
    const rows = await latestRows(env, b, b.member ? reader : '');
    if (!rows) continue; // 못 읽으면 기준을 건드리지 않음
    for (const x of await newSince(env, b.key, rows)) {
      found.push(b.kind === 'post'
        ? { kind: 'post', dept: deptOfTitle(x.subject), url: `/#/post/${x.postUid}` }
        : { kind: 'album', name: b.name, title: String(x.subject).trim(), url: `/#/album/${x.postUid}` });
    }
  }
  if (!found.length) return { status: 'ok', result: { found: 0, reader: !!reader } };
  await env.CAL.put('push:latest', JSON.stringify({ ...pushMessage(found), at: now }));
  return { status: 'ok', result: { found: found.length, ...(await pushSendChunk(env, `pjob:news:${now}`, { cursor: '', at: now })) } };
}
async function push(env, api, p, raw) {
  if (!env.CAL) return { status: 'error', result: '알림 저장소(KV)가 연결되지 않았어요' };
  if (api === 'push_key') return { status: 'ok', result: (await vapidKeys(env)).pub };
  if (api === 'push_latest') {
    // 알림 문구: 새 글 소식과, 이 기기 주인 쪽(형제/자매) 번개 소식 중 더 최근 것
    const news = await env.CAL.get('push:latest', 'json');
    const endpoint = String(raw.endpoint || '');
    let bg = null;
    if (/^https:\/\//.test(endpoint)) {
      const got = await env.CAL.getWithMetadata(`psub:${await subId(endpoint)}`);
      const board = got?.metadata?.board;
      if (board) bg = await env.CAL.get(`push:latest:bg:${board}`, 'json');
    }
    return { status: 'ok', result: (bg && (!news || bg.at > news.at)) ? bg : news };
  }
  if (api === 'push_run') return pushRun(env);
  // 알림 켜기 실패 기록 (로그인한 회원만 남길 수 있고, 최고 관리자만 볼 수 있음. 최근 50개만, 30일 뒤 자동 삭제)
  if (api === 'push_diag' || api === 'push_diag_list') {
    if (!p.hash) return { status: 'error', result: 'hash가 필요합니다' };
    const who = await whoAmI(env, p.hash);
    if (who.error) return who.error;
    if (api === 'push_diag') {
      const rec = { at: new Date().toISOString(), user: who.u.userid, step: String(raw.step || '').slice(0, 20), detail: String(raw.detail || '').slice(0, 120), ua: String(raw.ua || '').slice(0, 200), standalone: raw.standalone === '1' };
      await env.CAL.put(`pdiag:${Date.now()}`, JSON.stringify(rec), { expirationTtl: 30 * 86400 });
      return { status: 'ok' };
    }
    if (!who.superAdmin) return { status: 'error', result: '관리자만 볼 수 있어요' };
    const { keys } = await env.CAL.list({ prefix: 'pdiag:' });
    const recent = keys.slice(-50);
    return { status: 'ok', result: await Promise.all(recent.map((k) => env.CAL.get(k.name, 'json'))) };
  }
  if (api === 'push_sub' || api === 'push_unsub') {
    if (!p.hash) return { status: 'error', result: 'hash가 필요합니다' };
    const who = await whoAmI(env, p.hash);
    if (who.error) return who.error;
    const endpoint = String(raw.sub?.endpoint || '');
    if (!/^https:\/\/[^\s]+$/.test(endpoint) || endpoint.length > 800) return { status: 'error', result: '알림 주소가 올바르지 않아요' };
    const name = `psub:${await subId(endpoint)}`;
    if (api === 'push_unsub') { await env.CAL.delete(name); return { status: 'ok' }; }
    // 번개 알림을 같은 쪽에만 보내려고 형제(m)/자매(f)도 함께 저장
    await env.CAL.put(name, JSON.stringify({ userid: who.u.userid, at: Date.now() }), { metadata: { endpoint, userid: who.u.userid, board: boardOf(who.u) } });
    return { status: 'ok' };
  }
  return { status: 'error', result: `허용되지 않은 API: ${api}` };
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
  // 번개: 로그인 필요, 형제/자매 게시판은 서버에서 회원정보 성별로 정함
  if (/^push_/.test(api)) return json(await push(env, api, clean, params || {}));
  if (/^avatar_/.test(api)) return json(await avatars(env, api, clean, params || {}));
  if (/^tpl_/.test(api)) return json(await templates(env, api, clean, params || {}));
  if (/^r[df]_/.test(api)) return json(await reading(env, api, clean, params || {}));
  if (/^bg_/.test(api)) {
    if (!clean.hash) return json({ status: 'error', result: 'hash가 필요합니다' });
    return json(await meetup(env, api, clean, params || {}));
  }
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
    // 새 교제록 알림용: 최고 관리자의 로그인 정보로 회원 전용 게시판을 확인 (KV에만, 바뀌었을 때만 저장)
    if (who.superAdmin && env.CAL && (await env.CAL.get('push:reader')) !== clean.hash) await env.CAL.put('push:reader', clean.hash);
    // 깨사모 사진 주소 기억 (다른 회원 화면에도 보이게), 앱에서 바꾼 사진이 있으면 그걸 먼저
    let pic = who.u.pic || '';
    if (env.CAL) {
      if (pic && (await env.CAL.get(`pic:${who.u.userid}`)) !== pic) await env.CAL.put(`pic:${who.u.userid}`, pic);
      const mine = await env.CAL.get(`avatar:${who.u.userid}`);
      if (mine) pic = mine;
    }
    return json({ status: 'ok', result: { ...who.u, pic, kaesamoPic: who.u.pic || '', hasCustomPic: pic !== (who.u.pic || ''), deptAdminOf: who.adminOf, depts: who.viewDepts } });
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
