/* 일산교회 청년회 — 화면 동작
 * 구성: 교제록(목록·글·댓글) / 기도제목 / 쓰기 / 참석 흐름(관리자) / 내 정보
 * 청년회교제실(boardId 2122)은 회원 전용이라 깨사모 로그인(hash)이 있어야 실제 글이 옵니다.
 * 로그인 화면을 거쳐야 들어갈 수 있고, 불러오기에 실패하면 알림을 보여줍니다.
 */
(() => {
  'use strict';
  const C = window.APP_CONFIG;
  const $app = document.getElementById('app');
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

  /* ─── 도우미 ─────────────────────────────── */
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem('ya:' + k); return v == null ? d : JSON.parse(v); } catch { return d; }
    },
    set(k, v) { try { localStorage.setItem('ya:' + k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
    del(k) { try { localStorage.removeItem('ya:' + k); } catch { /* */ } },
  };
  const parseDate = (s) => {
    if (!s) return null;
    if (/^\d{10}$/.test(String(s))) return new Date(Number(s) * 1000);
    const m = String(s).match(/(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const ymd = (d) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '');
  const dotDate = (d) => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
  const korDate = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
  const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const monthLabel = (k) => { const [y, m] = k.split('-'); return `${y}년 ${Number(m)}월`; };
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const highlight = (text, q) => {
    const safe = esc(text);
    if (!q) return safe;
    return safe.replace(new RegExp(reEsc(esc(q)), 'gi'), (m) => `<mark>${m}</mark>`);
  };

  /* ─── 로그인 상태 (hash는 이 기기에만 저장, 비밀번호는 저장하지 않음) ─── */
  const auth = {
    get hash() { return store.get('hash', ''); },
    get me() { return store.get('me', null); },
    set(hash, me) { store.set('hash', hash); store.set('me', me); },
    clear() { store.del('hash'); store.del('me'); },
  };
  const NO_HASH_APIS = ['login', 'board_comment', 'schedule'];
  const isHashError = (r) => r && r.status !== 'ok' && /hash/i.test(String(r.result || ''));

  /* ─── API 중계 호출 ──────────────────────── */
  async function send(body, headers) {
    try {
      const res = await fetch('/api/jbch', { method: 'POST', headers, body });
      const text = await res.text();
      try { return JSON.parse(text); } catch { return { status: 'error', result: `중계 서버 응답 오류 (HTTP ${res.status})` }; }
    } catch {
      return { status: 'error', result: '인터넷 연결을 확인해 주세요' };
    }
  }
  async function callApi(api, params = {}) {
    const p = { ...params };
    if (!NO_HASH_APIS.includes(api) && !p.hash && auth.hash) p.hash = auth.hash;
    const r = await send(JSON.stringify({ api, params: p }), { 'Content-Type': 'application/json' });
    if (p.hash && isHashError(r) && auth.hash) {
      signOut();
      toast('로그인이 만료됐어요. 다시 로그인해 주세요');
      route();
    }
    return r;
  }
  async function uploadPhoto(blob, name) {
    const fd = new FormData();
    fd.append('hash', auth.hash);
    fd.append('boardId', String(C.board.boardId));
    fd.append('chId', String(C.board.chId));
    fd.append('file', blob, name);
    return send(fd);
  }

  /* ─── 게시글 정리 ────────────────────────────
   * load_boardb_post.php 응답: { status, result: [ {postUid, subject, content, username, created, files, ...} ] }
   *  · 목록에서는 content 가 비어 오고, uid=postUid 로 다시 부르면 본문이 옵니다.
   *  · 목록 행의 uid 는 게시판 번호(2122)이니 글 번호는 postUid 를 써야 합니다.
   */
  const pick = (o, keys) => {
    for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k];
    return '';
  };
  function rowsOf(r) {
    const x = Array.isArray(r) ? r : (r.result ?? r.list ?? r.data);
    let rows = [];
    if (Array.isArray(x)) rows = x;
    else if (x && typeof x === 'object') {
      rows = [x];
      for (const k of ['list', 'rows', 'posts', 'data', 'items']) if (Array.isArray(x[k])) { rows = x[k]; break; }
    }
    // swCount 요약 행(last_created/total만 있는 행)은 빼기
    return rows.filter((o) => o && typeof o === 'object' && (o.postUid || o.subject || o.title || o.id));
  }
  // 이름 뒤에 붙인 형제/자매 표시(b, s) 떼기: 김민수b → 김민수
  const cleanName = (s) => String(s || '').trim().replace(/^([가-힣]{2,5})\s*[bsBS]$/, '$1').replace(/\s*\((형제|자매)\)$/, '');
  const NOT_NAMES = new Set(['형제', '자매', '참석', '참석자', '총', '명', '인원', '불참', '새가족']);
  function namesFrom(lines) {
    return [...new Set(lines.join(',')
      .split(/[,，、·/\s]+/)
      .map((s) => cleanName(s.replace(/^[-·•*]+/, '')))
      .filter((s) => /^[가-힣]{2,5}$/.test(s) && !NOT_NAMES.has(s)))];
  }
  // 기도제목 한 줄: "- 김가람: 내용" 또는 "심윤서s - 백영주 (대학동기) : 내용"
  // 세 가지 양식을 모두 읽음
  //  · 앱/한 줄:   "- 김가람: 내용"  "심윤서s - 백영주 (대학동기) : 내용"   (순종부 등)
  //  · 이름 머리줄: "▷최준식b" 다음 줄들에 "- 최승만 (큰 아버지) : 내용"       (사랑부 등)
  function prayersFrom(lines) {
    const out = [];
    let who = '';
    for (const raw of lines) {
      const l = raw.trim();
      if (!l) continue;
      const head = l.match(/^[▷▶►▸]\s*([가-힣]{2,5})\s*[bsBS]?\s*[:：]?\s*$/) || l.match(/^([가-힣]{2,5})[bsBS]\s*[:：]?\s*$/);
      if (head) { who = cleanName(head[1]); continue; }
      if (who && /^[-–·•*]/.test(l)) { out.push({ name: who, text: l.replace(/^[-–·•*]\s*/, '').trim() }); continue; }
      const m = l.match(/^[-·•*▷▶]?\s*([가-힣]{2,5}[bsBS]?)\s*[:：\-–]\s*(.+)$/);
      if (m) { who = ''; out.push({ name: cleanName(m[1]), text: m[2].trim() }); continue; }
      if (out.length && !/^[-–·•*]/.test(l)) out[out.length - 1].text += ' ' + l;
      else out.push({ name: who, text: l.replace(/^[-–·•*]\s*/, '') });
    }
    return out;
  }
  const deptOf = (title) => {
    const m = String(title).match(/^\s*\[\s*(?:\d{4}\s*)?([^\]]+?)\s*\]/);
    return m ? m[1] : C.groupName;
  };
  function htmlToText(html) {
    const prepared = String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n');
    const doc = new DOMParser().parseFromString(prepared, 'text/html');
    return (doc.body.textContent || '').replace(/[​-‍﻿]/g, '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  const SECTION_KEYS = [
    ['참석', 'people'], ['말씀', 'verse'], ['나눔', 'share'], ['기도', 'prayer'],
    ['기타', 'etc'], ['번개', 'etc'], ['광고', 'etc'], ['작성', 'writer'], ['날짜', 'date'],
  ];
  // 소제목 줄 읽기: 앱 양식 "■ 참석자 (5명): …" 과 게시판에서 쓰던 "[ 참석 B S ]", "[ 기도부탁 ]" 둘 다
  function parseSections(text) {
    const out = {};
    let cur = null;
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*[■▶●◆]\s*([^:：(（]+)(?:[(（][^)）]*[)）])?\s*[:：]?\s*(.*)$/) ||
        line.match(/^\s*\[\s*([^\]]{1,20}?)\s*\]\s*(.*)$/);
      if (m) {
        const hit = SECTION_KEYS.find(([w]) => m[1].includes(w));
        cur = hit ? hit[1] : m[1].trim();
        out[cur] = m[2] ? [m[2].trim()] : [];
      } else if (cur && line.trim()) {
        out[cur].push(line.trim());
      }
    }
    return out;
  }
  const IMG_EXT = /^(jpe?g|png|gif|webp|heic)$/i;
  function normPost(o) {
    const body = String(pick(o, ['content', 'contents', 'body']));
    const text = htmlToText(body);
    const sec = parseSections(text);
    const title = String(pick(o, ['subject', 'title']));
    // 모임 날짜: 본문 "■ 날짜" → 제목 속 날짜(2026.10.24) → 글 쓴 날
    const date = parseDate(sec.date?.[0]) || parseDate(title) || parseDate(pick(o, ['created', 'date', 'opened']));
    const files = Array.isArray(o.files) ? o.files : [];
    const photos = [
      ...files.filter((f) => f && IMG_EXT.test(f.extention || f.ext || String(f.filepath || '').split('.').pop()))
        .map((f) => String(f.filepath || '')),
      ...(Array.isArray(o.imgs) ? o.imgs.map((x) => String(typeof x === 'string' ? x : x?.url || x?.src || '')) : []),
    ].filter((u) => /^https:\/\//.test(u));
    return {
      id: String(pick(o, ['postUid', 'id', 'uid'])),
      title: title || (date ? `교제록 · ${korDate(date)}` : '교제록'),
      dept: deptOf(title),
      author: String(sec.writer?.[0] || pick(o, ['username', 'author', 'name'])),
      date,
      body,
      text,
      sec,
      hasBody: !!body.trim(),
      people: namesFrom(sec.people || []),
      verse: sec.verse?.[0] || '',
      verseNote: (sec.verse || []).slice(1).join('\n'),
      share: (sec.share || []).join('\n'),
      etc: (sec.etc || []).join('\n'),
      prayers: prayersFrom(sec.prayer || []),
      photos: [...new Set(photos)],
      comments: Number(o.total_comment) || 0,
      likes: Number(o.total_good) || 0,
      hits: Number(o.hit) || 0,
      createdAt: (() => { const t = Date.parse(String(o.created || '').replace(' ', 'T')); return Number.isFinite(t) ? t : 0; })(),
      // 앱 양식(■)으로 쓴 글만 칸별로 다시 그리고, 나머지는 원문을 그대로 보여줌
      structured: /■/.test(text) && Object.keys(sec).length >= 2,
    };
  }

  /* ─── 게시글 불러오기 ────────────────────── */
  const state = {
    posts: null, source: '', error: '', loading: null, page: 0, hasMore: false,
    q: '', month: '', dept: '', day: '', prayerMode: 'week',
  };
  const sortPosts = () => state.posts.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));

  // 목록 한 페이지 (제목·날짜·작성자만 옴)
  async function fetchPage(page) {
    const B = C.board;
    const r = await callApi('board_post', { ...B.listParams, [B.pageParam]: page, [B.limitParam]: B.pageSize });
    if (r.status !== 'ok') return { error: r.status === 'not' ? (auth.hash ? '게시글이 없습니다' : '로그인이 필요해요') : String(r.result || '알 수 없는 오류') };
    return { rows: rowsOf(r).map(normPost).filter((p) => p.id) };
  }

  function loadPosts(force) {
    if (state.posts && !force) return Promise.resolve(state.posts);
    if (state.loading && !force) return state.loading;
    const job = (async () => {
      const { rows, error } = auth.hash ? await fetchPage(1) : { error: '로그인이 필요해요' };
      if (rows) {
        state.source = 'api'; state.error = '';
        state.posts = rows;
        state.page = 1;
        state.hasMore = rows.length >= C.board.pageSize;
      } else {
        // 불러오기 실패: 빈 목록 + 알림 (예시 데이터는 쓰지 않음)
        state.source = 'error'; state.error = error || '알 수 없는 오류';
        state.posts = [];
        state.hasMore = false;
      }
      sortPosts();
      return state.posts;
    })();
    state.loading = job;
    job.finally(() => { if (state.loading === job) state.loading = null; });
    return job;
  }

  async function loadMore() {
    if (state.source !== 'api' || !state.hasMore) return 0;
    const { rows, error } = await fetchPage(state.page + 1);
    if (error) { toast(error); return 0; }
    const seen = new Set(state.posts.map((p) => p.id));
    const fresh = rows.filter((p) => !seen.has(p.id));
    state.page += 1;
    state.hasMore = rows.length >= C.board.pageSize && fresh.length > 0;
    state.posts.push(...fresh);
    sortPosts();
    return fresh.length;
  }

  // 글 하나의 본문 받기 (같은 글을 두 번 부르지 않도록 묶어 둠)
  function fetchBody(p) {
    if (p.hasBody || state.source !== 'api') return Promise.resolve(p);
    if (!p._loading) {
      const B = C.board;
      p._loading = callApi('board_post', { ...B.listParams, [B.detailParam]: p.id }).then((r) => {
        const row = r.status === 'ok' ? rowsOf(r).find((x) => String(x.postUid || x.uid) === p.id) || rowsOf(r)[0] : null;
        if (row) Object.assign(p, normPost(row), { id: p.id, comments: p.comments || Number(row.total_comment) || 0 });
        p._loading = null;
        return p;
      });
    }
    return p._loading;
  }

  // 최근 글들의 본문을 4개씩 나눠 받기 (기도제목·참석 흐름용)
  async function fillBodies(onProgress) {
    const todo = state.posts.slice(0, C.board.bodiesToLoad).filter((p) => !p.hasBody);
    let done = 0;
    const queue = [...todo];
    const worker = async () => {
      while (queue.length) {
        await fetchBody(queue.shift());
        done += 1;
        onProgress?.(done, todo.length);
      }
    };
    await Promise.all([1, 2, 3, 4].map(worker));
    return state.posts;
  }

  async function loadDetail(id) {
    const posts = await loadPosts();
    let p = posts.find((x) => x.id === id);
    if (!p && state.source === 'api' && /^\d+$/.test(id)) {
      // 목록에 아직 없는 글 (방금 올린 글, 오래된 글)
      p = await fetchBody({ id, hasBody: false });
      if (!p.hasBody) return null;
    } else if (p) await fetchBody(p);
    return p;
  }

  // 교회 사이트 글 HTML을 안전하게 보여주기
  function sanitize(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    doc.querySelectorAll('script,style,iframe,object,embed,form,link,meta').forEach((n) => n.remove());
    doc.querySelectorAll('*').forEach((n) => {
      for (const a of [...n.attributes]) {
        const name = a.name.toLowerCase();
        if (name.startsWith('on') || name === 'style' || name === 'class') n.removeAttribute(a.name);
        else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
      }
      if (n.tagName === 'A') { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener'); }
    });
    return doc.body.innerHTML;
  }


  /* ════════════════════════════════════════════════════════════
   * 화면 (UI)
   * ════════════════════════════════════════════════════════════ */
  const APP = C.appName || '일산교회 청년회';
  // 화면 밝기 (기본: 밝게)
  const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    let t = store.get('theme', 'light');
    if (t === 'system') t = darkMQ.matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    document.getElementById('themeColor')?.setAttribute('content', t === 'dark' ? '#0a1328' : '#f3f3f3');
  }
  darkMQ.addEventListener?.('change', applyTheme);
  applyTheme();
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isWide = () => window.matchMedia('(min-width: 1180px)').matches;

  /* ─── 아이콘 (선 아이콘, 24 격자) ─── */
  const ICONS = {
    book: '<path d="M3 5.5h5.5A3.5 3.5 0 0 1 12 9v10.5a3 3 0 0 0-3-3H3z"/><path d="M21 5.5h-5.5A3.5 3.5 0 0 0 12 9v10.5a3 3 0 0 1 3-3h6z"/>',
    heart: '<path d="M12 20s-7.2-4.4-9.1-9A4.7 4.7 0 0 1 12 7.3 4.7 4.7 0 0 1 21.1 11c-1.9 4.6-9.1 9-9.1 9z"/>',
    pen: '<path d="M4 20h4L19.2 8.8a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    chart: '<path d="M4 20V11"/><path d="M10 20V5"/><path d="M16 20v-6"/><path d="M21 20H3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18.2 14.2A6.5 6.5 0 0 1 21.5 20"/>',
    msg: '<path d="M20.5 12a8.5 8.5 0 0 1-12.3 7.6L3.5 21l1.4-4.6A8.5 8.5 0 1 1 20.5 12z"/>',
    image: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><circle cx="8.8" cy="10" r="1.8"/><path d="m21 15.5-4.8-4.8L7 19.5"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 10.5 13.5"/><path d="M18.5 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2h4"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="m10 16.5-4.5-4.5L10 7.5"/><path d="M5.5 12H16"/>',
    refresh: '<path d="M20 11.5A8 8 0 1 0 17.7 17"/><path d="M20 4.5v7h-7"/>',
    alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.8v5"/><path d="M12 16.2v.1"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    trash: '<path d="M4.5 7h15"/><path d="M10 11v5.5M14 11v5.5"/><path d="m6.5 7 .9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7"/><path d="M9.5 7V4.5h5V7"/>',
    send: '<path d="M20.5 3.5 10 14"/><path d="m20.5 3.5-6.5 17-4-6.5-6.5-4z"/>',
    download: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4.5 20h15"/>',
    quote: '<path d="M10 7H6.5A2.5 2.5 0 0 0 4 9.5V12h5v5H4"/><path d="M20 7h-3.5A2.5 2.5 0 0 0 14 9.5V12h5v5h-5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    zap: '<path d="M13.5 2.5 4.5 13.5h7l-1 8 9-11h-7z"/>',
    wifi: '<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.5a9.5 9.5 0 0 1 13 0"/><path d="M9 16a4.5 4.5 0 0 1 6 0"/><path d="M12 19.5v.1"/><path d="M3 3l18 18"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    thumb: '<path d="M7 10.5V20"/><path d="M7 10.5 11 3a2.6 2.6 0 0 1 2.9 3.3L13 9.5h5.2a2 2 0 0 1 2 2.4l-1.4 6.6a2 2 0 0 1-2 1.5H4.5a1.5 1.5 0 0 1-1.5-1.5V12a1.5 1.5 0 0 1 1.5-1.5z"/>',
  };
  const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const spinner = '<span class="spin" aria-hidden="true"></span>';

  /* ─── 작은 도우미 ─── */
  const hashOf = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
  const tone = (s) => ['blue', 'sky', 'sun', 'green', 'rose'][hashOf(s) % 5];
  function avatar(name, url, size = 'md') {
    const n = String(name || '').trim();
    const initial = esc(n ? (/^[가-힣]/.test(n) ? n[0] : n[0].toUpperCase()) : '·');
    const img = /^https:\/\//.test(url || '')
      ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.remove()">` : '';
    return `<span class="av av--${size} t-${tone(n)}" aria-hidden="true">${initial}${img}</span>`;
  }
  const tag = (dept) => (dept ? `<span class="tag t-${tone(dept)}">${esc(dept)}</span>` : '');
  function rel(d) {
    if (!d) return '';
    const t = d instanceof Date ? d.getTime() : d;
    const diff = Date.now() - t;
    const day = new Date(t);
    if (diff < 60e3) return '방금';
    if (diff < 3600e3) return `${Math.floor(diff / 60e3)}분 전`;
    if (diff < 86400e3) return `${Math.floor(diff / 3600e3)}시간 전`;
    if (diff < 2 * 86400e3) return '어제';
    if (diff < 7 * 86400e3) return `${Math.floor(diff / 86400e3)}일 전`;
    return day.getFullYear() === new Date().getFullYear() ? `${day.getMonth() + 1}월 ${day.getDate()}일` : dotDate(day);
  }
  const fullDate = (d) => (d ? `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})` : '');
  const errText = (r) => (typeof r?.result === 'string' && r.result ? r.result : '알 수 없는 오류');

  // 지난번 방문 시각 — 그 뒤에 올라온 글에 "새 글" 표시
  const prevSeen = store.get('seenAt', 0);
  store.set('seenAt', Date.now());
  const isNew = (p) => prevSeen && p.createdAt > prevSeen;

  /* ─── 알림: 토스트 / 스낵바 (되돌리기 버튼) ─── */
  let toastTimer;
  function toast(msg, opt = {}) {
    const t = document.getElementById('toast');
    t.innerHTML = `<span>${esc(msg)}</span>${opt.action ? `<button type="button">${esc(opt.action.label)}</button>` : ''}`;
    t.className = 'toast show' + (opt.tone === 'error' ? ' is-error' : '');
    if (opt.action) t.querySelector('button').onclick = () => { t.classList.remove('show'); opt.action.onClick(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), opt.action ? 5000 : 2400);
  }

  /* ─── 모달 / 바텀시트 (휴대폰에선 아래에서 올라오고, 컴퓨터에선 가운데) ─── */
  function openSheet({ title = '', body = '', actions = [], dismissable = true } = {}) {
    const layer = document.getElementById('layer');
    const el = document.createElement('div');
    el.className = 'sheet-wrap';
    el.innerHTML = `
      <div class="sheet-backdrop"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet__grip" aria-hidden="true"></div>
        ${title ? `<h2 class="sheet__title">${esc(title)}</h2>` : ''}
        <div class="sheet__body">${body}</div>
        ${actions.length ? `<div class="sheet__actions">${actions.map((a, i) => `<button type="button" class="btn ${a.kind === 'primary' ? 'btn--primary' : a.kind === 'danger' ? 'btn--danger' : ''}" data-i="${i}">${a.icon ? icon(a.icon) : ''}${esc(a.label)}</button>`).join('')}</div>` : ''}
      </div>`;
    layer.appendChild(el);
    const prevFocus = document.activeElement;
    let resolve;
    const result = new Promise((r) => { resolve = r; });
    const close = (v = null) => {
      if (!el.isConnected) return;
      el.classList.remove('open');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => el.remove(), reduceMotion() ? 0 : 200);
      prevFocus?.focus?.();
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(null); };
    document.addEventListener('keydown', onKey);
    if (dismissable) el.querySelector('.sheet-backdrop').onclick = () => close(null);
    el.querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => close(actions[Number(b.dataset.i)].value); });
    requestAnimationFrame(() => {
      el.classList.add('open');
      (el.querySelector('.btn--primary, .btn--danger, [data-i]') || el.querySelector('.sheet'))?.focus?.();
    });
    return { el, result, close };
  }
  const confirmSheet = (title, body, okLabel, kind = 'primary') =>
    openSheet({ title, body: `<p class="sheet__text">${body}</p>`, actions: [{ label: '취소', value: false }, { label: okLabel, value: true, kind }] }).result;

  /* ─── 사진 크게 보기 ─── */
  function lightbox(list, start = 0) {
    let i = start;
    const layer = document.getElementById('layer');
    const el = document.createElement('div');
    el.className = 'lb';
    el.innerHTML = `
      <button class="lb__close" type="button" aria-label="닫기">${icon('x')}</button>
      <div class="lb__count"></div>
      ${list.length > 1 ? `<button class="lb__nav lb__prev" type="button" aria-label="이전 사진">${icon('left')}</button><button class="lb__nav lb__next" type="button" aria-label="다음 사진">${icon('right')}</button>` : ''}
      <img class="lb__img" alt="">`;
    layer.appendChild(el);
    const $img = el.querySelector('.lb__img');
    const show = () => {
      // 작은 그림을 먼저 보여 주고, 원본이 다 내려오면 바꿔치기 (느린 데이터에서도 바로 보이게)
      const full = list[i], small = thumbUrl(full);
      $img.classList.remove('loaded');
      $img.onload = () => $img.classList.add('loaded');
      $img.onerror = () => { if ($img.src !== full) $img.src = full; };
      $img.src = small;
      if (small !== full) { const big = new Image(); big.onload = () => { if (list[i] === full) $img.src = full; }; big.src = full; }
      el.querySelector('.lb__count').textContent = list.length > 1 ? `${i + 1} / ${list.length}` : '';
    };
    const go = (d) => { i = (i + d + list.length) % list.length; show(); };
    const close = () => { document.removeEventListener('keydown', onKey); el.classList.remove('open'); setTimeout(() => el.remove(), 180); };
    const onKey = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); };
    document.addEventListener('keydown', onKey);
    el.querySelector('.lb__close').onclick = close;
    el.onclick = (e) => { if (e.target === el) close(); };
    el.querySelector('.lb__prev')?.addEventListener('click', () => go(-1));
    el.querySelector('.lb__next')?.addEventListener('click', () => go(1));
    let x0 = null;
    el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50 && list.length > 1) go(dx < 0 ? 1 : -1);
      x0 = null;
    });
    show();
    requestAnimationFrame(() => el.classList.add('open'));
  }
  // 교회 서버(file*.jbch.org)는 올린 사진마다 600px짜리 작은 그림(sum_파일이름)을 만들어 둠.
  // 원본은 4000~5700px·수 MB라 느린 데이터에선 안 보일 수 있어서, 목록·카드엔 작은 그림을 쓰고 원본은 크게 볼 때만
  const thumbUrl = (u) => (/^https:\/\/file\d*\.jbch\.org\//.test(String(u)) && !/\/sum_[^/]+$/.test(u) ? String(u).replace(/\/([^/]+)$/, '/sum_$1') : String(u || ''));
  // 글 안에서는 선명하게: 작은 그림으로 먼저 보여 주고, 원본이 다 내려오면 바꿔 끼움 (위에서부터 한 장씩)
  async function sharpen(root) {
    if (!root) return;
    for (const img of root.querySelectorAll('img[data-full]')) {
      const full = img.dataset.full;
      const got = await new Promise((ok) => { const big = new Image(); big.onload = () => ok(true); big.onerror = () => ok(false); big.src = full; });
      if (got && img.isConnected) { img.src = full; img.removeAttribute('data-full'); }
      if (!root.isConnected) return;
    }
  }
  // 사진이 다 내려오면 흐릿한 상태에서 또렷하게 / 작은 그림이 없으면 원본으로, 그것도 안 되면 빈칸 대신 바탕만
  const imgTag = (src, alt = '') => {
    const t = thumbUrl(src);
    return `<img src="${esc(t)}"${t !== src ? ` data-full="${esc(src)}"` : ''} alt="${esc(alt)}" loading="lazy" decoding="async" onload="this.classList.add('loaded')" onerror="if(this.dataset.full&&this.src!==this.dataset.full){this.src=this.dataset.full}else{this.classList.add('loaded','is-broken')}">`;
  };

  /* ─── 공통 조각 ─── */
  const pageHead = (title, sub = '', right = '') =>
    `<header class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${right}</header>`;
  const skeletonCards = (n = 4) => `<div class="feed" aria-busy="true">${Array.from({ length: n }, () => `
    <div class="card sk-card"><div class="sk-row"><span class="sk sk-av"></span><span class="sk sk-line" style="width:32%"></span></div>
    <span class="sk sk-line" style="width:72%;height:18px"></span><span class="sk sk-line"></span><span class="sk sk-line" style="width:56%"></span></div>`).join('')}</div>`;
  function emptyState({ ic = 'search', title, desc = '', action = '' }) {
    return `<div class="empty"><span class="empty__ic">${icon(ic)}</span><b>${title}</b>${desc ? `<p>${desc}</p>` : ''}${action}</div>`;
  }
  const errorState = () => emptyState({
    ic: 'alert', title: '교제록을 불러오지 못했어요', desc: esc(state.error),
    action: `<button class="btn btn--sm" type="button" data-retry>${icon('refresh')}다시 불러오기</button>`,
  });
  const progressBar = (id, label) => `<div class="prog" id="${id}"><div class="prog__label">${esc(label)}</div><div class="prog__bar"><i style="width:0%"></i></div></div>`;
  function setProg(id, done, total, label) {
    const el = document.getElementById(id);
    if (!el) return;
    el.querySelector('i').style.width = `${total ? Math.round((done / total) * 100) : 100}%`;
    el.querySelector('.prog__label').textContent = label;
  }
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-retry]')) { await loadPosts(true); route(); }
  });

  // 부서 칩 (순종부·사랑부 …) — 글 제목의 [2026 순종부] 에서 읽음
  function deptChips(posts, onChange) {
    const depts = [...new Set(posts.map((p) => p.dept))];
    if (depts.length < 2) return { html: '', bind() {} };
    const draw = () => [['', '전체'], ...depts.map((d) => [d, d])]
      .map(([k, l]) => `<button type="button" class="chip" data-d="${esc(k)}" aria-pressed="${state.dept === k}">${esc(l)}</button>`).join('');
    return {
      html: `<div class="chips" id="depts" role="group" aria-label="부서">${draw()}</div>`,
      bind() {
        const el = document.getElementById('depts');
        if (!el) return;
        el.onclick = (e) => {
          const b = e.target.closest('[data-d]');
          if (!b) return;
          state.dept = b.dataset.d;
          el.innerHTML = draw();
          onChange();
        };
      },
    };
  }
  const inDept = (p) => !state.dept || p.dept === state.dept;
  function searchBox(id, placeholder, value = '') {
    return `<label class="search">${icon('search')}<input id="${id}" type="search" placeholder="${placeholder}" value="${esc(value)}" autocomplete="off" enterkeyhint="search"><button type="button" class="search__clear" aria-label="검색어 지우기" ${value ? '' : 'hidden'}>${icon('x')}</button></label>`;
  }
  function bindSearch(id, onInput) {
    const $i = document.getElementById(id);
    const $c = $i.parentElement.querySelector('.search__clear');
    $i.addEventListener('input', () => { $c.hidden = !$i.value; onInput($i.value.trim()); });
    $c.onclick = () => { $i.value = ''; $c.hidden = true; onInput(''); $i.focus(); };
    return $i;
  }

  /* ─── 화면: 홈 (교제록) ─── */
  let listRedraw = null; // 위쪽 검색창·달력에서 목록을 다시 그릴 때
  const draftInfo = () => {
    const d = store.get('draft', null);
    if (!d) return null;
    const steps = [(d.people || []).length || (d.extra || '').trim(), d.verse || d.verseNote, d.share, Object.values(d.prayers || {}).some((v) => String(v).trim())];
    const done = steps.filter(Boolean).length;
    return done ? { done, total: 4 } : null;
  };
  function filterLabel() {
    const parts = [];
    if (state.dept) parts.push(state.dept);
    if (state.day) { const d = parseDate(state.day); parts.push(d ? `${d.getMonth() + 1}월 ${d.getDate()}일` : state.day); }
    return parts.join(' · ');
  }

  async function viewList({ restore = false } = {}) {
    const me = auth.me;
    const draft = draftInfo();
    $app.innerHTML = `
      <div class="stories" id="stories" aria-label="부서">${'<div class="story story--sk"><span class="sk"></span></div>'.repeat(4)}</div>
      <section class="card welcome">
        <h1 class="welcome__title">이번 주 교제</h1>
        <p class="welcome__sub" id="welcomeSub">이번 주 교제록을 불러오는 중이에요</p>
        <a class="composer" href="#/write">
          ${avatar(me?.name)}
          <span class="composer__ph">${draft ? '쓰다 만 교제록을 이어서 써 보세요' : '이번 주 교제는 어땠나요?'}</span>
        </a>
        <div class="composer__bar">
          <div class="composer__tools">
            <a href="#/write" data-tip="사진" aria-label="사진 넣기">${icon('image')}</a>
            <a href="#/write" data-tip="말씀" aria-label="말씀 적기">${icon('quote')}</a>
            <a href="#/write" data-tip="참석자" aria-label="참석자 고르기">${icon('users')}</a>
            <a href="#/write" data-tip="기도제목" aria-label="기도제목 적기">${icon('heart')}</a>
          </div>
          <div class="composer__actions">
            ${draft ? `<a class="btn btn--sm" href="#/write">${icon('pen')}이어 쓰기</a>` : ''}
            <a class="btn btn--primary btn--sm" href="#/write">${icon('send')}교제록 쓰기</a>
          </div>
        </div>
      </section>
      <section class="card upnext" id="upnext" hidden></section>
      <div class="feed-head">
        <h2 id="feedTitle">최근 교제록</h2>
        <button type="button" class="link-btn" id="clearFilter" hidden>전체 보기</button>
        <select class="select select--sm" id="month" aria-label="기간"></select>
      </div>
      <div class="m-only">${searchBox('q', '이름, 말씀, 나눔으로 찾기', state.q)}</div>
      <div id="list">${skeletonCards(3)}</div>
      <div class="more" id="more"></div>`;
    // 다가오는 일정 (월정표에서)
    upcoming(3).then((list) => {
      const el = document.getElementById('upnext');
      if (!el || !list || !list.length) return;
      el.hidden = false;
      el.innerHTML = `<div class="upnext__head"><h2>${icon('calendar')}다가오는 일정</h2><a class="link-btn" href="#/calendar">월정표 보기${icon('right')}</a></div>
        <div class="upnext__list">${list.map((e) => {
          const d = parseDate(e.start);
          return `<a class="upnext__item" href="#/calendar" data-day="${esc(e.start)}"><span class="datebox ev-${evTone(e)}"><b>${d.getDate()}</b><small>${WEEK[d.getDay()]}</small></span><span><b>${esc(e.title)}</b><small>${esc([evLabel(e), e.time, e.place].filter(Boolean).join(' · '))}</small></span></a>`;
        }).join('')}</div>`;
      el.querySelectorAll('[data-day]').forEach((a) => a.addEventListener('click', () => { state.calView = a.dataset.day.slice(0, 7); state.calDay = a.dataset.day; }));
    });
    const posts = await loadPosts();
    if (!document.getElementById('list')) return;
    if (state.source === 'error') {
      document.getElementById('stories').innerHTML = '';
      document.getElementById('welcomeSub').textContent = '교제록을 불러오지 못했어요';
      document.getElementById('list').innerHTML = errorState();
      return;
    }

    // 이번 주 소식 한 줄
    const weekAgo = Date.now() - 7 * 86400e3;
    const thisWeek = posts.filter((p) => p.createdAt > weekAgo).length;
    const fresh = posts.filter(isNew).length;
    document.getElementById('welcomeSub').innerHTML = thisWeek
      ? `이번 주에 교제록 <b>${thisWeek}개</b>가 올라왔어요${fresh ? ` · 새 글 <b>${fresh}개</b>` : ''}`
      : '이번 주엔 아직 올라온 교제록이 없어요';

    // 부서 카드 줄 (각 부서 최근 사진)
    const depts = [...new Set(posts.map((p) => p.dept))];
    const drawStories = () => {
      document.getElementById('stories').innerHTML = `
        <a class="story story--add" href="#/write"><span class="story__plus">${icon('plus')}</span><b>교제록 쓰기</b></a>
        ${depts.map((d) => {
          const mine = posts.filter((p) => p.dept === d);
          const cover = mine.find((p) => p.photos.length)?.photos[0];
          const n = mine.filter(isNew).length;
          return `<button type="button" class="story t-${tone(d)}" data-d="${esc(d)}" aria-pressed="${state.dept === d}">
            ${cover ? imgTag(cover) : '<span class="story__pattern"></span>'}
            <span class="story__shade"></span>
            ${n ? `<span class="story__badge">새 글 ${n}</span>` : ''}
            <span class="story__name"><b>${esc(d)}</b><small>교제록 ${mine.length}개</small></span>
          </button>`;
        }).join('')}`;
    };
    drawStories();
    document.getElementById('stories').addEventListener('click', (e) => {
      const b = e.target.closest('[data-d]');
      if (!b) return;
      state.dept = state.dept === b.dataset.d ? '' : b.dataset.d;
      drawStories(); drawList(); renderSideDepts();
    });

    const $month = document.getElementById('month');
    const drawMonths = () => {
      const months = [...new Set(posts.filter((p) => p.date).map((p) => monthKey(p.date)))];
      $month.innerHTML = [['', '전체 기간'], ...months.map((m) => [m, monthLabel(m)])]
        .map(([k, l]) => `<option value="${k}"${state.month === k ? ' selected' : ''}>${l}</option>`).join('');
    };
    drawMonths();
    $month.onchange = () => { state.month = $month.value; drawList(); };
    bindSearch('q', (v) => { state.q = v; syncSearchBoxes(); drawList(); });
    document.getElementById('clearFilter').onclick = () => {
      state.dept = ''; state.day = ''; state.month = ''; $month.value = '';
      drawStories(); drawList(); renderSideDepts(); renderPanel();
    };

    const $more = document.getElementById('more');
    const drawMore = () => {
      $more.innerHTML = state.hasMore ? `<button class="btn" type="button" id="moreBtn">이전 교제록 더 보기</button>` : '';
      const b = document.getElementById('moreBtn');
      if (b) b.onclick = async () => {
        b.disabled = true; b.innerHTML = `${spinner}불러오는 중`;
        const n = await loadMore();
        if (!document.getElementById('list')) return;
        if (n) toast(`${n}개를 더 불러왔어요`);
        drawMonths(); drawList(false); drawMore(); renderPanel();
      };
    };
    drawMore();
    fillBodies().then(() => { if (document.getElementById('list')) drawList(false); });

    function drawList(animate = true) {
      const q = state.q.toLowerCase();
      const byFilter = posts.filter((p) => inDept(p) &&
        (!state.month || (p.date && monthKey(p.date) === state.month)) &&
        (!state.day || (p.date && ymd(p.date) === state.day)));
      const rows = byFilter.filter((p) => !q || (p.title + '\n' + p.text + '\n' + p.author).toLowerCase().includes(q));
      const label = filterLabel();
      document.getElementById('feedTitle').textContent = q ? `'${state.q}' 찾은 교제록` : label ? `${label} 교제록` : '최근 교제록';
      document.getElementById('clearFilter').hidden = !(state.dept || state.day || state.month);
      const $list = document.getElementById('list');
      if (!rows.length) {
        $list.innerHTML = q
          ? emptyState({ title: `'${esc(state.q)}'에 맞는 교제록이 없어요`, desc: '다른 이름이나 낱말로 찾아보세요. 본문은 최근 교제록에서만 찾아요.', action: `<button class="btn btn--sm" type="button" id="clearQ">검색어 지우기</button>` })
          : posts.length
            ? emptyState({ ic: 'calendar', title: '이 조건에 맞는 교제록이 없어요', action: `<button class="btn btn--sm" type="button" id="resetF">필터 초기화</button>` })
            : emptyState({ ic: 'book', title: '아직 교제록이 없어요', desc: '첫 교제록을 남겨 주세요', action: `<a class="btn btn--primary btn--sm" href="#/write">${icon('pen')}교제록 쓰기</a>` });
        document.getElementById('clearQ')?.addEventListener('click', () => { state.q = ''; syncSearchBoxes(); drawList(); });
        document.getElementById('resetF')?.addEventListener('click', () => document.getElementById('clearFilter').click());
        return;
      }
      $list.innerHTML = `<div class="feed">${rows.map((p, i) => {
        const excerpt = q && !p.share.toLowerCase().includes(q) ? findSnippet(p.text, q) : summaryOf(p);
        const photo = p.photos.length > 0;
        const text = `
            <h3 class="post__title">${highlight(p.title, state.q)}</h3>
            ${p.verse ? `<p class="post__verse">${icon('quote')}${highlight(p.verse, state.q)}</p>` : ''}
            ${excerpt ? `<p class="post__excerpt">${highlight(excerpt, state.q)}</p>` : ''}`;
        // 사진이 있으면 사진이 먼저, 쓴 사람은 사진 위에 / 없으면 예전처럼 이름 줄부터
        return `
          <a class="post card${photo ? ' post--photo' : ''}${animate && !reduceMotion() ? ' rise' : ''}" style="--i:${Math.min(i, 8)}" href="#/post/${encodeURIComponent(p.id)}">
            ${photo ? `<div class="post__cover">${imgTag(p.photos[0])}
                <span class="post__chip">${avatar(p.author, '', 'xs')}<b>${esc(p.author || '작성자')}</b><small>${fullDate(p.date)}${p.dept ? ` · ${esc(p.dept)}` : ''}</small></span>
                ${isNew(p) ? '<span class="tag tag--new post__badge">새 글</span>' : ''}
                ${p.photos.length > 1 ? `<span class="post__more">${icon('image')}${p.photos.length}</span>` : ''}
              </div>
              <div class="post__body">${text}</div>`
            : `<div class="post__head">
                ${avatar(p.author)}
                <div class="post__who"><b>${esc(p.author || '작성자')}</b><span>${fullDate(p.date)}${p.dept ? ` · <em class="c-${tone(p.dept)}">${esc(p.dept)}</em>` : ''}</span></div>
                ${isNew(p) ? '<span class="tag tag--new">새 글</span>' : ''}
              </div>${text}`}
            <div class="post__foot">
              ${likeBtn(p.id, p.likes)}
              <span>${icon('msg')}댓글 ${p.comments || 0}</span>
              ${p.prayers.length ? `<span>${icon('heart')}기도제목 ${p.prayers.length}</span>` : ''}
              ${p.people.length ? `<span>${icon('users')}${p.people.length}명</span>` : ''}
              ${!p.hasBody ? '<span class="post__loading">본문 읽는 중</span>' : ''}
              <span class="post__go">자세히${icon('right')}</span>
            </div>
          </a>`;
      }).join('')}</div>`;
      checkLikes(rows.slice(0, 10).map((p) => p.id)); // 위쪽 글 몇 개만 내가 눌렀는지 확인
    }
    listRedraw = () => { if (document.getElementById('list')) drawList(false); };
    drawList(!restore);
    if (restore && state.listScroll) window.scrollTo(0, state.listScroll);
    maybeCoach();
  }
  function syncSearchBoxes() {
    ['q', 'gq'].forEach((id) => {
      const i = document.getElementById(id);
      if (i && i.value !== state.q) { i.value = state.q; const c = i.parentElement.querySelector('.search__clear'); if (c) c.hidden = !state.q; }
    });
  }

  // 목록에 보여줄 두 줄: 나눔 → 말씀 요약 → 소제목·이름 목록·날짜 줄을 뺀 본문
  function summaryOf(p) {
    if (p.share) return p.share;
    if (p.verseNote) return p.verseNote;
    // 게시판 양식 글은 첫 기도제목을 미리보기로 (예: "최준식 · 최승만 (큰 아버지): 11월 대집회…")
    const pr = p.prayers.find((x) => x.name && x.text);
    if (pr) { const s = splitPrayer(pr.text); return `${pr.name} · ${s.target ? `${s.target}: ` : ''}${s.body}`; }
    return p.text.split('\n').map((l) => l.trim()).filter((l) => l &&
      !/^[[■▶▷►●◆\-·•*]/.test(l) && !(l.length < 40 && parseDate(l)) && !/^\d+\.\s/.test(l))
      .join(' ').slice(0, 160);
  }
  function findSnippet(text, q) {
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return text.slice(0, 140);
    const s = Math.max(0, i - 30);
    return (s > 0 ? '…' : '') + text.slice(s, i + q.length + 80).replace(/\n/g, ' ');
  }

  /* ─── 화면: 글 하나 ─── */
  async function viewPost(id) {
    const back = `<a class="back" href="#/">${icon('left')}교제록</a>`;
    $app.innerHTML = `${back}<div class="card detail"><span class="sk sk-line" style="width:30%"></span><span class="sk sk-line" style="width:80%;height:24px"></span><span class="sk sk-line"></span><span class="sk sk-line"></span><span class="sk sk-line" style="width:60%"></span></div>`;
    const p = await loadDetail(id);
    if (!document.querySelector('.detail')) return;
    if (!p) { $app.innerHTML = back + emptyState({ ic: 'alert', title: '교제록을 찾을 수 없어요', desc: '지워졌거나 볼 수 없는 글이에요' }); return; }
    const sec = (title, ic, inner, extra = '') => (inner ? `<section class="sec"><h2>${icon(ic)}${title}${extra}</h2>${inner}</section>` : '');
    const para = (s) => (s ? `<p class="sec__text">${esc(s)}</p>` : '');
    const people = p.people.length ? sec('참석', 'users', `<div class="people">${p.people.map((n) => `<span class="person">${esc(n)}</span>`).join('')}</div>`, `<small>${p.people.length}명</small>`) : '';
    // 소제목(■ 양식이든 게시판의 [ 참석 ] 양식이든)이 2개 넘게 있으면 칸별로, 아니면 원문 그대로
    const RENDER = {
      people: () => people,
      verse: () => sec('말씀', 'quote', p.verse || p.verseNote ? `<blockquote class="verse">${p.verse ? `<b>${esc(p.verse)}</b>` : ''}${para(p.verseNote)}</blockquote>` : ''),
      share: () => sec('나눔', 'msg', para(p.share)),
      prayer: () => sec('기도제목', 'heart', p.prayers.length ? `<ul class="prs">${p.prayers.map((x) => prayerItem(x)).join('')}</ul>` : ''),
      etc: () => sec('기타', 'pin', para(p.etc)),
      writer: () => '', date: () => '',
    };
    const keys = Object.keys(p.sec || {});
    const body = keys.length >= 2
      ? keys.map((k) => (RENDER[k] ? RENDER[k]() : sec(esc(k), 'pin', para((p.sec[k] || []).join('\n'))))).join('')
      : `${people}<div class="sec raw-html">${sanitize(p.body) || '<p class="muted">본문이 없어요</p>'}</div>`;
    const photos = p.photos.length
      ? sec('사진', 'image', `<div class="gallery g-${Math.min(p.photos.length, 4)}">${p.photos.map((u, i) => `<button type="button" class="gallery__item" data-photo="${i}" aria-label="사진 ${i + 1} 크게 보기">${imgTag(u)}</button>`).join('')}</div>`, `<small>${p.photos.length}장</small>`)
      : '';
    // 이전·다음 글 (지금 불러온 목록 안에서)
    const list = state.posts || [];
    const idx = list.findIndex((x) => x.id === p.id);
    const newer = idx > 0 ? list[idx - 1] : null;
    const older = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;

    $app.innerHTML = `
      ${back}
      <article class="card detail">
        <div class="detail__tags">${tag(p.dept)}</div>
        <h1 class="detail__title">${esc(p.title)}</h1>
        <div class="detail__by">
          ${avatar(p.author)}
          <div><b>${esc(p.author || '작성자')}</b><span>${fullDate(p.date)}${p.hits ? ` · 조회 ${p.hits}` : ''}</span></div>
        </div>
        ${body}
        ${photos}
        <div class="react">${likeBtn(p.id, p.likes)}<span class="react__hint">마음에 들면 좋아요를 눌러 주세요</span></div>
        <section class="sec" id="comments"></section>
      </article>
      ${newer || older ? `<nav class="pager">
        ${older ? `<a href="#/post/${encodeURIComponent(older.id)}">${icon('left')}<span><small>이전 글</small>${esc(older.title)}</span></a>` : '<span></span>'}
        ${newer ? `<a class="pager__next" href="#/post/${encodeURIComponent(newer.id)}"><span><small>다음 글</small>${esc(newer.title)}</span>${icon('right')}</a>` : ''}
      </nav>` : ''}`;
    $app.querySelectorAll('[data-photo]').forEach((b) => { b.onclick = () => lightbox(p.photos, Number(b.dataset.photo)); });
    sharpen($app.querySelector('.gallery'));
    bindPrayerMore($app);
    checkLikes([p.id]);
    drawComments(p);
  }

  /* ─── 좋아요 (교회 사이트 게시판의 '좋아요'와 같은 값) ───
   * 피드·글·앨범 어디서 눌러도 같은 숫자가 함께 바뀜. 내가 눌렀는지는 화면에 보이는 글만 조금씩 확인 */
  const likeState = new Map(); // 글 번호 → { liked: true/false/null(모름), count }
  function likeOf(id, count = 0) {
    let s = likeState.get(id);
    if (!s) { s = { liked: null, count }; likeState.set(id, s); } else if (s.liked === null && !s.busy) s.count = count;
    return s;
  }
  const likeBtn = (id, count) => {
    const s = likeOf(String(id), Number(count) || 0);
    return `<button type="button" class="like${s.liked ? ' is-on' : ''}" data-like="${esc(id)}" aria-pressed="${!!s.liked}" aria-label="좋아요 ${s.count}개">${icon('thumb')}<span>${s.count}</span></button>`;
  };
  function paintLike(id) {
    const s = likeState.get(id);
    document.querySelectorAll(`[data-like="${CSS.escape(id)}"]`).forEach((b) => {
      b.classList.toggle('is-on', !!s.liked);
      b.setAttribute('aria-pressed', String(!!s.liked));
      b.setAttribute('aria-label', `좋아요 ${s.count}개`);
      b.querySelector('span').textContent = s.count;
    });
  }
  const likedFrom = (r) => [true, 1, '1', 'Y', 'y', 'yes', 'true'].includes(r.liked ?? r.result?.liked);
  async function checkLikes(ids) {
    for (const id of ids.map(String)) {
      const s = likeState.get(id);
      if (!s || s.liked !== null || s.busy) continue;
      const r = await callApi('comment', { mode: 'chkLike', board_uid: id });
      if (r.status !== 'ok') continue;
      s.liked = likedFrom(r);
      const total = r.total_like ?? r.result?.total_like;
      if (total != null) s.count = Number(total) || 0;
      paintLike(id);
    }
  }
  async function toggleLike(id) {
    const s = likeOf(id);
    if (s.busy) return;
    if (s.liked === null) await checkLikes([id]);
    s.busy = true;
    const was = !!s.liked;
    s.liked = !was; s.count = Math.max(0, s.count + (was ? -1 : 1));
    paintLike(id); // 먼저 바꿔 보여 주고, 실패하면 되돌림
    const r = await callApi('comment', { mode: 'processLike', board_uid: id, sw: was ? 2 : 1 });
    s.busy = false;
    if (r.status !== 'ok') {
      s.liked = was; s.count = Math.max(0, s.count + (was ? 1 : -1)); paintLike(id);
      toast(`좋아요를 누르지 못했어요: ${errText(r)}`, { tone: 'error' });
      return;
    }
    const total = r.total_like ?? r.result?.total_like;
    if (total != null) s.count = Number(total) || 0;
    if (r.process === 'plus' || r.process === 'minus') s.liked = r.process === 'plus';
    paintLike(id);
  }
  // 카드 전체가 링크라서, 좋아요 버튼을 누를 땐 글로 넘어가지 않게 먼저 가로챔
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-like]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    toggleLike(b.dataset.like);
  }, true);

  async function drawComments(p) {
    const $c = document.getElementById('comments');
    if (!$c) return;
    $c.innerHTML = `<h2>${icon('msg')}댓글</h2><div class="sk sk-line" style="width:50%"></div>`;
    const r = await callApi('board_comment', { board_uid: p.id, orderby: 'ASC' });
    if (!document.getElementById('comments')) return;
    // 댓글 API는 { status } 없이 배열만 돌려줌
    const list = (Array.isArray(r) ? r : (Array.isArray(r.result) ? r.result : [])).filter((x) => x && x.comment)
      .map((x) => ({ ...x, text: htmlToText(x.comment) }));
    const myId = String(auth.me?.userid || '').toLowerCase();
    const isMine = (x) => myId && String(x.userid || '').toLowerCase() === myId;
    const item = (x) => {
      const d = x.created ? new Date(String(x.created).replace(' ', 'T')) : null;
      return `<li class="${x.pending ? 'is-pending' : ''}">
        ${avatar(x.username, x.profilePic, 'sm')}
        <div class="cmt__body">
          <div class="cmt__head"><b>${esc(x.username || '')}</b>${x.sex ? `<span>${esc(x.sex)}</span>` : ''}<time>${x.pending ? '보내는 중' : esc(rel(d && !isNaN(d) ? d : null))}</time>
            ${isMine(x) && !x.pending ? `<button type="button" class="cmt__del" data-del="${esc(x.uid)}" aria-label="내 댓글 지우기">${icon('trash')}</button>` : ''}</div>
          <p>${esc(x.text)}</p>
        </div></li>`;
    };
    const draw = () => {
      const $list = $c.querySelector('.cmts');
      $c.querySelector('h2 small').textContent = list.length || '';
      $list.innerHTML = list.length ? list.map(item).join('') : `<li class="cmt__empty">아직 댓글이 없어요. 첫 댓글을 남겨 주세요</li>`;
      $list.querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async () => {
          if (!(await confirmSheet('댓글을 지울까요?', '지운 댓글은 되돌릴 수 없어요.', '지우기', 'danger'))) return;
          const i = list.findIndex((x) => String(x.uid) === b.dataset.del);
          const [gone] = list.splice(i, 1);
          draw();
          const res = await callApi('comment', { mode: 'del_comment', board_uid: p.id, comment_uid: b.dataset.del });
          if (res.status !== 'ok') { list.splice(i, 0, gone); draw(); toast(`지우지 못했어요: ${errText(res)}`, { tone: 'error' }); return; }
          p.comments = Math.max(0, (p.comments || 1) - 1);
          toast('댓글을 지웠어요');
        };
      });
    };
    $c.innerHTML = `
      <h2>${icon('msg')}댓글<small></small></h2>
      <ul class="cmts"></ul>
      <form class="cmt-form" id="cmtForm">
        ${avatar(auth.me?.name, '', 'sm')}
        <div class="cmt-form__box">
          <textarea name="comment" rows="1" maxlength="1000" placeholder="댓글 남기기" aria-label="댓글"></textarea>
          <button class="cmt-form__send" type="submit" aria-label="댓글 등록" disabled>${icon('send')}</button>
        </div>
      </form>`;
    draw();
    const $form = document.getElementById('cmtForm');
    const $ta = $form.comment;
    const $send = $form.querySelector('button');
    // 댓글 칸 높이: 비었으면 한 줄, 쓰는 만큼 늘어나다 다섯 줄에서 멈춤 (일부 휴대폰에서 칸이 길게 나오던 문제)
    const autosize = () => {
      if (!$ta.value) { $ta.style.height = ''; return; }
      $ta.style.height = '0px';
      $ta.style.height = `${Math.min(Math.max($ta.scrollHeight, 34), 120)}px`;
    };
    $ta.addEventListener('input', () => { autosize(); $send.disabled = $ta.value.trim().length < 2; });
    $ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $form.requestSubmit(); });
    $form.onsubmit = async (e) => {
      e.preventDefault();
      const text = $ta.value.trim();
      if (text.length < 2) return;
      // 낙관적 UI: 먼저 목록에 보여주고, 실패하면 되돌림
      const temp = { uid: 'tmp', username: auth.me?.name || '나', userid: auth.me?.userid, text, pending: true };
      list.push(temp); draw();
      $ta.value = ''; autosize(); $send.disabled = true;
      const res = await callApi('comment', { mode: 'add_comment', board_uid: p.id, comment: text, url: p.link || `${location.origin}/#/post/${p.id}` });
      const i = list.indexOf(temp);
      if (res.status !== 'ok') {
        list.splice(i, 1); draw();
        $ta.value = text; autosize(); $send.disabled = false;
        toast(`댓글을 달지 못했어요: ${errText(res)}`, { tone: 'error' });
        return;
      }
      list[i] = { ...temp, pending: false, uid: res.uid || res.result?.uid || '', created: new Date().toISOString() };
      p.comments = (p.comments || 0) + 1;
      draw();
      if (!list[i].uid) drawComments(p); // 번호를 못 받았으면 목록을 새로 받아 지우기 버튼 살리기
    };
  }

  /* ─── 기도제목 읽기 좋게 ───
   * "백영주 (대학동기) : 내용" → 누구를 위한 기도인지(백영주 · 대학동기)를 따로 보여주고 내용은 넉넉하게
   */
  // "곽윤례 (큰 어머님), 나상규 (큰 아버지) : 내용" → 대상 "곽윤례 (큰 어머님), 나상규 (큰 아버지)" + 내용
  function splitPrayer(text) {
    const t = String(text || '').trim();
    const i = t.search(/[:：]/);
    if (i > 0 && i <= 48) {
      const before = t.slice(0, i).trim().replace(/\s+,/g, ',');
      const body = t.slice(i + 1).trim();
      // 문장이 아니라 이름(관계) 모음일 때만 대상으로 봄
      if (body.length >= 2 && /[가-힣A-Za-z]/.test(before) && !/[.!?。]|습니다|해요|있도록|위해/.test(before) && before.split(/\s+/).length <= 8) {
        return { target: before, body };
      }
    }
    return { target: '', body: t };
  }
  // 대상 글씨: 괄호 속 관계는 작게
  const targetHtml = (s, q) => highlight(s, q).replace(/\s*[(（]([^)）]{1,20})[)）]/g, ' <small>$1</small>');
  function prayerItem(x, q = '', { showName = true, showDate = false } = {}) {
    const s = splitPrayer(x.text);
    return `<li class="pr${showName ? '' : ' pr--noav'}">
      ${showName ? avatar(x.name || '·', '', 'sm') : ''}
      <div class="pr__main">
        ${showName || (showDate && x.date) ? `<div class="pr__head">${showName ? `<b>${highlight(x.name || '이름 없음', q)}</b>` : ''}${showDate && x.date ? `<span class="pr__date">${esc(fullDate(x.date))}</span>` : ''}</div>` : ''}
        ${s.target ? `<span class="pr__for">${icon('heart')}<span>${targetHtml(s.target, q)}</span></span>` : ''}
        <p class="pr__body">${highlight(s.body, q)}</p>
        <button type="button" class="pr__more" hidden>더 보기</button>
      </div>
    </li>`;
  }
  // 긴 기도제목은 여섯 줄까지만 보이고 "더 보기"
  function bindPrayerMore(root) {
    root.querySelectorAll('.pr').forEach((li) => {
      const p = li.querySelector('.pr__body');
      const b = li.querySelector('.pr__more');
      if (p.scrollHeight > p.clientHeight + 2) {
        b.hidden = false;
        b.onclick = () => { const open = li.classList.toggle('is-open'); b.textContent = open ? '접기' : '더 보기'; };
      }
    });
  }

  /* ─── 화면: 기도제목 ─── */
  async function viewPrayers() {
    $app.innerHTML = `
      ${pageHead('기도제목', '서로의 기도제목을 기억하고 함께 기도해요')}
      <div class="toolbar">
        ${searchBox('pq', '이름이나 내용으로 찾기')}
        <div class="seg" role="group" aria-label="보기 방식" id="pmode"></div>
      </div>
      <div id="deptWrap"></div>
      <div id="plist">${progressBar('pprog', '최근 교제록 읽는 중')}${skeletonCards(3)}</div>`;
    const posts = await loadPosts();
    if (!document.getElementById('plist')) return;
    if (state.source === 'error') { document.getElementById('plist').innerHTML = errorState(); return; }
    await fillBodies((d, t) => setProg('pprog', d, t, `최근 교제록 읽는 중 · ${d}/${t}`));
    if (!document.getElementById('plist')) return;
    const dc = deptChips(posts, () => draw());
    document.getElementById('deptWrap').innerHTML = dc.html;
    dc.bind();
    const $mode = document.getElementById('pmode');
    let q = '';
    const drawMode = () => {
      $mode.innerHTML = [['week', '모임별'], ['person', '사람별']]
        .map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${state.prayerMode === k}">${l}</button>`).join('');
    };
    $mode.onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) { state.prayerMode = b.dataset.k; drawMode(); draw(); } };
    bindSearch('pq', (v) => { q = v; draw(); });
    drawMode();
    draw();

    function draw() {
      const items = posts.filter(inDept).flatMap((p) => p.prayers.map((x) => ({ ...x, date: p.date, postId: p.id, dept: p.dept })));
      const ql = q.toLowerCase();
      const rows = items.filter((x) => !ql || (x.name + ' ' + x.text).toLowerCase().includes(ql));
      const $l = document.getElementById('plist');
      if (!rows.length) {
        $l.innerHTML = q
          ? emptyState({ title: `'${esc(q)}'에 맞는 기도제목이 없어요` })
          : emptyState({ ic: 'heart', title: '아직 모인 기도제목이 없어요', desc: `최근 교제록 ${C.board.bodiesToLoad}개에서 모아요` });
        return;
      }
      const byPerson = state.prayerMode === 'person';
      const groups = new Map();
      for (const x of rows) {
        // 주차별은 교제록 한 편(모임 하나)씩, 사람별은 이름으로 묶음
        const key = byPerson ? (x.name || '이름 없음') : x.postId;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(x);
      }
      $l.innerHTML = `<div class="pgrid">${[...groups].map(([key, list]) => {
        const f = list[0];
        const head = byPerson
          ? `${avatar(key, '', 'md')}<div class="psec__title"><b>${highlight(key, q)}</b><small>기도제목 ${list.length}개</small></div>`
          : `<span class="datebox"><b>${f.date ? f.date.getDate() : '·'}</b><small>${f.date ? `${f.date.getMonth() + 1}월` : ''}</small></span>
             <div class="psec__title"><b>${f.date ? esc(fullDate(f.date)) : '날짜 없음'}</b><small>${f.dept ? `${tag(f.dept)} ` : ''}${list.length}명</small></div>
             <a class="link-btn psec__go" href="#/post/${encodeURIComponent(f.postId)}">교제록${icon('right')}</a>`;
        return `<section class="card psec"><header class="psec__head">${head}</header>
          <ul class="prs">${list.map((x) => prayerItem(x, q, { showName: !byPerson, showDate: byPerson })).join('')}</ul></section>`;
      }).join('')}</div>`;
      bindPrayerMore($l);
    }
  }

  /* ─── 화면: 참석 흐름 (관리자) ─── */
  async function viewAttendance() {
    $app.innerHTML = `${pageHead('참석 흐름', '주마다 누가 함께했는지 살펴봐요', '<span class="tag t-sun">관리자</span>')}<div id="deptWrap"></div><div id="body">${progressBar('aprog', '최근 교제록 읽는 중')}${skeletonCards(2)}</div>`;
    const all = await loadPosts();
    if (!document.getElementById('body')) return;
    if (state.source === 'error') { document.getElementById('body').innerHTML = errorState(); return; }
    await fillBodies((d, t) => setProg('aprog', d, t, `최근 교제록 읽는 중 · ${d}/${t}`));
    if (!document.getElementById('body')) return;
    const dc = deptChips(all.filter((p) => p.people.length), () => viewAttendance());
    document.getElementById('deptWrap').innerHTML = dc.html;
    dc.bind();
    const posts = all.filter((p) => p.date && p.people.length && inDept(p));
    const $b = document.getElementById('body');
    if (!posts.length) { $b.innerHTML = emptyState({ ic: 'users', title: '참석자 정보가 있는 교제록이 없어요' }); return; }
    const weeks = posts.slice(0, 12).reverse();
    const max = Math.max(...weeks.map((p) => p.people.length));
    const avg = weeks.reduce((s, p) => s + p.people.length, 0) / weeks.length;
    const recent = posts.slice(0, 8);
    const count = new Map();
    recent.forEach((p) => p.people.forEach((n) => count.set(n, (count.get(n) || 0) + 1)));
    const names = [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || a.localeCompare(b, 'ko'));
    const cols = [...recent].reverse();
    const diff = posts[1] ? posts[0].people.length - posts[1].people.length : 0;
    $b.innerHTML = `
      <div class="stats">
        <div class="stat card"><small>지난 모임</small><b>${posts[0].people.length}<em>명</em></b>${posts[1] ? `<span class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '+' : ''}${diff} 지난번보다</span>` : ''}</div>
        <div class="stat card"><small>평균 · 최근 ${weeks.length}번 <button type="button" class="tip" data-tip="최근 ${weeks.length}번 모임의 참석 인원을 더해서 나눈 값이에요" aria-label="평균 설명">${icon('alert')}</button></small><b>${avg.toFixed(1)}<em>명</em></b></div>
        <div class="stat card"><small>함께한 사람</small><b>${names.length}<em>명</em></b></div>
      </div>
      <section class="card block">
        <h2 class="block__title">모임별 참석 인원</h2>
        <div class="trend" role="img" aria-label="모임별 참석 인원 막대그래프">
          ${weeks.map((p, i) => `
            <div class="trend__bar${i === weeks.length - 1 ? ' is-last' : ''}" title="${fullDate(p.date)} · ${p.people.length}명">
              <b>${p.people.length}</b><i style="height:${Math.max(6, Math.round((p.people.length / max) * 100))}%"></i>
              <span>${p.date.getMonth() + 1}/${p.date.getDate()}</span>
            </div>`).join('')}
        </div>
      </section>
      <section class="card block">
        <h2 class="block__title">최근 ${cols.length}번 출석표</h2>
        <div class="matrix-wrap">
          <table class="matrix">
            <thead><tr><th>이름</th>${cols.map((p) => `<th>${p.date.getMonth() + 1}/${p.date.getDate()}</th>`).join('')}<th>참석</th></tr></thead>
            <tbody>${names.map((n) => `<tr><td>${esc(n)}</td>${cols.map((p) => `<td><span class="dot${p.people.includes(n) ? ' on' : ''}" aria-label="${p.people.includes(n) ? '참석' : '불참'}"></span></td>`).join('')}<td class="rate">${count.get(n)}/${cols.length}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </section>`;
  }

  /* ─── 명단 ─── */
  // 부서별 명단 (Cloudflare 환경 변수 ROSTERS → 로그인한 회원만 받음, 기기에 저장 안 함)
  async function loadRosters() {
    if (!auth.hash) return {};
    if (!state.rosters) {
      const r = await callApi('rosters');
      state.rosters = r.status === 'ok' && r.result && typeof r.result === 'object' ? r.result : {};
    }
    return state.rosters;
  }

  /* ─── 사진 축소 ─── */
  async function shrink(file, max = 1600, quality = 0.85) {
    let img;
    try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
      img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(file); });
    }
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
    const name = file.name.replace(/\.[^.]+$/, '') + '_축소.jpg';
    return { blob, name, url: URL.createObjectURL(blob), before: file.size, after: blob.size };
  }
  const mb = (n) => (n / 1048576).toFixed(n > 1048576 ? 1 : 2) + 'MB';
  async function copyRich(html, text) {
    try {
      if (window.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      return true;
    } catch {
      try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
    }
  }

  /* ─── 화면: 쓰기 ─── */
  const photos = [];
  async function viewWrite() {
    $app.innerHTML = `${pageHead('교제록 쓰기')}${skeletonCards(2)}`;
    const rosters = await loadRosters();
    if (location.hash.replace(/^#\/?/, '') !== 'write') return;
    const depts = Object.keys(rosters).filter((k) => rosters[k].length);
    const today = new Date();
    const draft = store.get('draft', null) || { date: ymd(today), writer: auth.me?.name || '', people: [], extra: '', verse: '', verseNote: '', share: '', prayers: {}, etc: '' };
    let dept = depts.includes(draft.dept) ? draft.dept : (depts.includes(store.get('lastDept', '')) ? store.get('lastDept', '') : (depts[0] || ''));
    const rosterOf = (d) => (d && rosters[d]) || [];
    const roster = rosterOf(dept);
    const canPost = C.board.writeEnabled && !!auth.hash;
    const checkBoxes = (list, checked) => list.map((n) => `<label class="check"><input type="checkbox" name="people" value="${esc(n)}"${checked.includes(n) ? ' checked' : ''}><span>${icon('check')}${esc(n)}</span></label>`).join('');
    const STEPS = [['people', '참석'], ['verse', '말씀'], ['share', '나눔'], ['prayer', '기도제목']];

    $app.innerHTML = `
      ${pageHead('교제록 쓰기', '쓰는 내용은 이 기기에 자동으로 저장돼요', '<span class="saved" id="saved" aria-live="polite"></span>')}
      <ol class="stepper card" id="steps" aria-label="작성 진행">${STEPS.map(([k, l], i) => `<li data-s="${k}"><span class="stepper__dot"><b>${i + 1}</b>${icon('check')}</span><span class="stepper__label">${l}</span></li>`).join('')}</ol>
      <p class="inline-error" id="formError" role="alert" hidden></p>
      <form class="write" id="f" autocomplete="off">
        <section class="card wsec">
          <h2 class="wsec__title">기본 정보</h2>
          ${depts.length ? `<div class="field"><span class="field__label">부서</span><div class="seg seg--wrap" id="deptPick" role="group" aria-label="부서">${depts.map((d) => `<button type="button" data-d="${esc(d)}" aria-pressed="${d === dept}">${esc(d)}</button>`).join('')}</div></div>` : ''}
          <div class="grid-2">
            <label class="field"><span class="field__label">날짜</span><input class="input" type="date" name="date" value="${esc(draft.date)}"></label>
            <label class="field"><span class="field__label">작성자</span><input class="input" name="writer" list="rosterList" value="${esc(draft.writer)}" placeholder="이름"></label>
          </div>
          <datalist id="rosterList">${roster.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        </section>

        <section class="card wsec" id="sec-people">
          <h2 class="wsec__title">참석자 <small id="pc"></small>${roster.length ? '<button type="button" class="link-btn" id="allBtn">모두 선택</button>' : ''}</h2>
          ${roster.length ? `<div class="checks" id="checks">${checkBoxes(roster, draft.people)}</div>`
            : `<p class="hint">${depts.length ? '' : '부서 명단이 등록되면 여기서 이름을 눌러 고를 수 있어요. 지금은 아래에 이름을 적어 주세요.'}</p>`}
          <input class="input" name="extra" value="${esc(draft.extra)}" placeholder="${roster.length ? '명단에 없는 사람 (쉼표로 구분)' : '참석자 이름 (쉼표로 구분, 예: 김가람, 이나래)'}">
        </section>

        <section class="card wsec">
          <h2 class="wsec__title">말씀</h2>
          <label class="field"><span class="field__label">본문</span><input class="input" name="verse" value="${esc(draft.verse)}" placeholder="예: 요한복음 15:5"></label>
          <label class="field"><span class="field__label">요약</span><textarea class="textarea" name="verseNote" rows="3" placeholder="말씀에서 받은 은혜를 간단히">${esc(draft.verseNote)}</textarea></label>
        </section>

        <section class="card wsec">
          <h2 class="wsec__title">나눔</h2>
          <textarea class="textarea" name="share" rows="5" placeholder="함께 나눈 이야기" aria-label="나눔">${esc(draft.share)}</textarea>
        </section>

        <section class="card wsec">
          <h2 class="wsec__title">기도제목</h2>
          <div class="prayer-inputs" id="prayers"></div>
        </section>

        <section class="card wsec">
          <h2 class="wsec__title">기타 <small>선택</small></h2>
          <textarea class="textarea" name="etc" rows="3" placeholder="광고, 모임 소식, 덧붙일 이야기" aria-label="기타">${esc(draft.etc ?? draft.bungae ?? '')}</textarea>
        </section>

        <section class="card wsec">
          <h2 class="wsec__title">사진 <small>자동으로 줄여서 올려요</small></h2>
          <input type="file" id="photoInput" accept="image/*" multiple hidden>
          <div class="photos" id="photos"></div>
        </section>

        <details class="card preview-box">
          <summary>게시판에 올라갈 모양 미리보기</summary>
          <div class="preview" id="preview"></div>
        </details>
      </form>

      <div class="actionbar">
        <button class="btn btn--ghost" type="button" id="more">${icon('copy')}<span>직접 올리기</span></button>
        <button class="btn btn--primary btn--lg" type="button" id="postNow"${canPost ? '' : ' disabled'}>${icon('send')}게시판에 올리기</button>
      </div>`;

    const $f = document.getElementById('f');
    const prayerDraft = { ...draft.prayers };

    function read() {
      const fd = new FormData($f);
      const people = fd.getAll('people');
      const extra = String(fd.get('extra') || '');
      const extras = extra.split(/[,，、]+/).map((s) => s.trim()).filter(Boolean);
      document.querySelectorAll('#prayers input').forEach((i) => { prayerDraft[i.dataset.name] = i.value; });
      return {
        dept,
        date: String(fd.get('date') || ''), writer: String(fd.get('writer') || '').trim(),
        people, extra, all: [...people, ...extras.filter((n) => !people.includes(n))],
        verse: String(fd.get('verse') || '').trim(), verseNote: String(fd.get('verseNote') || '').trim(),
        share: String(fd.get('share') || '').trim(), etc: String(fd.get('etc') || '').trim(),
        prayers: prayerDraft,
      };
    }
    function drawPrayers(all) {
      const $p = document.getElementById('prayers');
      const cur = [...$p.querySelectorAll('input')].map((i) => i.dataset.name).join('|');
      if (cur === all.join('|') && cur) return;
      $p.innerHTML = all.length
        ? all.map((n) => `<label class="prayer-input">${avatar(n, '', 'sm')}<span class="prayer-input__name">${esc(n)}</span><input class="input" data-name="${esc(n)}" value="${esc(prayerDraft[n] || '')}" placeholder="기도제목"></label>`).join('')
        : `<p class="hint">참석자를 고르면 사람마다 칸이 생겨요</p>`;
    }
    // 게시판에서 쓰던 제목 모양: "[2026 순종부] 2026.10.24 토요교제" (부서 없으면 "2026.10.24 청년회 토요교제")
    const titleOf = (d) => {
      const dt = parseDate(d.date) || new Date();
      const meeting = C.meetingName || '토요교제';
      return d.dept ? `[${dt.getFullYear()} ${d.dept}] ${dotDate(dt)} ${meeting}` : `${dotDate(dt)} ${C.groupName} ${meeting}`;
    };
    function lines(d) {
      const dt = parseDate(d.date);
      const out = [];
      if (dt) out.push(['날짜', `${dotDate(dt)} (${WEEK[dt.getDay()]})`]);
      if (d.writer) out.push(['작성', d.writer]);
      out.push([`참석자 (${d.all.length}명)`, d.all.join(', ')]);
      if (d.verse || d.verseNote) out.push(['말씀', d.verse, d.verseNote]);
      if (d.share) out.push(['나눔', '', d.share]);
      const pr = d.all.filter((n) => (d.prayers[n] || '').trim()).map((n) => `- ${n}: ${d.prayers[n].trim()}`);
      if (pr.length) out.push(['기도제목', '', pr.join('\n')]);
      if (d.etc) out.push(['기타', '', d.etc]);
      return out;
    }
    const toText = (d) => lines(d).map(([k, v, more]) => `■ ${k}${v ? ': ' + v : ''}${more ? '\n' + more : ''}`).join('\n\n');
    const toHtml = (d) => lines(d).map(([k, v, more]) =>
      `<p><b>■ ${esc(k)}</b>${v ? ': ' + esc(v) : ''}</p>${more ? more.split('\n').map((l) => `<p>${esc(l)}</p>`).join('') : ''}<p><br></p>`).join('');

    let savedTimer;
    function update(save = true) {
      const d = read();
      drawPrayers(d.all);
      document.getElementById('pc').textContent = d.all.length ? `${d.all.length}명` : '';
      document.getElementById('preview').innerHTML = `<p><b>${esc(titleOf(d))}</b></p><p><br></p>` + toHtml(d);
      const done = {
        people: d.all.length > 0, verse: !!(d.verse || d.verseNote), share: !!d.share,
        prayer: d.all.some((n) => (d.prayers[n] || '').trim()),
      };
      document.querySelectorAll('#steps [data-s]').forEach((el) => el.classList.toggle('on', done[el.dataset.s]));
      const $all = document.getElementById('allBtn');
      if ($all) $all.textContent = d.people.length === rosterOf(dept).length ? '모두 해제' : '모두 선택';
      if (d.all.length || d.share) document.getElementById('formError').hidden = true;
      if (!save) return;
      const { all, ...keep } = d;
      store.set('draft', keep);
      const $s = document.getElementById('saved');
      $s.innerHTML = `${spinner}저장 중`;
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => { if (document.getElementById('saved')) $s.innerHTML = `${icon('check')}자동 저장됨`; }, 500);
    }
    $f.addEventListener('input', () => update());
    $f.addEventListener('change', () => update());
    $f.addEventListener('submit', (e) => e.preventDefault());
    document.getElementById('allBtn')?.addEventListener('click', () => {
      const boxes = [...document.querySelectorAll('#checks input')];
      const on = !boxes.every((b) => b.checked);
      boxes.forEach((b) => { b.checked = on; });
      update();
    });
    // 부서를 바꾸면 그 부서 명단으로 참석자 칸을 다시 그림
    const $dp = document.getElementById('deptPick');
    if ($dp) $dp.onclick = (e) => {
      const b = e.target.closest('[data-d]');
      if (!b || b.dataset.d === dept) return;
      dept = b.dataset.d;
      store.set('lastDept', dept);
      $dp.querySelectorAll('[data-d]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.d === dept)));
      const list = rosterOf(dept);
      const kept = new FormData($f).getAll('people').filter((n) => list.includes(n));
      const $checks = document.getElementById('checks');
      if ($checks) $checks.innerHTML = checkBoxes(list, kept);
      document.getElementById('rosterList').innerHTML = list.map((n) => `<option value="${esc(n)}">`).join('');
      update();
    };
    update(false);
    if (store.get('draft', null)) document.getElementById('saved').innerHTML = `${icon('check')}자동 저장됨`;

    // 사진
    const $pi = document.getElementById('photoInput');
    const drawPhotos = () => {
      document.getElementById('photos').innerHTML = photos.map((p, i) => `
        <div class="photo"><img src="${p.url}" alt=""><small>${mb(p.after)}</small><button type="button" data-del="${i}" aria-label="사진 빼기">${icon('x')}</button></div>`).join('') +
        `<button type="button" class="photo photo--add" id="addPhoto">${icon('plus')}<span>${photos.length ? '더 고르기' : '사진 고르기'}</span></button>`;
      document.getElementById('addPhoto').onclick = () => $pi.click();
    };
    drawPhotos();
    $pi.onchange = async () => {
      const files = [...$pi.files];
      $pi.value = '';
      if (!files.length) return;
      const $add = document.getElementById('addPhoto');
      $add.innerHTML = `${spinner}<span>줄이는 중</span>`;
      for (const f of files) {
        try { photos.push(await shrink(f)); } catch { toast(`${f.name}: 읽을 수 없는 사진이에요`, { tone: 'error' }); }
      }
      drawPhotos();
    };
    document.getElementById('photos').addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      const [p] = photos.splice(Number(b.dataset.del), 1);
      drawPhotos();
      toast('사진을 뺐어요', { action: { label: '되돌리기', onClick: () => { photos.splice(Number(b.dataset.del), 0, p); drawPhotos(); } } });
    });

    // 직접 올리기 (복사·저장·게시판 열기·새로 쓰기)
    document.getElementById('more').onclick = async () => {
      const sh = openSheet({
        title: '직접 올리기',
        body: `<p class="sheet__text">복사해서 교회 사이트 게시판 글쓰기에 붙여넣어요.</p>
          <div class="menu">
            <button type="button" data-a="title">${icon('copy')}<span><b>제목 복사</b><small>${esc(titleOf(read()))}</small></span></button>
            <button type="button" data-a="body">${icon('copy')}<span><b>본문 복사</b><small>양식에 맞춰 복사돼요</small></span></button>
            ${photos.length ? `<button type="button" data-a="photos">${icon('download')}<span><b>줄인 사진 저장</b><small>${photos.length}장</small></span></button>` : ''}
            <a href="${esc(C.board.siteUrl)}" target="_blank" rel="noopener" data-a="open">${icon('external')}<span><b>교회 사이트 게시판 열기</b><small>청년회교제실</small></span></a>
            <button type="button" data-a="reset" class="menu__danger">${icon('refresh')}<span><b>새로 쓰기</b><small>지금 쓴 내용을 비워요</small></span></button>
          </div>`,
      });
      sh.el.querySelector('.menu').onclick = async (e) => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        const a = b.dataset.a;
        const d = read();
        if (a === 'title') { toast((await copyRich(esc(titleOf(d)), titleOf(d))) ? '제목을 복사했어요' : '복사하지 못했어요', { tone: 'ok' }); }
        if (a === 'body') {
          if (!d.all.length && !d.share) { sh.close(); return showFormError(); }
          toast((await copyRich(toHtml(d), toText(d))) ? '본문을 복사했어요. 게시판에 붙여넣으세요' : '복사하지 못했어요. 미리보기를 길게 눌러 복사해 주세요');
        }
        if (a === 'photos') savePhotos();
        if (a === 'reset') {
          sh.close();
          const stash = { draft: store.get('draft', null), photos: photos.slice() };
          store.del('draft'); photos.length = 0;
          viewWrite();
          toast('새로 쓰기 시작했어요', { action: { label: '되돌리기', onClick: () => { if (stash.draft) store.set('draft', stash.draft); photos.push(...stash.photos); viewWrite(); } } });
          return;
        }
        if (a !== 'open') sh.close();
      };
    };
    async function savePhotos() {
      const files = photos.map((p) => new File([p.blob], p.name, { type: 'image/jpeg' }));
      if (navigator.canShare?.({ files })) {
        try { await navigator.share({ files }); return; } catch (e) { if (e.name === 'AbortError') return; }
      }
      photos.forEach((p) => { const a = document.createElement('a'); a.href = p.url; a.download = p.name; document.body.appendChild(a); a.click(); a.remove(); });
    }
    function showFormError() {
      const $e = document.getElementById('formError');
      $e.innerHTML = `${icon('alert')}참석자나 나눔을 먼저 적어 주세요`;
      $e.hidden = false;
      document.getElementById('sec-people').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
    }

    // 게시판에 올리기
    document.getElementById('postNow').onclick = async () => {
      const d = read();
      if (!d.all.length && !d.share) return showFormError();
      const title = titleOf(d);
      const ok = await openSheet({
        title: '게시판에 올릴까요?',
        body: `<div class="summary"><b>${esc(title)}</b><span>${icon('users')}참석 ${d.all.length}명</span><span>${icon('image')}사진 ${photos.length}장</span><span>${icon('user')}${esc(auth.me?.name || '내')} 이름으로 올라가요</span></div>
          <p class="sheet__text">올리면 교회 사이트 청년회교제실에 바로 보여요.</p>`,
        actions: [{ label: '취소', value: false }, { label: '올리기', value: true, kind: 'primary' }],
      }).result;
      if (!ok) return;
      const total = photos.length + 1;
      const pr = openSheet({ title: '올리는 중', body: progressBar('upProg', '준비 중'), dismissable: false });
      const fail = (msg) => { pr.close(); toast(msg, { tone: 'error' }); };
      const fileId = [];
      const fileName = [];
      for (const [i, ph] of photos.entries()) {
        setProg('upProg', i, total, `사진 올리는 중 · ${i + 1}/${photos.length}`);
        const r = await uploadPhoto(ph.blob, ph.name);
        const f = r.status === 'ok' && r.result && typeof r.result === 'object' ? r.result : null;
        if (!f?.fileId) return fail(`사진을 올리지 못했어요: ${errText(r)}`);
        fileId.push(String(f.fileId));
        fileName.push(String(f.fileName || ph.name));
      }
      setProg('upProg', photos.length, total, '글 올리는 중');
      const r = await callApi('board_write', {
        boardId: String(C.board.boardId), subject: title, content: toHtml(d),
        ...(fileId.length ? { fileId, fileName } : {}),
      });
      if (r.status !== 'ok') return fail(`올리지 못했어요: ${errText(r)}`);
      setProg('upProg', total, total, '다 올렸어요');
      store.del('draft');
      photos.splice(0).forEach((p) => URL.revokeObjectURL(p.url));
      state.posts = null; state.loading = null;
      setTimeout(() => { pr.close(); toast('게시판에 올렸어요'); location.hash = r.result?.uid ? `#/post/${r.result.uid}` : '#/'; }, 400);
    };
  }

  /* ─── 화면: 내 정보 ─── */
  /* ─── 휴대폰 알림 (서비스 워커 + Web Push) ───
   * 아이폰은 Safari '홈 화면에 추가'로 연 앱에서만 알림을 받을 수 있음 */
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushCapable = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let swReg = null;
  async function swReady() {
    if (!('serviceWorker' in navigator)) return null;
    if (!swReg) swReg = await navigator.serviceWorker.register('/sw.js').catch(() => null);
    return swReg;
  }
  const keyBytes = (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
  async function pushState() {
    if (isIOS() && !isStandalone()) return 'ios-install';
    if (!pushCapable()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    const reg = await swReady();
    const sub = await reg?.pushManager.getSubscription().catch(() => null);
    return sub ? 'on' : 'off';
  }
  async function pushOn() {
    if ((await Notification.requestPermission()) !== 'granted') { toast('알림이 허용되지 않았어요', { tone: 'error' }); return; }
    const k = await callApi('push_key');
    if (k.status !== 'ok') { toast(`알림을 켜지 못했어요: ${errText(k)}`, { tone: 'error' }); return; }
    const reg = await swReady();
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    try {
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(k.result) });
    } catch { toast('이 기기에서는 알림을 켤 수 없어요', { tone: 'error' }); return; }
    const r = await callApi('push_sub', { sub: sub.toJSON() });
    if (r.status !== 'ok') { toast(`알림을 켜지 못했어요: ${errText(r)}`, { tone: 'error' }); return; }
    toast('알림을 켰어요. 지금 시험 알림을 하나 보내 드려요');
    await testPush();
    return true;
  }
  // 알림이 어떻게 오는지 바로 보여 주기 (이 기기에서만, 서버를 거치지 않음)
  async function testPush() {
    const reg = await swReady();
    if (!reg || Notification.permission !== 'granted') return;
    await navigator.serviceWorker.ready;
    await reg.showNotification('알림이 켜졌어요', {
      body: '새 교제록·포토스토리·앨범이 올라오면 이렇게 알려 드려요. 누르면 그 글로 바로 가요.',
      icon: '/assets/icon-192.png', badge: '/assets/icon-192.png', tag: 'ya-test', data: { url: '/#/settings' },
    }).catch(() => {});
  }
  async function pushOff() {
    const reg = await swReady();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await callApi('push_unsub', { sub: { endpoint: sub.endpoint } }); await sub.unsubscribe().catch(() => {}); }
    toast('알림을 껐어요');
  }
  /* 알림은 기본으로 켜는 쪽: 처음 들어오면 앱이 먼저 물어보고, '알림 받기'를 누르면 휴대폰 권한 창이 뜸.
   * (브라우저 규칙상 사람이 직접 누르기 전엔 권한을 받을 수 없음)
   * - 이미 허용했는데 구독만 빠진 기기는 조용히 다시 켬
   * - '나중에'는 7일 뒤 다시, 아이폰 Safari는 홈 화면에 추가 안내를 14일에 한 번 */
  async function maybeAskPush() {
    const st = await pushState();
    if (st === 'off' && Notification.permission === 'granted') {
      const k = await callApi('push_key');
      const reg = await swReady();
      if (k.status !== 'ok' || !reg) return;
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(k.result) }).catch(() => null);
      if (sub) callApi('push_sub', { sub: sub.toJSON() });
      return;
    }
    const later = store.get('pushAskLater', 0);
    if (!['off', 'ios-install'].includes(st) || Date.now() < later) return;
    if (document.querySelector('.sheet-wrap, .coach')) return; // 다른 안내가 떠 있으면 다음에
    // 한 번 띄웠으면 무엇을 고르든(닫거나 새로고침해도) 사흘 동안은 다시 안 띄움
    store.set('pushAskLater', Date.now() + 3 * 86400e3);
    if (st === 'ios-install') {
      store.set('pushAskLater', Date.now() + 14 * 86400e3);
      await openSheet({
        title: '새 글 알림 받기',
        body: `<p class="sheet__text">아이폰은 앱처럼 설치해야 알림을 받을 수 있어요.</p>
          <ol class="push-steps"><li>Safari 아래쪽 <b>공유 버튼</b>을 눌러요</li><li><b>‘홈 화면에 추가’</b>를 눌러요</li><li>홈 화면에 생긴 <b>교회당 아이콘</b>으로 열면 알림을 켜는 창이 나와요</li></ol>`,
        actions: [{ label: '알겠어요', value: true, kind: 'primary' }],
      }).result;
      return;
    }
    const yes = await openSheet({
      title: '새 글 알림 받기',
      body: '<p class="sheet__text">교제록·포토스토리·앨범이 올라오면 휴대폰으로 알려 드려요. <b>알림 받기</b>를 누른 뒤 나오는 창에서 <b>허용</b>을 눌러 주세요.</p><p class="hint">내 정보에서 언제든 끌 수 있어요</p>',
      actions: [{ label: '나중에', value: false }, { label: '알림 받기', value: true, kind: 'primary', icon: 'bell' }],
    }).result;
    if (!yes) { store.set('pushAskLater', Date.now() + 7 * 86400e3); return; }
    const ok = await pushOn();
    if (Notification.permission === 'denied') store.set('pushAskLater', Date.now() + 365 * 86400e3);
    if (!ok) {
      openSheet({
        title: '알림을 켜지 못했어요',
        body: Notification.permission === 'denied'
          ? '<p class="sheet__text">휴대폰에서 이 사이트 알림이 막혀 있어요. 브라우저 설정 → 사이트 설정 → 알림에서 <b>young-adult.pages.dev</b>를 허용으로 바꾼 뒤, <b>내 정보 → 새 글 알림</b>에서 다시 켜 주세요.</p>'
          : '<p class="sheet__text">허용 창이 닫혔거나 이 기기에서 알림을 쓸 수 없어요. <b>내 정보 → 새 글 알림</b>에서 언제든 다시 켤 수 있어요.</p>',
        actions: [{ label: '알겠어요', value: true, kind: 'primary' }],
      });
    }
  }
  async function drawPushCard() {
    const $b = document.getElementById('pushBtn');
    const $h = document.getElementById('pushHint');
    if (!$b) return;
    const st = await pushState();
    const HINT = {
      on: '알림을 받고 있어요 · 새 글은 50분마다 확인해요',
      off: '교제록·포토스토리·앨범이 올라오면 휴대폰으로 알려 드려요',
      denied: '이 기기에서 알림을 막아 두었어요. 브라우저 설정에서 이 사이트 알림을 허용해 주세요',
      'ios-install': '아이폰은 Safari 아래 공유 버튼 → ‘홈 화면에 추가’를 누른 뒤, 홈 화면의 앱으로 열어야 알림을 받을 수 있어요',
      unsupported: '이 브라우저는 알림을 지원하지 않아요',
    };
    $h.textContent = HINT[st];
    $b.hidden = !['on', 'off'].includes(st);
    $b.disabled = false;
    $b.className = st === 'off' ? 'btn btn--primary btn--sm' : 'btn btn--sm';
    $b.textContent = st === 'on' ? '알림 끄기' : '알림 받기';
    $b.onclick = async () => {
      $b.disabled = true; $b.textContent = '잠시만요';
      if (st === 'on') await pushOff(); else await pushOn();
      drawPushCard();
    };
    // 켜져 있으면 상태를 눈에 띄게 + 시험 알림 버튼
    const card = document.getElementById('pushCard');
    card.classList.toggle('is-on', st === 'on');
    let $t = document.getElementById('pushTest');
    if (st === 'on' && !$t) {
      $t = document.createElement('button');
      $t.type = 'button'; $t.id = 'pushTest'; $t.className = 'link-btn push-test';
      $t.textContent = '시험 알림 받아 보기';
      $t.onclick = () => testPush();
      card.querySelector('span').appendChild($t);
    } else if (st !== 'on' && $t) $t.remove();
  }

  async function viewSettings() {
    const B = C.board;
    const SAMPLES = {
      board_post: { ...B.listParams, [B.pageParam]: 1, [B.limitParam]: 5 },
      board_latest: { boardIds: String(B.boardId), cnt: 3 },
      board_comment: { board_uid: '', orderby: 'ASC' },
      member_search: { q: '' },
    };
    const sampleJson = (api) => JSON.stringify(SAMPLES[api] || {}, null, 2);
    const me = auth.me;
    $app.innerHTML = `
      ${pageHead('내 정보')}
      <section class="card profile">
        ${avatar(me?.name, '', 'lg')}
        <div class="profile__who"><b>${esc(me?.name || '로그인됨')}${me?.sex ? ` <span>${esc(me.sex)}</span>` : ''}</b><small>${esc([me?.church, me?.userid].filter(Boolean).join(' · '))}</small></div>
        ${me?.admin ? '<span class="tag t-sun">관리자</span>' : ''}
      </section>
      <section class="card setting">
        <span><b>화면 밝기</b><small>어두운 화면이 편하면 바꿔 보세요</small></span>
        <div class="seg" id="themePick" role="group" aria-label="화면 밝기">
          ${[['light', '밝게'], ['dark', '어둡게'], ['system', '기기 설정']].map(([k, l]) => `<button type="button" data-t="${k}" aria-pressed="${store.get('theme', 'light') === k}">${l}</button>`).join('')}
        </div>
      </section>
      <section class="card setting" id="pushCard">
        <span><b>새 글 알림</b><small id="pushHint">교제록·포토스토리·앨범이 올라오면 휴대폰으로 알려 드려요</small></span>
        <button type="button" class="btn btn--sm" id="pushBtn" disabled>확인 중</button>
      </section>
      <div class="list-card card">
        ${isAdmin() ? `<a href="#/admin">${icon('users')}<span>관리 · 부서와 부서 관리자</span>${icon('right', 'ic--end')}</a>
        <a href="#/attendance">${icon('chart')}<span>참석 흐름</span>${icon('right', 'ic--end')}</a>` : ''}
        ${auth.me?.deptAdminOf?.length ? `<a href="#/calendar">${icon('calendar')}<span>부서 일정 올리기 · ${esc(auth.me.deptAdminOf.join(', '))}</span>${icon('right', 'ic--end')}</a>` : ''}
        <a href="${esc(C.board.siteUrl)}" target="_blank" rel="noopener">${icon('external')}<span>교회 사이트 청년회교제실</span>${icon('right', 'ic--end')}</a>
        <button type="button" id="logout">${icon('logout')}<span>로그아웃</span>${icon('right', 'ic--end')}</button>
      </div>
      ${isAdmin() ? `<details class="card fold">
        <summary><span><b>API 연결 확인</b><small>관리용 · 생명선앱스 API를 직접 불러봐요</small></span>${icon('right', 'fold__ic')}</summary>
        <div class="fold__body">
          <select class="select" id="api" aria-label="API">
            <option value="board_post">게시글 목록·상세 (load_boardb_post)</option>
            <option value="board_latest">최신글 (load_boardb_latest)</option>
            <option value="board_comment">댓글 (load_boardb_comment)</option>
            <option value="member_search">회원 검색 (load_member_search)</option>
          </select>
          <textarea class="textarea mono" id="params" rows="6" aria-label="보낼 값">${esc(sampleJson('board_post'))}</textarea>
          <div class="btn-row"><button class="btn btn--primary btn--sm" type="button" id="run">호출하기</button><button class="btn btn--sm" type="button" id="reload">교제록 다시 불러오기</button></div>
          <pre class="json" id="out" hidden></pre>
        </div>
      </details>` : ''}`;

    drawPushCard();
    document.getElementById('themePick').onclick = (e) => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      store.set('theme', b.dataset.t);
      applyTheme();
      document.querySelectorAll('#themePick [data-t]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    };
    document.getElementById('logout').onclick = async () => {
      if (!(await confirmSheet('로그아웃할까요?', '다음에 다시 깨사모 아이디로 로그인하면 돼요.', '로그아웃'))) return;
      signOut();
      location.hash = '#/';
      route();
      toast('로그아웃했어요');
    };
    if (!isAdmin()) return;
    // 관리자만: API 연결 확인
    document.getElementById('api').onchange = (e) => { document.getElementById('params').value = sampleJson(e.target.value); };
    document.getElementById('run').onclick = async () => {
      const $out = document.getElementById('out');
      let params;
      try { params = JSON.parse(document.getElementById('params').value || '{}'); } catch { toast('JSON 모양이 올바르지 않아요', { tone: 'error' }); return; }
      $out.hidden = false;
      $out.textContent = '호출 중…';
      const r = await callApi(document.getElementById('api').value, params);
      $out.textContent = JSON.stringify(r, null, 2);
    };
    document.getElementById('reload').onclick = async () => {
      await loadPosts(true);
      toast(state.source === 'api' ? `교제록 ${state.posts.length}개를 불러왔어요` : `연결 실패: ${state.error}`);
    };
  }

  /* ═══ 화면: 일정 (월정표) ═══════════════════════
   * 교회 전체 · 청년회 · 부서 일정을 한 달 달력으로. 부서 일정은 그 부서 사람만 봐요.
   */
  const SCOPE_LABEL = { church: '교회 전체', youth: '청년회', dept: '부서' };
  const thisMonth = () => ymd(new Date()).slice(0, 7);
  const addMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const evLabel = (e) => (e.scope === 'dept' ? e.dept : SCOPE_LABEL[e.scope]);
  const evTone = (e) => (e.scope === 'church' ? 'church' : e.scope === 'youth' ? 'youth' : tone(e.dept));
  const evWhen = (e) => {
    const s = parseDate(e.start), en = parseDate(e.end || e.start);
    const d1 = s ? `${s.getMonth() + 1}월 ${s.getDate()}일 (${WEEK[s.getDay()]})` : '';
    if (!en || e.end === e.start || !e.end) return d1 + (e.time ? ` · ${e.time}` : '');
    return `${d1} ~ ${en.getMonth() + 1 !== s.getMonth() + 1 ? `${en.getMonth() + 1}월 ` : ''}${en.getDate()}일 (${WEEK[en.getDay()]})${e.time ? ` · ${e.time}` : ''}`;
  };
  const calCache = new Map(); // 달 → 응답
  async function loadMonth(month, force) {
    if (!force && calCache.has(month)) return calCache.get(month);
    const r = await callApi('cal_get', { month });
    if (r.status === 'ok' || r.perms) calCache.set(month, r);
    return r;
  }
  const calFilter = () => store.get('calFilter', { church: true, youth: true, depts: null }); // depts: null = 볼 수 있는 부서 전부
  const passFilter = (e, f) => (e.scope === 'church' ? f.church : e.scope === 'youth' ? f.youth : (f.depts ? f.depts.includes(e.dept) : true));

  async function viewCalendar() {
    if (!state.calView) state.calView = thisMonth();
    const month = state.calView;
    const [y, mo] = month.split('-').map(Number);
    $app.innerHTML = `
      <header class="cal-head">
        <div class="cal-head__title">
          <h1>${y}년 ${mo}월 <span>일정</span></h1>
          <p class="cal-head__theme" id="calTheme"></p>
        </div>
        <div class="cal-head__nav">
          <button type="button" class="icon-btn icon-btn--lg" id="calPrev" aria-label="지난달">${icon('left')}</button>
          <button type="button" class="btn btn--sm" id="calToday">이번 달</button>
          <button type="button" class="icon-btn icon-btn--lg" id="calNext" aria-label="다음 달">${icon('right')}</button>
        </div>
      </header>
      <div class="cal-tools">
        <div class="chips chips--tight" id="calChips"></div>
        <div class="cal-tools__right" id="calAdmin"></div>
      </div>
      <div id="calBody">${skeletonCards(2)}</div>`;
    document.getElementById('calPrev').onclick = () => { state.calView = addMonth(month, -1); viewCalendar(); };
    document.getElementById('calNext').onclick = () => { state.calView = addMonth(month, 1); viewCalendar(); };
    document.getElementById('calToday').onclick = () => { state.calView = thisMonth(); viewCalendar(); };

    const r = await loadMonth(month);
    if (state.calView !== month || !document.getElementById('calBody')) return;
    const perms = r.perms || { viewDepts: [], editDepts: [] };
    if (r.status !== 'ok') {
      document.getElementById('calBody').innerHTML = emptyState({ ic: 'calendar', title: '일정을 불러오지 못했어요', desc: esc(errText(r)), action: `<button class="btn btn--sm" type="button" id="calRetry">${icon('refresh')}다시 불러오기</button>` });
      document.getElementById('calRetry').onclick = () => { calCache.delete(month); viewCalendar(); };
      return;
    }
    const meta = r.meta || {};
    document.getElementById('calTheme').innerHTML = [
      meta.theme ? `<span class="theme-pill">주제</span>${esc(meta.theme)}` : '',
      meta.image ? `<button type="button" class="link-btn" id="calImg">${icon('image')}월정표 원본</button>` : '',
    ].filter(Boolean).join(' ');
    document.getElementById('calImg')?.addEventListener('click', () => showMonthImage(month));

    // 거르기 칩: 교회 전체 · 청년회 · 볼 수 있는 부서
    const f = calFilter();
    const drawChips = () => {
      const cur = calFilter();
      const chips = [
        ['church', '교회 전체', cur.church],
        ['youth', '청년회', cur.youth],
        ...perms.viewDepts.map((d) => [`d:${d}`, d, cur.depts ? cur.depts.includes(d) : true]),
      ];
      document.getElementById('calChips').innerHTML = chips.map(([k, l, on]) =>
        `<button type="button" class="chip chip--ev ev-${k === 'church' ? 'church' : k === 'youth' ? 'youth' : tone(l)}" data-k="${esc(k)}" aria-pressed="${on}"><i></i>${esc(l)}</button>`).join('');
    };
    drawChips();
    document.getElementById('calChips').onclick = (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      const cur = calFilter();
      const k = b.dataset.k;
      if (k === 'church' || k === 'youth') cur[k] = !cur[k];
      else {
        const d = k.slice(2);
        const set = new Set(cur.depts || perms.viewDepts);
        if (set.has(d)) set.delete(d); else set.add(d);
        cur.depts = [...set];
      }
      store.set('calFilter', cur);
      drawChips(); drawBody();
    };

    // 관리자 버튼
    const canAdd = perms.editShared || perms.editDepts.length;
    document.getElementById('calAdmin').innerHTML = `
      ${perms.superAdmin ? `<button type="button" class="btn btn--sm" id="calMeta">${icon('pen')}이달 정보</button>` : ''}
      ${canAdd ? `<button type="button" class="btn btn--sm" id="calBulk">${icon('copy')}여러 개 붙여넣기</button><button type="button" class="btn btn--primary btn--sm" id="calAdd">${icon('plus')}일정 추가</button>` : ''}`;
    document.getElementById('calAdd')?.addEventListener('click', () => editEvent(null, perms, month));
    document.getElementById('calBulk')?.addEventListener('click', () => bulkEvents(perms, month));
    document.getElementById('calMeta')?.addEventListener('click', () => editMonthMeta(month, meta));

    let selected = state.calDay && state.calDay.startsWith(month) ? state.calDay : '';
    function drawBody() {
      const ff = calFilter();
      const events = (r.events || []).filter((e) => passFilter(e, ff));
      document.getElementById('calBody').innerHTML = `
        <div class="card mcal">${monthGrid(month, events, selected)}</div>
        ${meta.memo ? `<section class="card memo"><h2>${icon('pin')}이달 안내</h2><p>${esc(meta.memo)}</p></section>` : ''}
        <section class="agenda" id="agenda">${agenda(month, events, selected)}</section>`;
      document.querySelectorAll('.mcal [data-day]').forEach((c) => {
        c.onclick = (e) => {
          const evBtn = e.target.closest('[data-ev]');
          if (evBtn) return openEvent(findEv(evBtn.dataset.ev), perms, month);
          selected = selected === c.dataset.day ? '' : c.dataset.day;
          state.calDay = selected;
          drawBody();
          if (selected && !isWide()) document.getElementById('agenda').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
        };
      });
      document.querySelectorAll('#agenda [data-ev]').forEach((b) => { b.onclick = () => openEvent(findEv(b.dataset.ev), perms, month); });
      document.getElementById('agendaAll')?.addEventListener('click', () => { selected = ''; state.calDay = ''; drawBody(); });
    }
    const findEv = (id) => (r.events || []).find((e) => e.id === id);
    drawBody();
  }

  // 한 달 달력: 여러 날 일정은 이어지는 막대로 (주마다 줄 맞춤)
  function monthGrid(month, events, selected) {
    const [y, mo] = month.split('-').map(Number);
    const first = new Date(y, mo - 1, 1);
    const start = new Date(y, mo - 1, 1 - first.getDay());
    const todayK = ymd(new Date());
    let html = `<div class="mcal__w">${WEEK.map((w, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('')}</div>`;
    for (let w = 0; w < 6; w++) {
      const days = Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i));
      if (w > 3 && days[0].getMonth() !== mo - 1) break;
      const keys = days.map(ymd);
      // 이 주에 걸친 일정을 줄(slot)에 배치
      const inWeek = events.filter((e) => e.start <= keys[6] && (e.end || e.start) >= keys[0])
        .sort((a, b) => ((b.end || b.start) > b.start) - ((a.end || a.start) > a.start) || a.start.localeCompare(b.start) || (a.time || '').localeCompare(b.time || ''));
      const slots = []; // slot → 7칸 사용 여부
      const placed = [];
      for (const e of inWeek) {
        const s = Math.max(0, keys.indexOf(e.start) >= 0 ? keys.indexOf(e.start) : 0);
        const endKey = e.end || e.start;
        const en = keys.indexOf(endKey) >= 0 ? keys.indexOf(endKey) : 6;
        let slot = 0;
        while (slots[slot] && slots[slot].slice(s, en + 1).some(Boolean)) slot++;
        slots[slot] = slots[slot] || Array(7).fill(false);
        for (let i = s; i <= en; i++) slots[slot][i] = true;
        placed.push({ e, s, en, slot, contL: e.start < keys[0], contR: endKey > keys[6] });
      }
      const MAX = 3;
      html += `<div class="mcal__week">`;
      days.forEach((d, i) => {
        const k = keys[i];
        const out = d.getMonth() !== mo - 1;
        const here = placed.filter((p) => p.s <= i && p.en >= i);
        const shown = [];
        for (let sl = 0; sl < Math.min(slots.length, MAX); sl++) shown.push(here.find((p) => p.slot === sl) || null);
        const more = here.filter((p) => p.slot >= MAX).length;
        html += `<div class="mcal__d${out ? ' is-out' : ''}${k === todayK ? ' is-today' : ''}${k === selected ? ' is-on' : ''}${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}" data-day="${k}" role="button" tabindex="0" aria-label="${d.getMonth() + 1}월 ${d.getDate()}일 일정 ${here.length}개">
          <span class="mcal__n">${d.getDate()}</span>
          ${shown.map((p) => {
            if (!p) return '<span class="ev ev--gap"></span>';
            const first = p.s === i, last = p.en === i;
            const cls = `ev ev-${evTone(p.e)}${p.en > p.s ? ' ev--multi' : ''}${first && !p.contL ? ' ev--l' : ''}${last && !p.contR ? ' ev--r' : ''}`;
            const label = first || i === 0 ? esc(p.e.title) : '&nbsp;';
            return `<button type="button" class="${cls}" data-ev="${esc(p.e.id)}" title="${esc(p.e.title)}">${label}</button>`;
          }).join('')}
          ${more ? `<span class="ev-more">+${more}</span>` : ''}
          ${here.length ? `<span class="mcal__dots">${here.slice(0, 4).map((p) => `<i class="ev-${evTone(p.e)}"></i>`).join('')}</span>` : ''}
        </div>`;
      });
      html += `</div>`;
    }
    return html;
  }

  // 아래 목록 (휴대폰에서 주로 보는 곳): 날짜별로 묶음
  function agenda(month, events, selected) {
    const from = `${month}-01`;
    const [y, mo] = month.split('-').map(Number);
    const to = ymd(new Date(y, mo, 0));
    const byDay = new Map();
    for (const e of events) {
      // 여러 날 일정은 시작하는 날(또는 이 달 첫날)에 한 번만
      const k = e.start < from ? from : e.start;
      if (k > to) continue;
      if (selected && !(e.start <= selected && (e.end || e.start) >= selected)) continue;
      const key = selected || k;
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(e);
    }
    const days = [...byDay.keys()].sort();
    const todayK = ymd(new Date());
    const head = `<div class="agenda__head"><h2>${selected ? `${Number(selected.slice(8))}일 일정` : '이달 일정'}</h2>${selected ? '<button type="button" class="link-btn" id="agendaAll">이달 전체 보기</button>' : ''}</div>`;
    if (!days.length) return head + emptyState({ ic: 'calendar', title: selected ? '이 날은 일정이 없어요' : '이 달엔 보이는 일정이 없어요', desc: selected ? '' : '위에서 거르기 칩을 확인해 보세요' });
    return head + days.map((k) => {
      const d = parseDate(k);
      return `<div class="agenda__day${k === todayK ? ' is-today' : ''}">
        <div class="agenda__date"><b>${d.getDate()}</b><small>${WEEK[d.getDay()]}요일</small></div>
        <div class="agenda__list">${byDay.get(k).map((e) => `
          <button type="button" class="aev" data-ev="${esc(e.id)}">
            <i class="aev__bar ev-${evTone(e)}"></i>
            <span class="aev__body"><b>${esc(e.title)}</b><small>${esc([evWhen(e), e.place].filter(Boolean).join(' · '))}</small></span>
            <span class="aev__tag ev-${evTone(e)}">${esc(evLabel(e))}</span>
          </button>`).join('')}</div>
      </div>`;
    }).join('');
  }

  // 일정 하나 보기 (바텀시트)
  async function openEvent(e, perms, month) {
    if (!e) return;
    const can = e.scope === 'dept' ? perms.editDepts.includes(e.dept) : perms.editShared;
    const sh = openSheet({
      title: e.title,
      body: `<div class="evd">
        <span class="aev__tag ev-${evTone(e)}">${esc(evLabel(e))}</span>
        <p>${icon('calendar')}${esc(evWhen(e))}</p>
        ${e.place ? `<p>${icon('pin')}${esc(e.place)}</p>` : ''}
        ${e.note ? `<p class="evd__note">${esc(e.note)}</p>` : ''}
      </div>`,
      actions: can ? [{ label: '지우기', value: 'del', kind: 'danger' }, { label: '고치기', value: 'edit', kind: 'primary' }] : [{ label: '닫기', value: null }],
    });
    const v = await sh.result;
    if (v === 'edit') editEvent(e, perms, month);
    if (v === 'del') {
      if (!(await confirmSheet('일정을 지울까요?', `"${esc(e.title)}" 일정을 지우면 되돌릴 수 없어요.`, '지우기', 'danger'))) return;
      const r = await callApi('cal_delete', { event: { id: e.id, start: e.start, scope: e.scope, dept: e.dept } });
      if (r.status !== 'ok') return toast(`지우지 못했어요: ${errText(r)}`, { tone: 'error' });
      calCache.clear(); toast('일정을 지웠어요'); viewCalendar();
    }
  }

  // 일정 추가·고치기
  function scopeOptions(perms, cur) {
    const opts = [];
    if (perms.editShared) opts.push(['youth', '청년회'], ['church', '교회 전체']);
    perms.editDepts.forEach((d) => opts.push([`dept:${d}`, d]));
    return opts.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
  }
  const scopeValue = (e) => (e.scope === 'dept' ? `dept:${e.dept}` : e.scope);
  const splitScope = (v) => (v.startsWith('dept:') ? { scope: 'dept', dept: v.slice(5) } : { scope: v, dept: '' });
  async function editEvent(e, perms, month) {
    const today = ymd(new Date());
    const def = e || { scope: perms.editShared ? 'youth' : 'dept', dept: perms.editDepts[0] || '', start: today.startsWith(month) ? today : `${month}-01`, end: '', time: '', place: '', note: '', title: '' };
    const sh = openSheet({
      title: e ? '일정 고치기' : '일정 추가',
      body: `<form class="evform" id="evForm" novalidate>
        <label class="field"><span class="field__label">구분</span><select class="select" name="scope">${scopeOptions(perms, scopeValue(def))}</select></label>
        <label class="field"><span class="field__label">제목</span><input class="input" name="title" value="${esc(def.title)}" maxlength="80" placeholder="예: 청년회 전체교제"></label>
        <div class="grid-2">
          <label class="field"><span class="field__label">시작일</span><input class="input" type="date" name="start" value="${esc(def.start)}"></label>
          <label class="field"><span class="field__label">끝나는 날 <small class="muted">(하루면 비움)</small></span><input class="input" type="date" name="end" value="${esc(def.end && def.end !== def.start ? def.end : '')}"></label>
        </div>
        <div class="grid-2">
          <label class="field"><span class="field__label">시간</span><input class="input" name="time" value="${esc(def.time)}" maxlength="30" placeholder="예: 오후 4시"></label>
          <label class="field"><span class="field__label">장소</span><input class="input" name="place" value="${esc(def.place)}" maxlength="40" placeholder="예: 청년회실"></label>
        </div>
        <label class="field"><span class="field__label">메모</span><textarea class="textarea" name="note" rows="2" maxlength="300" placeholder="강사, 준비물 등">${esc(def.note)}</textarea></label>
        <p class="inline-error" id="evErr" role="alert" hidden></p>
      </form>`,
      actions: [{ label: '취소', value: null }, { label: '저장', value: 'save', kind: 'primary' }],
    });
    const form = sh.el.querySelector('#evForm');
    form.title.focus();
    // 저장 버튼을 눌러도 바로 닫히지 않게 가로채기
    const saveBtn = sh.el.querySelector('.btn--primary');
    saveBtn.onclick = async (ev) => {
      ev.stopPropagation();
      const err = sh.el.querySelector('#evErr');
      const fd = new FormData(form);
      const ev2 = {
        ...(e ? { id: e.id } : {}), ...splitScope(String(fd.get('scope') || '')),
        title: String(fd.get('title') || '').trim(), start: String(fd.get('start') || ''), end: String(fd.get('end') || ''),
        time: String(fd.get('time') || ''), place: String(fd.get('place') || ''), note: String(fd.get('note') || ''),
      };
      if (!ev2.title) { err.innerHTML = `${icon('alert')}제목을 적어 주세요`; err.hidden = false; form.title.focus(); return; }
      if (!ev2.start) { err.innerHTML = `${icon('alert')}날짜를 골라 주세요`; err.hidden = false; return; }
      if (ev2.end && ev2.end < ev2.start) { err.innerHTML = `${icon('alert')}끝나는 날이 시작일보다 빨라요`; err.hidden = false; return; }
      saveBtn.disabled = true; saveBtn.innerHTML = `${spinner}저장 중`;
      const r = await callApi('cal_save', { event: ev2, ...(e ? { orig: { start: e.start, scope: e.scope, dept: e.dept } } : {}) });
      if (r.status !== 'ok') { saveBtn.disabled = false; saveBtn.textContent = '저장'; err.innerHTML = `${icon('alert')}${esc(errText(r))}`; err.hidden = false; return; }
      sh.close();
      calCache.clear();
      state.calView = ev2.start.slice(0, 7);
      toast(e ? '일정을 고쳤어요' : '일정을 추가했어요');
      viewCalendar();
    };
  }

  // 여러 개 한 번에: "11/14 청년회 전체교제 (김반석 전도사)" "11/2~8 대전도집회"
  function parseBulk(text, year) {
    const out = [], bad = [];
    for (const raw of String(text).split('\n')) {
      const l = raw.trim();
      if (!l) continue;
      const m = l.match(/^(\d{1,2})[./월]\s*(\d{1,2})일?\s*(?:[~\-–]\s*(?:(\d{1,2})[./월]\s*)?(\d{1,2})일?)?\s+(.+)$/);
      if (!m) { bad.push(l); continue; }
      const [, m1, d1, m2, d2, rest] = m;
      const start = `${year}-${pad(m1)}-${pad(d1)}`;
      let end = '';
      if (d2) end = `${Number(m2 || m1) < Number(m1) ? year + 1 : year}-${pad(m2 || m1)}-${pad(d2)}`;
      const tm = rest.match(/\s*[[(]?\s*((?:오전|오후|저녁|아침)\s*\d{1,2}시(?:\s*\d{1,2}분)?|\d{1,2}:\d{2})\s*[\])]?\s*$/);
      out.push({ start, end, title: (tm ? rest.slice(0, tm.index) : rest).trim(), time: tm ? tm[1] : '' });
    }
    return { out, bad };
  }
  function bulkEvents(perms, month) {
    const year = Number(month.slice(0, 4));
    const sh = openSheet({
      title: '여러 개 붙여넣기',
      body: `<p class="sheet__text">한 줄에 일정 하나씩. 날짜로 시작하면 돼요.</p>
        <pre class="bulk-ex">11/14 청년회 전체교제 (김반석 전도사)
11/2~8 대전도집회 / 강사: 오세일 목사
11/23~27 청년 부서연합 전도집회</pre>
        <label class="field"><span class="field__label">구분 (이 목록 전체)</span><select class="select" id="bScope">${scopeOptions(perms, perms.editShared ? 'youth' : `dept:${perms.editDepts[0]}`)}</select></label>
        <textarea class="textarea" id="bText" rows="8" placeholder="11/14 청년회 전체교제"></textarea>
        <div id="bPrev" class="bulk-prev"></div>`,
      actions: [{ label: '취소', value: null }, { label: '저장', value: 'save', kind: 'primary' }],
    });
    const $t = sh.el.querySelector('#bText');
    const $p = sh.el.querySelector('#bPrev');
    const saveBtn = sh.el.querySelector('.btn--primary');
    const preview = () => {
      const { out, bad } = parseBulk($t.value, year);
      $p.innerHTML = (out.length ? `<b>${out.length}개 일정</b><ul>${out.map((e) => `<li><span>${esc(e.start.slice(5).replace('-', '/'))}${e.end ? `~${esc(e.end.slice(5).replace('-', '/'))}` : ''}</span>${esc(e.title)}${e.time ? ` <small>${esc(e.time)}</small>` : ''}</li>`).join('')}</ul>` : '')
        + (bad.length ? `<p class="inline-error">${icon('alert')}날짜를 못 읽은 줄 ${bad.length}개: ${esc(bad.slice(0, 2).join(' / '))}</p>` : '');
      saveBtn.disabled = !out.length;
      return out;
    };
    $t.addEventListener('input', preview);
    preview();
    $t.focus();
    saveBtn.onclick = async (ev) => {
      ev.stopPropagation();
      const list = preview();
      if (!list.length) return;
      const sc = splitScope(sh.el.querySelector('#bScope').value);
      saveBtn.disabled = true; saveBtn.innerHTML = `${spinner}저장 중`;
      const r = await callApi('cal_bulk', { events: list.map((e) => ({ ...e, ...sc })) });
      if (r.status !== 'ok') { saveBtn.disabled = false; saveBtn.textContent = '저장'; toast(`저장하지 못했어요: ${errText(r)}`, { tone: 'error' }); return; }
      sh.close(); calCache.clear(); toast(`일정 ${list.length}개를 추가했어요`); viewCalendar();
    };
  }

  // 이달 정보 (최고 관리자): 주제 · 안내 메모 · 월정표 원본 그림
  function editMonthMeta(month, meta) {
    const [y, mo] = month.split('-').map(Number);
    const sh = openSheet({
      title: `${y}년 ${mo}월 정보`,
      body: `<label class="field"><span class="field__label">주제</span><input class="input" id="mTheme" value="${esc(meta.theme || '')}" maxlength="80" placeholder="예: 상급, 영원한 영광"></label>
        <label class="field"><span class="field__label">이달 안내 <small class="muted">(부서별 배정, 봉사 순서 등)</small></span><textarea class="textarea" id="mMemo" rows="6" maxlength="3000" placeholder="믿음부 · 은장회실 · 대강당 청소&#10;11/1 봉사: 충성부(형제) 겸손부(자매)">${esc(meta.memo || '')}</textarea></label>
        <div class="field"><span class="field__label">월정표 원본 그림</span>
          <div class="btn-row"><button type="button" class="btn btn--sm" id="mImg">${icon('image')}${meta.image ? '그림 바꾸기' : '그림 올리기'}</button>${meta.image ? `<button type="button" class="btn btn--ghost btn--sm" id="mImgDel">${icon('trash')}지우기</button>` : ''}</div>
          <input type="file" id="mFile" accept="image/*" hidden></div>`,
      actions: [{ label: '취소', value: null }, { label: '저장', value: 'save', kind: 'primary' }],
    });
    const $f = sh.el.querySelector('#mFile');
    sh.el.querySelector('#mImg').onclick = () => $f.click();
    $f.onchange = async () => {
      const file = $f.files[0];
      if (!file) return;
      const b = sh.el.querySelector('#mImg');
      b.disabled = true; b.innerHTML = `${spinner}올리는 중`;
      const small = await shrink(file, 2000, 0.88);
      const fd = new FormData();
      fd.append('api', 'cal_img_put'); fd.append('hash', auth.hash); fd.append('month', month); fd.append('file', small.blob, 'month.jpg');
      const r = await send(fd);
      b.disabled = false; b.innerHTML = `${icon('image')}그림 바꾸기`;
      if (r.status !== 'ok') return toast(`그림을 올리지 못했어요: ${errText(r)}`, { tone: 'error' });
      monthImages.delete(month); calCache.delete(month);
      toast('월정표 그림을 올렸어요');
    };
    sh.el.querySelector('#mImgDel')?.addEventListener('click', async () => {
      const r = await callApi('cal_img_del', { month });
      if (r.status !== 'ok') return toast(`지우지 못했어요: ${errText(r)}`, { tone: 'error' });
      monthImages.delete(month); calCache.delete(month); toast('그림을 지웠어요'); sh.close(); viewCalendar();
    });
    sh.el.querySelector('.btn--primary').onclick = async (ev) => {
      ev.stopPropagation();
      const r = await callApi('cal_meta_save', { month, theme: sh.el.querySelector('#mTheme').value, memo: sh.el.querySelector('#mMemo').value });
      if (r.status !== 'ok') return toast(`저장하지 못했어요: ${errText(r)}`, { tone: 'error' });
      sh.close(); calCache.delete(month); toast('저장했어요'); viewCalendar();
    };
  }

  // 월정표 원본 그림 보기 (로그인 확인 후 받아서 크게 보기)
  const monthImages = new Map();
  async function showMonthImage(month) {
    let url = monthImages.get(month);
    if (!url) {
      try {
        const res = await fetch('/api/jbch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api: 'cal_img_get', params: { hash: auth.hash, month } }) });
        if (!(res.headers.get('Content-Type') || '').startsWith('image/')) return toast('그림을 불러오지 못했어요', { tone: 'error' });
        url = URL.createObjectURL(await res.blob());
        monthImages.set(month, url);
      } catch { return toast('그림을 불러오지 못했어요', { tone: 'error' }); }
    }
    lightbox([url], 0);
  }

  // 홈에 보여줄 다가오는 일정 (오늘부터 3개)
  async function upcoming(n = 3) {
    const today = ymd(new Date());
    const m = today.slice(0, 7);
    const rs = await Promise.all([loadMonth(m), loadMonth(addMonth(m, 1))]);
    if (rs[0].status !== 'ok') return null;
    const f = calFilter();
    const seen = new Set();
    return rs.flatMap((r) => r.events || []).filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return (e.end || e.start) >= today && passFilter(e, f);
    }).sort((a, b) => a.start.localeCompare(b.start)).slice(0, n);
  }

  /* ═══ 화면: 관리 (최고 관리자) — 부서 · 부서 관리자 · 명단 ═══ */
  async function viewAdmin() {
    if (!isAdmin()) return viewAdminOnly('관리');
    $app.innerHTML = `${pageHead('관리', '부서와 부서 관리자, 부서 명단을 정해요')}${skeletonCards(2)}`;
    const r = await callApi('cal_config_get');
    if (!document.querySelector('.page-head')) return;
    if (r.status !== 'ok') { $app.innerHTML = pageHead('관리') + emptyState({ ic: 'alert', title: '설정을 불러오지 못했어요', desc: esc(errText(r)) }); return; }
    const cfg = r.result || {};
    let depts = cfg.depts?.length ? cfg.depts : Object.keys(cfg.rosters || {});
    if (!depts.length) depts = ['믿음부', '소망부', '사랑부', '진리부', '충성부', '겸손부', '순종부'];
    $app.innerHTML = `
      ${pageHead('관리', '부서와 부서 관리자, 부서 명단을 정해요')}
      <section class="card wsec">
        <h2 class="wsec__title">부서 목록</h2>
        <p class="hint">쉼표로 구분해요. 순서대로 보여요.</p>
        <input class="input" id="aDepts" value="${esc(depts.join(', '))}">
      </section>
      <div id="aDeptCards" class="admin-depts"></div>
      <div class="actionbar"><button type="button" class="btn btn--primary btn--lg" id="aSave">${icon('check')}저장</button></div>`;
    const draw = () => {
      const list = document.getElementById('aDepts').value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      const keep = {};
      document.querySelectorAll('[data-dept]').forEach((c) => { keep[c.dataset.dept] = { a: c.querySelector('.aAdm').value, r: c.querySelector('.aRos').value }; });
      document.getElementById('aDeptCards').innerHTML = list.map((d) => {
        const admins = keep[d]?.a ?? (cfg.deptAdmins?.[d] || []).join(', ');
        const ros = keep[d]?.r ?? (cfg.rosters?.[d] || []).join('\n');
        const n = ros.split('\n').filter((s) => s.trim()).length;
        return `<section class="card wsec" data-dept="${esc(d)}">
          <h2 class="wsec__title"><i class="ddot t-${tone(d)}"></i>${esc(d)} <small>${n}명</small></h2>
          <label class="field"><span class="field__label">부서 관리자 깨사모 아이디 <small class="muted">(쉼표로 구분 · 이 사람들이 부서 일정을 올려요)</small></span><input class="input aAdm" value="${esc(admins)}" placeholder="예: hong123, kim456"></label>
          <label class="field"><span class="field__label">부서 명단 <small class="muted">(한 줄에 한 명 · 깨사모 이름과 같게 · 이 사람들이 부서 일정을 봐요)</small></span><textarea class="textarea aRos" rows="5" placeholder="김민수b&#10;이다정s">${esc(ros)}</textarea></label>
        </section>`;
      }).join('');
    };
    draw();
    document.getElementById('aDepts').addEventListener('change', draw);
    document.getElementById('aSave').onclick = async (e) => {
      const b = e.currentTarget;
      const list = document.getElementById('aDepts').value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      const deptAdmins = {}, rost = {};
      document.querySelectorAll('[data-dept]').forEach((c) => {
        deptAdmins[c.dataset.dept] = c.querySelector('.aAdm').value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
        rost[c.dataset.dept] = c.querySelector('.aRos').value.split('\n').map((s) => s.trim()).filter(Boolean);
      });
      b.disabled = true; b.innerHTML = `${spinner}저장 중`;
      const r2 = await callApi('cal_config_save', { depts: list, deptAdmins, rosters: rost });
      b.disabled = false; b.innerHTML = `${icon('check')}저장`;
      if (r2.status !== 'ok') return toast(`저장하지 못했어요: ${errText(r2)}`, { tone: 'error' });
      state.rosters = null; calCache.clear();
      toast('저장했어요');
    };
  }

  /* ═══ 화면: 번개 모임 (형제 번개 · 자매 번개 따로) ═══════
   * 어느 게시판인지는 서버가 깨사모 회원정보의 성별로 정해요. 다른 쪽 게시판은 볼 수 없어요.
   */
  const bgWhen = (m) => {
    const d = parseDate(m.date);
    if (!d) return '';
    const t = m.time ? ` ${Number(m.time.slice(0, 2)) < 12 ? '오전' : '오후'} ${((Number(m.time.slice(0, 2)) + 11) % 12) + 1}시${m.time.slice(3) !== '00' ? ` ${Number(m.time.slice(3))}분` : ''}` : '';
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})${t}`;
  };
  const mapLink = (m) => m.placeUrl || (m.place ? `https://map.naver.com/p/search/${encodeURIComponent(m.place)}` : '');
  const daysLeft = (m) => Math.round((parseDate(m.date) - parseDate(ymd(new Date()))) / 86400e3);
  function bgStatus(m) {
    if (m.closed) return daysLeft(m) < 0 ? ['past', '지난 번개'] : ['closed', '마감'];
    if (m.cap && m.count >= m.cap) return ['closed', '정원 마감'];
    if (m.cap && m.cap - m.count <= 2) return ['soon', `${m.cap - m.count}자리 남음`];
    const d = daysLeft(m);
    return ['open', d === 0 ? '오늘' : d === 1 ? '내일' : '모집 중'];
  }
  const peopleStack = (names, n) => `<span class="stack">${names.slice(0, 4).map((nm) => avatar(nm, '', 'xs')).join('')}${n > 4 ? `<span class="stack__more">+${n - 4}</span>` : ''}</span>`;

  let bgTab = 'up';
  async function viewMeetups() {
    $app.innerHTML = `
      <header class="page-head"><div><h1>번개</h1><p id="bgSub">함께 밥 먹고, 운동하고, 놀러 가요</p></div>
        <button type="button" class="btn btn--primary btn--sm" id="bgNew">${icon('plus')}번개 열기</button></header>
      <div class="seg seg--full" id="bgTabs" role="group" aria-label="번개 보기">
        <button type="button" data-t="up" aria-pressed="${bgTab === 'up'}">다가오는 번개</button>
        <button type="button" data-t="past" aria-pressed="${bgTab === 'past'}">지난 번개</button>
      </div>
      <div id="bgList">${skeletonCards(3)}</div>`;
    document.getElementById('bgNew').onclick = () => editMeetup(null);
    document.getElementById('bgTabs').onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) { bgTab = b.dataset.t; viewMeetups(); } };
    const r = await callApi('bg_list');
    const $l = document.getElementById('bgList');
    if (!$l) return;
    if (r.status !== 'ok') { $l.innerHTML = emptyState({ ic: 'alert', title: '번개를 불러오지 못했어요', desc: esc(errText(r)) }); return; }
    document.getElementById('bgSub').innerHTML = `<span class="board-pill">${icon('lock')}${esc(r.boardName)} 번개</span> ${esc(r.boardName)}끼리만 보는 게시판이에요`;
    const today = ymd(new Date());
    const items = r.items.filter((m) => (bgTab === 'up' ? m.date >= today : m.date < today))
      .sort((a, b) => (bgTab === 'up' ? 1 : -1) * (a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '')));
    if (!items.length) {
      $l.innerHTML = bgTab === 'up'
        ? emptyState({ ic: 'zap', title: '다가오는 번개가 없어요', desc: '먼저 번개를 열어 보세요. 날짜와 장소만 정하면 돼요.', action: `<button type="button" class="btn btn--primary btn--sm" id="bgNew2">${icon('plus')}번개 열기</button>` })
        : emptyState({ ic: 'zap', title: '지난 번개가 없어요' });
      document.getElementById('bgNew2')?.addEventListener('click', () => editMeetup(null));
      return;
    }
    $l.innerHTML = `<div class="feed">${items.map((m, i) => {
      const [st, label] = bgStatus(m);
      const d = parseDate(m.date);
      const canJoin = bgTab === 'up' && (m.joined || st === 'open' || st === 'soon');
      return `<article class="bg card${reduceMotion() ? '' : ' rise'}" style="--i:${Math.min(i, 8)}">
        <a class="bg__main" href="#/meetup/${encodeURIComponent(m.id)}">
          <span class="bg__date"><b>${d.getDate()}</b><small>${d.getMonth() + 1}월 ${WEEK[d.getDay()]}</small></span>
          <span class="bg__body">
            <span class="bg__tags"><span class="bgst bgst--${st}">${esc(label)}</span>${m.review ? '<span class="bgst bgst--review">후기</span>' : ''}</span>
            <b class="bg__title">${esc(m.title)}</b>
            <small>${icon('clock')}${esc(bgWhen(m))}${m.place ? ` · ${esc(m.place)}` : ''}</small>
          </span>
        </a>
        <div class="bg__foot">
          ${peopleStack(m.people || [], m.count)}
          <span class="bg__count">${m.count}${m.cap ? `/${m.cap}` : ''}명 함께해요</span>
          ${canJoin ? `<button type="button" class="btn btn--sm ${m.joined ? 'btn--joined' : 'btn--primary'}" data-join="${esc(m.id)}" data-on="${m.joined ? '' : '1'}">${m.joined ? `${icon('check')}참여 중` : '나도 갈래'}</button>` : ''}
        </div>
      </article>`;
    }).join('')}</div>`;
    $l.querySelectorAll('[data-join]').forEach((b) => {
      b.onclick = async () => {
        const on = !!b.dataset.on;
        if (!on && !(await confirmSheet('참여를 취소할까요?', '취소해도 다시 "나도 갈래"를 누를 수 있어요.', '취소하기', 'danger'))) return;
        b.disabled = true; b.innerHTML = spinner;
        const res = await callApi('bg_join', { id: b.dataset.join, on });
        if (res.status !== 'ok') { toast(errText(res), { tone: 'error' }); }
        else toast(on ? '참여했어요' : '참여를 취소했어요');
        viewMeetups();
      };
    });
  }

  async function viewMeetup(id) {
    const back = `<a class="back" href="#/meetup">${icon('left')}번개</a>`;
    $app.innerHTML = `${back}${skeletonCards(1)}`;
    const r = await callApi('bg_get', { id });
    if (!document.querySelector('.back')) return;
    if (r.status !== 'ok') { $app.innerHTML = back + emptyState({ ic: 'alert', title: '번개를 찾을 수 없어요', desc: esc(errText(r)) }); return; }
    const m = r.item;
    const joined = r.joins.some((j) => j.userid === r.me.userid);
    const full = m.cap && r.joins.length >= m.cap;
    const past = m.date < ymd(new Date());
    const st = m.closedNow ? (past ? ['past', '지난 번개'] : ['closed', '마감']) : full ? ['closed', '정원 마감'] : ['open', '모집 중'];
    const link = mapLink(m);
    const isMine = r.me.userid === m.by.userid;
    $app.innerHTML = `
      ${back}
      <article class="card detail bgd">
        <div class="bgd__top"><span class="bgst bgst--${st[0]}">${st[1]}</span><span class="board-pill">${icon('lock')}${esc(r.boardName)} 번개</span></div>
        <h1 class="detail__title">${esc(m.title)}</h1>
        <div class="detail__by">${avatar(m.by.name)}<div><b>${esc(m.by.name)}</b><span>번개를 열었어요${m.edited ? ' · 고침' : ''}</span></div></div>
        <ul class="bgd__info">
          <li>${icon('calendar')}<span><b>${esc(bgWhen(m))}</b>${!past ? `<small>${daysLeft(m) === 0 ? '오늘이에요' : `${daysLeft(m)}일 남았어요`}</small>` : ''}</span></li>
          ${m.place ? `<li>${icon('pin')}<span><b>${esc(m.place)}</b>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener" class="link-btn">지도 보기${icon('external')}</a>` : ''}</span></li>` : ''}
          <li>${icon('users')}<span><b>${r.joins.length}${m.cap ? ` / ${m.cap}` : ''}명</b><small>${m.cap ? (full ? '정원이 다 찼어요' : `${m.cap - r.joins.length}자리 남았어요`) : '정원 없음'}</small></span></li>
          ${m.deadline ? `<li>${icon('clock')}<span><b>${esc(m.deadline.slice(5, 10).replace('-', '/'))} ${esc(m.deadline.slice(11))} 마감</b></span></li>` : ''}
        </ul>
        ${m.note ? `<p class="sec__text bgd__note">${esc(m.note)}</p>` : ''}
        <section class="sec"><h2>${icon('users')}함께하는 사람<small>${r.joins.length}명</small></h2>
          <div class="people">${r.joins.map((j) => `<span class="person">${esc(j.name)}${j.userid === m.by.userid ? ' <small>· 연 사람</small>' : ''}</span>`).join('')}</div>
        </section>
        ${m.review || (past && r.isOwner) ? `<section class="sec"><h2>${icon('pen')}후기</h2>
          ${m.review ? `<p class="sec__text">${esc(m.review)}</p>` : '<p class="hint">번개가 끝났어요. 후기를 남겨 보세요.</p>'}
          <div class="btn-row" style="margin-top:10px">
            ${r.isOwner ? `<button type="button" class="btn btn--sm" id="bgReview">${icon('pen')}${m.review ? '후기 고치기' : '후기 쓰기'}</button>` : ''}
            ${m.review ? `<button type="button" class="btn btn--sm" id="bgToLog">${icon('book')}교제록에 넣기</button>` : ''}
          </div></section>` : ''}
        <section class="sec" id="bgComments"></section>
        ${r.isOwner ? `<div class="bgd__owner">
          <button type="button" class="btn btn--ghost btn--sm" id="bgEdit">${icon('pen')}고치기</button>
          ${!past ? `<button type="button" class="btn btn--ghost btn--sm" id="bgClose">${m.closed ? '다시 모집하기' : '마감하기'}</button>` : ''}
          <button type="button" class="btn btn--ghost btn--sm danger-text" id="bgDel">${icon('trash')}지우기</button>
        </div>` : ''}
      </article>
      ${!past ? `<div class="actionbar actionbar--center">
        ${joined
          ? (isMine ? `<span class="hint">내가 연 번개예요</span>` : `<button type="button" class="btn btn--lg btn--joined" id="bgJoin" data-on="">${icon('check')}참여 중 · 취소하기</button>`)
          : `<button type="button" class="btn btn--primary btn--lg" id="bgJoin" data-on="1"${m.closedNow || full ? ' disabled' : ''}>${m.closedNow || full ? '마감됐어요' : '나도 갈래'}</button>`}
      </div>` : ''}`;

    document.getElementById('bgJoin')?.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      const on = !!b.dataset.on;
      if (!on && !(await confirmSheet('참여를 취소할까요?', '취소해도 다시 "나도 갈래"를 누를 수 있어요.', '취소하기', 'danger'))) return;
      b.disabled = true; b.innerHTML = `${spinner}${on ? '참여하는 중' : '취소하는 중'}`;
      const res = await callApi('bg_join', { id, on });
      if (res.status !== 'ok') toast(errText(res), { tone: 'error' }); else toast(on ? '참여했어요' : '참여를 취소했어요');
      viewMeetup(id);
    });
    document.getElementById('bgEdit')?.addEventListener('click', () => editMeetup(m));
    document.getElementById('bgClose')?.addEventListener('click', async () => {
      const res = await callApi('bg_close', { id, closed: !m.closed });
      if (res.status !== 'ok') return toast(errText(res), { tone: 'error' });
      toast(m.closed ? '다시 모집해요' : '마감했어요'); viewMeetup(id);
    });
    document.getElementById('bgDel')?.addEventListener('click', async () => {
      if (!(await confirmSheet('번개를 지울까요?', '참여자와 댓글도 함께 지워지고 되돌릴 수 없어요.', '지우기', 'danger'))) return;
      const res = await callApi('bg_delete', { id });
      if (res.status !== 'ok') return toast(errText(res), { tone: 'error' });
      toast('번개를 지웠어요'); location.hash = '#/meetup';
    });
    document.getElementById('bgReview')?.addEventListener('click', async () => {
      const sh = openSheet({
        title: '후기',
        body: `<textarea class="textarea" id="rvText" rows="6" maxlength="2000" placeholder="어땠는지 짧게 남겨 주세요">${esc(m.review || '')}</textarea>`,
        actions: [{ label: '취소', value: null }, { label: '저장', value: 'save', kind: 'primary' }],
      });
      if ((await sh.result) !== 'save') return;
      const res = await callApi('bg_review', { id, review: sh.el.querySelector('#rvText').value });
      if (res.status !== 'ok') return toast(errText(res), { tone: 'error' });
      toast('후기를 남겼어요'); viewMeetup(id);
    });
    // 후기를 이번 주 교제록 "기타"에 넣기
    document.getElementById('bgToLog')?.addEventListener('click', () => {
      const d = store.get('draft', null) || { date: ymd(new Date()), writer: auth.me?.name || '', people: [], extra: '', verse: '', verseNote: '', share: '', prayers: {}, etc: '' };
      const line = `⚡ 번개 · ${m.title} (${bgWhen(m)}${m.place ? `, ${m.place}` : ''}) — ${r.joins.length}명\n${m.review}`;
      d.etc = [d.etc || d.bungae || '', line].filter(Boolean).join('\n\n');
      store.set('draft', d);
      toast('교제록 "기타"에 넣었어요');
      location.hash = '#/write';
    });
    drawBgComments(id, r);
  }

  function drawBgComments(id, r) {
    const $c = document.getElementById('bgComments');
    const list = r.comments;
    const draw = () => {
      $c.innerHTML = `<h2>${icon('msg')}댓글<small>${list.length || ''}</small></h2>
        <ul class="cmts">${list.length ? list.map((x) => {
          const mine = x.userid === r.me.userid;
          return `<li class="${x.pending ? 'is-pending' : ''}">${avatar(x.name, '', 'sm')}<div class="cmt__body"><div class="cmt__head"><b>${esc(x.name)}</b><time>${x.pending ? '보내는 중' : esc(rel(x.at ? new Date(x.at) : null))}</time>${mine && !x.pending ? `<button type="button" class="cmt__del" data-del="${esc(x.cid)}" aria-label="내 댓글 지우기">${icon('trash')}</button>` : ''}</div><p>${esc(x.text)}</p></div></li>`;
        }).join('') : '<li class="cmt__empty">"저도 갈게요" 처럼 한마디 남겨 보세요</li>'}</ul>
        <form class="cmt-form" id="bgCmtForm">${avatar(r.me.name, '', 'sm')}
          <div class="cmt-form__box"><textarea name="t" rows="1" maxlength="200" placeholder="댓글 남기기" aria-label="댓글"></textarea>
          <button class="cmt-form__send" type="submit" aria-label="댓글 등록" disabled>${icon('send')}</button></div></form>`;
      const $f = document.getElementById('bgCmtForm');
      const $t = $f.t;
      const $s = $f.querySelector('button');
      const size = () => { if (!$t.value) { $t.style.height = ''; return; } $t.style.height = '0px'; $t.style.height = `${Math.min(Math.max($t.scrollHeight, 34), 120)}px`; };
      $t.addEventListener('input', () => { size(); $s.disabled = !$t.value.trim(); });
      $f.onsubmit = async (e) => {
        e.preventDefault();
        const text = $t.value.trim();
        if (!text) return;
        const temp = { cid: 'tmp', name: r.me.name, userid: r.me.userid, text, pending: true };
        list.push(temp); draw();
        const res = await callApi('bg_comment', { id, text });
        const i = list.indexOf(temp);
        if (res.status !== 'ok') { list.splice(i, 1); draw(); document.querySelector('#bgCmtForm textarea').value = text; toast(errText(res), { tone: 'error' }); return; }
        list[i] = { ...temp, pending: false, cid: res.result.cid, at: new Date().toISOString() };
        draw();
      };
      $c.querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async () => {
          if (!(await confirmSheet('댓글을 지울까요?', '지운 댓글은 되돌릴 수 없어요.', '지우기', 'danger'))) return;
          const i = list.findIndex((x) => x.cid === b.dataset.del);
          const [gone] = list.splice(i, 1); draw();
          const res = await callApi('bg_comment_del', { id, cid: gone.cid });
          if (res.status !== 'ok') { list.splice(i, 0, gone); draw(); toast(errText(res), { tone: 'error' }); }
        };
      });
    };
    draw();
  }

  // 번개 열기 · 고치기
  function editMeetup(m) {
    const tomorrow = ymd(new Date(Date.now() + 86400e3));
    const d = m || { title: '', date: tomorrow, time: '19:00', place: '', placeUrl: '', cap: '', deadline: '', note: '' };
    const sh = openSheet({
      title: m ? '번개 고치기' : '번개 열기',
      body: `<form class="evform" id="bgForm" novalidate>
        <label class="field"><span class="field__label">무엇을 할까요</span><input class="input" name="title" value="${esc(d.title)}" maxlength="60" placeholder="예: 금요일 저녁 마라탕 번개"></label>
        <div class="grid-2">
          <label class="field"><span class="field__label">날짜</span><input class="input" type="date" name="date" value="${esc(d.date)}" min="${m ? '' : ymd(new Date())}"></label>
          <label class="field"><span class="field__label">시간</span><input class="input" type="time" name="time" value="${esc(d.time)}" step="600"></label>
        </div>
        <label class="field"><span class="field__label">장소</span><input class="input" name="place" value="${esc(d.place)}" maxlength="60" placeholder="예: 라페스타 마라공방"></label>
        <label class="field"><span class="field__label">장소 링크 <small class="muted">(선택 · 비우면 장소 이름으로 지도 검색)</small></span><input class="input" name="placeUrl" value="${esc(d.placeUrl)}" placeholder="https://naver.me/..."></label>
        <div class="grid-2">
          <label class="field"><span class="field__label">정원 <small class="muted">(선택)</small></span><input class="input" type="number" name="cap" value="${esc(d.cap || '')}" min="0" max="200" inputmode="numeric" placeholder="제한 없음"></label>
          <label class="field"><span class="field__label">마감 <small class="muted">(선택)</small></span><input class="input" type="datetime-local" name="deadline" value="${esc(d.deadline)}"></label>
        </div>
        <label class="field"><span class="field__label">하고 싶은 말</span><textarea class="textarea" name="note" rows="3" maxlength="1000" placeholder="회비, 준비물, 누구나 환영 등">${esc(d.note)}</textarea></label>
        <p class="inline-error" id="bgErr" role="alert" hidden></p>
      </form>`,
      actions: [{ label: '취소', value: null }, { label: m ? '저장' : '번개 열기', value: 'save', kind: 'primary' }],
    });
    const f = sh.el.querySelector('#bgForm');
    f.title.focus();
    const btn = sh.el.querySelector('.btn--primary');
    btn.onclick = async () => {
      const err = sh.el.querySelector('#bgErr');
      const fd = new FormData(f);
      const v = Object.fromEntries(fd.entries());
      const bad = (msg, el) => { err.innerHTML = `${icon('alert')}${msg}`; err.hidden = false; el?.focus(); };
      if (!String(v.title).trim()) return bad('무엇을 할지 적어 주세요', f.title);
      if (!v.date) return bad('날짜를 골라 주세요', f.date);
      if (v.placeUrl && !/^https:\/\//.test(v.placeUrl)) return bad('장소 링크는 https:// 로 시작해야 해요', f.placeUrl);
      if (v.deadline && v.deadline.slice(0, 10) > v.date) return bad('마감은 번개 날짜보다 늦을 수 없어요', f.deadline);
      btn.disabled = true; btn.innerHTML = `${spinner}저장 중`;
      const res = await callApi('bg_save', { id: m?.id || '', meetup: v });
      if (res.status !== 'ok') { btn.disabled = false; btn.textContent = m ? '저장' : '번개 열기'; return bad(esc(errText(res))); }
      sh.close();
      toast(m ? '고쳤어요' : '번개를 열었어요');
      location.hash = `#/meetup/${encodeURIComponent(res.result.id)}`;
      if (m) viewMeetup(m.id);
    };
  }

  /* ─── 관리자 (Cloudflare 환경 변수 ADMINS 에 아이디가 있는 사람) ─── */
  const isAdmin = () => !!(auth.hash && auth.me?.admin);
  function viewAdminOnly(title = '참석 흐름') {
    $app.innerHTML = pageHead(title) + emptyState({ ic: 'lock', title: '관리자만 볼 수 있어요', desc: '청년회 관리자에게 권한을 받으면 볼 수 있어요' });
  }

  /* ═══ 화면: 앨범 (교회 사이트 청년회 앨범 게시판) ═══════════
   * 목록은 use_kind=3, 사진 목록(files)은 use_kind=1 상세에서만 옴.
   * 앨범 글은 대개 세로로 긴 포토스토리 한 장 → 목록엔 작은 그림(sum_), 상세에선 원본.
   */
  const ALBUMS = C.albums || [];
  const albumState = {}; // 게시판 → { items, page, done }
  let albumTab = ALBUMS[0]?.boardId;
  const thumbOf = (u) => String(u || '').replace(/\/([^/]+)$/, '/sum_$1');
  const albumDate = (s) => { const d = s ? new Date(String(s).replace(' ', 'T')) : null; return d && !isNaN(d) ? d : null; };
  const albumItem = (x) => ({
    id: String(x.postUid || x.uid), board: String(x.position || albumTab), title: String(x.subject || '').trim(),
    date: albumDate(x.created), cover: x.filepath || '', hits: Number(x.hit) || 0, comments: Number(x.total_comment) || 0, likes: Number(x.total_good) || 0,
  });
  async function loadAlbums(board, more) {
    const s = albumState[board] || (albumState[board] = { items: [], page: 0, done: false });
    if (s.items.length && !more) return s;
    const r = await callApi('board_post', { chId: C.board.chId, flag: 1, use_kind: 3, boardId: board, page: s.page + 1, limit: 24 });
    if (r.status === 'not') { s.done = true; return s; }
    if (r.status !== 'ok' || !Array.isArray(r.result)) { s.error = errText(r); return s; }
    s.error = '';
    s.page += 1;
    const seen = new Set(s.items.map((x) => x.id));
    r.result.map(albumItem).forEach((x) => { if (!seen.has(x.id)) s.items.push(x); });
    if (r.result.length < 24) s.done = true;
    return s;
  }
  // 새 앨범 표시: 지난번 앨범 탭을 본 뒤에 올라온 글 (처음 쓰는 기기에선 표시 안 함)
  const albumSeenPrev = store.get('albumSeenAt', 0);
  if (!albumSeenPrev) store.set('albumSeenAt', Date.now()); // 처음 쓰는 기기: 지금부터 올라오는 걸 새 글로
  let albumViewed = false;
  const isNewAlbum = (a) => albumSeenPrev && a.date && a.date.getTime() > albumSeenPrev;
  let albumChecked = false;
  async function checkNewAlbums() {
    if (albumChecked || !ALBUMS.length) return;
    albumChecked = true;
    const all = await Promise.all(ALBUMS.map((b) => loadAlbums(b.boardId)));
    if (albumViewed) return; // 그사이 앨범 탭을 봤으면 끝
    state.albumNew = all.flatMap((s) => s.items).filter(isNewAlbum).length;
    if (state.albumNew && auth.hash) renderChrome(chromeTab);
  }
  const albumCard = (a) => `<a class="alb" href="#/album/${encodeURIComponent(a.id)}">
      <span class="alb__pic">${a.cover ? `<img src="${esc(thumbOf(a.cover))}" alt="" loading="lazy" decoding="async" onload="this.classList.add('loaded')" onerror="this.remove()">` : ''}${isNewAlbum(a) ? '<span class="tag tag--new alb__new">새 글</span>' : ''}</span>
      <span class="alb__txt"><b>${esc(a.title)}</b><small>${a.date ? `${a.date.getFullYear()}. ${a.date.getMonth() + 1}. ${a.date.getDate()}.` : ''}${a.likes ? ` · ${icon('thumb')}${a.likes}` : ''}${a.comments ? ` · ${icon('msg')}${a.comments}` : ''}</small></span>
    </a>`;
  async function viewAlbums() {
    if (!ALBUMS.length) { $app.innerHTML = pageHead('앨범') + emptyState({ ic: 'image', title: '연결된 앨범이 없어요' }); return; }
    $app.innerHTML = `
      ${pageHead('앨범', '포토스토리와 행사 사진을 모아 봐요')}
      ${ALBUMS.length > 1 ? `<div class="seg seg--full" id="albTabs" role="group" aria-label="앨범 고르기">${ALBUMS.map((b) => `<button type="button" data-b="${esc(b.boardId)}" aria-pressed="${String(b.boardId) === String(albumTab)}">${esc(b.name)}</button>`).join('')}</div>` : ''}
      <div id="albList"><div class="albs">${Array.from({ length: 6 }, () => '<span class="alb alb--sk"><span class="alb__pic sk"></span><span class="sk sk-line"></span></span>').join('')}</div></div>`;
    document.getElementById('albTabs')?.addEventListener('click', (e) => { const b = e.target.closest('[data-b]'); if (b) { albumTab = b.dataset.b; viewAlbums(); } });
    const board = albumTab;
    // 앨범 탭을 봤으니 새 글 표시는 지움 (이번에 보는 목록의 '새 글' 딱지는 그대로)
    store.set('albumSeenAt', Date.now());
    albumChecked = true; albumViewed = true;
    if (state.albumNew) { state.albumNew = 0; renderChrome('album'); }
    const s = await loadAlbums(board);
    const draw = () => {
      const $l = document.getElementById('albList');
      if (!$l || board !== albumTab) return;
      if (!s.items.length) {
        $l.innerHTML = s.error ? emptyState({ ic: 'alert', title: '앨범을 불러오지 못했어요', desc: esc(s.error) }) : emptyState({ ic: 'image', title: '아직 올라온 앨범이 없어요' });
        return;
      }
      $l.innerHTML = `<div class="albs">${s.items.map(albumCard).join('')}</div>
        ${s.done ? '' : `<div class="more"><button type="button" class="btn" id="albMore">더 보기</button></div>`}`;
      document.getElementById('albMore')?.addEventListener('click', async (e) => {
        e.target.disabled = true; e.target.textContent = '불러오는 중…';
        await loadAlbums(board, true);
        draw();
      });
    };
    draw();
  }
  async function viewAlbum(id) {
    const back = `<a class="back" href="#/album">${icon('left')}앨범</a>`;
    $app.innerHTML = `${back}<div class="card detail"><span class="sk sk-line" style="width:30%"></span><span class="sk sk-line" style="width:80%;height:24px"></span><span class="alb-sk sk"></span></div>`;
    const known = Object.values(albumState).flatMap((s) => s.items).find((x) => x.id === id);
    const board = known?.board || albumTab;
    const r = await callApi('board_post', { chId: C.board.chId, flag: 1, use_kind: 1, boardId: board, uid: id });
    if (!document.querySelector('.detail')) return;
    const row = (Array.isArray(r.result) ? r.result : []).find((x) => String(x.postUid) === id);
    if (r.status !== 'ok' || !row) { $app.innerHTML = back + emptyState({ ic: 'alert', title: '앨범을 찾을 수 없어요', desc: r.status === 'ok' ? '지워졌거나 볼 수 없는 글이에요' : esc(errText(r)) }); return; }
    const a = { ...albumItem(row), author: row.username || '' };
    const files = (row.files || []).filter((f) => /^(jpe?g|png|gif|webp)$/i.test(f.extention || '') && f.filepath).sort((x, y) => (Number(x.sort_no) || 0) - (Number(y.sort_no) || 0));
    const pics = files.length ? files.map((f) => f.filepath) : (a.cover ? [a.cover] : []);
    const mb = files.reduce((n, f) => n + (Number(f.filesize) || 0), 0) / 1e6;
    const text = htmlToText(row.content || '').trim();
    $app.innerHTML = `
      ${back}
      <article class="card detail">
        <h1 class="detail__title">${esc(a.title)}</h1>
        <div class="detail__by">
          ${avatar(a.author)}
          <div><b>${esc(a.author || '청년회')}</b><span>${fullDate(a.date)}${a.hits ? ` · 조회 ${a.hits}` : ''}</span></div>
        </div>
        ${text ? `<p class="sec__text">${esc(text)}</p>` : ''}
        ${pics.length ? `${mb >= 8 ? `<p class="hint alb-note">${icon('image')}사진이 커서(${Math.round(mb)}MB) 천천히 보일 수 있어요</p>` : ''}
          <div class="alb-pics">${pics.map((u, i) => `<button type="button" class="alb-pic" data-photo="${i}" aria-label="사진 ${i + 1} 크게 보기"><img src="${esc(u)}" alt="" loading="${i ? 'lazy' : 'eager'}" decoding="async" style="background-image:url('${esc(thumbOf(u))}')" onload="this.classList.add('loaded')"></button>`).join('')}</div>`
          : '<p class="muted">사진이 없어요</p>'}
        <div class="react">${likeBtn(a.id, a.likes)}<span class="react__hint">마음에 들면 좋아요를 눌러 주세요</span></div>
        <section class="sec" id="comments"></section>
      </article>`;
    $app.querySelectorAll('[data-photo]').forEach((b) => { b.onclick = () => lightbox(pics, Number(b.dataset.photo)); });
    checkLikes([a.id]);
    drawComments({ id: a.id, comments: a.comments, link: `${location.origin}/#/album/${a.id}` });
  }

  /* ─── 틀: 위쪽 바 · 왼쪽 메뉴 · 아래 탭 ─── */
  const NAV = () => [
    ['list', '#/', '홈', 'book'],
    ['calendar', '#/calendar', '일정', 'calendar'],
    ['meetup', '#/meetup', '번개', 'zap'],
    ['write', '#/write', '쓰기', 'pen'],
    ['prayers', '#/prayers', '기도제목', 'heart'],
    ...(ALBUMS.length ? [['album', '#/album', '앨범', 'image']] : []),
    ...(isAdmin() ? [['attendance', '#/attendance', '참석 흐름', 'chart'], ['admin', '#/admin', '관리', 'users']] : []),
    ['settings', '#/settings', '내 정보', 'user'],
  ];
  const brandMark = '<img class="mark" src="/assets/church-mark.png" alt="" aria-hidden="true" width="52" height="36">';
  const newCount = () => (state.posts || []).filter(isNew).length;
  let chromeTab = 'list';
  function renderChrome(tab) {
    chromeTab = tab;
    const items = NAV();
    const me = auth.me;
    const n = newCount();
    const counts = { list: n, album: state.albumNew || 0 };
    const badge = (k) => (counts[k] ? `<span class="badge" aria-label="새 글 ${counts[k]}개">${counts[k] > 99 ? '99+' : counts[k]}</span>` : '');
    document.title = tab === 'list' ? APP : `${({ prayers: '기도제목', write: '교제록 쓰기', attendance: '참석 흐름', settings: '내 정보', calendar: '일정', admin: '관리', meetup: '번개', album: '앨범' })[tab] || '교제록'} · ${APP}`;
    const $top = document.getElementById('topbar');
    if (!document.getElementById('gq')) $top.innerHTML = `
      <a class="brand" href="#/">${brandMark}<span>${esc(APP)}</span></a>
      <label class="gsearch">${icon('search')}<input id="gq" type="search" placeholder="교제록 찾기 · 이름, 말씀, 나눔" value="${esc(state.q)}" autocomplete="off" enterkeyhint="search"><kbd>/</kbd></label>
      <div class="topbar__right">
        <a class="btn btn--primary topbar__write" id="writeBtn" href="#/write">${icon('pen')}<span>교제록 쓰기</span></a>
        <a class="topbar__me" href="#/settings" aria-label="내 정보">${avatar(me?.name, '', 'sm')}</a>
      </div>`;
    const $gq = document.getElementById('gq');
    if (!$gq.dataset.bound) $gq.dataset.bound = '1', $gq.addEventListener('input', () => {
      state.q = $gq.value.trim();
      if (location.hash.replace(/^#\/?/, '') !== '') { location.hash = '#/'; return; }
      syncSearchBoxes();
      listRedraw?.();
    });
    document.getElementById('side').innerHTML = `
      <nav class="nav" aria-label="메뉴">${items.map(([k, href, label, ic]) => `<a href="${href}"${k === tab ? ' aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${badge(k)}</a>`).join('')}</nav>
      <div class="nav-group" id="sideDepts"></div>
      <div class="nav-group">
        <div class="nav-group__head"><span>바로가기</span></div>
        <a class="nav-sub" href="${esc(C.board.siteUrl)}" target="_blank" rel="noopener">${icon('external')}<span>교회 사이트 교제실</span></a>
      </div>
      <a class="side__me" href="#/settings">${avatar(me?.name, '', 'sm')}<span><b>${esc(me?.name || '')}</b><small>${esc(me?.church || '')}</small></span>${icon('right', 'ic--end')}</a>`;
    // 휴대폰 아래 탭은 다섯 개만 (쓰기는 홈의 쓰기 칸, 참석 흐름·관리는 내 정보에서)
    document.getElementById('tabbar').innerHTML = items.filter(([k]) => !['attendance', 'admin', 'write'].includes(k)).map(([k, href, label, ic]) =>
      `<a href="${href}"${k === tab ? ' aria-current="page"' : ''}${k === 'write' ? ' id="writeTab"' : ''}>${icon(ic)}<span>${label}</span>${counts[k] ? '<i class="dotbadge" aria-hidden="true"></i>' : ''}</a>`).join('');
    renderSideDepts();
  }
  // 왼쪽 메뉴의 "부서" 묶음 (접었다 펼 수 있음)
  function renderSideDepts() {
    const el = document.getElementById('sideDepts');
    if (!el) return;
    const posts = state.posts || [];
    const depts = [...new Set(posts.map((p) => p.dept))];
    if (!depts.length) { el.innerHTML = ''; return; }
    const open = store.get('deptOpen', true);
    el.innerHTML = `
      <button type="button" class="nav-group__head" aria-expanded="${open}"><span>부서</span>${icon('right', 'nav-group__ic')}</button>
      <div class="nav-group__body"${open ? '' : ' hidden'}>
        ${[['', '전체'], ...depts.map((d) => [d, d])].map(([k, l]) => `<button type="button" class="nav-sub" data-d="${esc(k)}" aria-pressed="${state.dept === k}"><i class="ddot ${k ? `t-${tone(k)}` : 'ddot--all'}"></i><span>${esc(l)}</span><small>${k ? posts.filter((p) => p.dept === k).length : posts.length}</small></button>`).join('')}
      </div>`;
    el.querySelector('.nav-group__head').onclick = () => { store.set('deptOpen', !open); renderSideDepts(); };
    el.querySelector('.nav-group__body').onclick = (e) => {
      const b = e.target.closest('[data-d]');
      if (!b) return;
      state.dept = b.dataset.d;
      renderSideDepts();
      if (location.hash.replace(/^#\/?/, '') !== '') location.hash = '#/'; else viewList();
    };
  }

  /* ─── 처음 한 번만: 쓰기 버튼 안내 (코치마크) ─── */
  function maybeCoach() {
    if (store.get('coachDone', false)) return;
    const target = [document.getElementById('writeBtn'), document.getElementById('writeTab')].find((x) => x && x.offsetParent);
    if (!target) return;
    const r = target.getBoundingClientRect();
    const tip = document.createElement('div');
    const below = r.top < window.innerHeight / 2;
    tip.className = `coach ${below ? 'coach--below' : 'coach--above'}`;
    tip.innerHTML = `<b>여기서 교제록을 써요</b><span>쓰는 내용은 자동으로 저장되고, 게시판에 바로 올릴 수 있어요.</span><button type="button" class="btn btn--sm">알겠어요</button>`;
    document.getElementById('layer').appendChild(tip);
    const place = () => {
      const t = target.getBoundingClientRect();
      const w = tip.offsetWidth;
      tip.style.left = `${Math.max(12, Math.min(window.innerWidth - w - 12, t.left + t.width / 2 - w / 2))}px`;
      tip.style.top = below ? `${t.bottom + 12}px` : `${t.top - tip.offsetHeight - 12}px`;
      tip.style.setProperty('--arrow', `${t.left + t.width / 2 - parseFloat(tip.style.left)}px`);
    };
    place();
    requestAnimationFrame(() => tip.classList.add('show'));
    const done = () => { store.set('coachDone', true); tip.remove(); window.removeEventListener('resize', place); window.removeEventListener('hashchange', done); };
    tip.querySelector('button').onclick = done;
    window.addEventListener('resize', place);
    window.addEventListener('hashchange', done);
  }

  /* ─── 오른쪽 패널 (넓은 화면): 쓰다 만 글 · 달력 · 이번 주 기도제목 ─── */
  function ring(done, total) {
    const r = 18, c = 2 * Math.PI * r, pct = total ? done / total : 0;
    return `<svg class="ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="${r}" class="ring__bg"/><circle cx="22" cy="22" r="${r}" class="ring__fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg><span class="ring__txt">${Math.round(pct * 100)}%</span>`;
  }
  async function renderPanel() {
    const $p = document.getElementById('panel');
    if (!isWide() || !auth.hash) { $p.innerHTML = ''; return; }
    const draft = draftInfo();
    const posts = await loadPosts();
    if (!auth.hash) return;
    // 달력: 월정표 일정 기준 (교제록이 아니라 관리자가 올린 일정)
    if (!state.calMonth) { const t = new Date(); state.calMonth = new Date(t.getFullYear(), t.getMonth(), 1); }
    const m = state.calMonth;
    const mKey = `${m.getFullYear()}-${pad(m.getMonth() + 1)}`;
    const calR = await loadMonth(mKey);
    if (!auth.hash) return;
    const f = calFilter();
    const evs = (calR.status === 'ok' ? calR.events || [] : []).filter((e) => passFilter(e, f)).sort((x, y) => x.start.localeCompare(y.start));
    const onDay = (e, k) => e.start <= k && (e.end || e.start) >= k;
    const first = new Date(m.getFullYear(), m.getMonth(), 1);
    const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const todayKey = ymd(new Date());
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push('<span></span>');
    for (let d = 1; d <= days; d++) {
      const k = ymd(new Date(m.getFullYear(), m.getMonth(), d));
      const list = evs.filter((e) => onDay(e, k));
      const dots = [...new Set(list.map(evTone))].slice(0, 3).map((t) => `<i class="ev-${t}"></i>`).join('');
      cells.push(`<button type="button" class="cal__d${k === todayKey ? ' is-today' : ''}${k === state.panelDay ? ' is-on' : ''}" data-day="${k}"${list.length ? '' : ' disabled'} aria-label="${m.getMonth() + 1}월 ${d}일${list.length ? ` 일정 ${list.length}개` : ''}">${d}<span class="cal__dots">${dots}</span></button>`);
    }
    const sel = state.panelDay && state.panelDay.startsWith(mKey) ? state.panelDay : '';
    const shown = sel ? evs.filter((e) => onDay(e, sel))
      : (mKey === todayKey.slice(0, 7) ? evs.filter((e) => (e.end || e.start) >= todayKey) : evs).slice(0, 4);
    const emptyMsg = calR.status !== 'ok' ? '일정을 불러오지 못했어요' : sel ? '이 날은 일정이 없어요' : '이 달엔 남은 일정이 없어요';
    const latestPr = posts.find((p) => p.prayers.length);
    $p.innerHTML = `
      ${draft ? `<section class="promo">
        <div class="promo__top">
          <div><small>쓰다 만 교제록</small><b>${draft.done}/${draft.total} 단계 채웠어요</b></div>
          <div class="ring-wrap">${ring(draft.done, draft.total)}</div>
        </div>
        <a class="btn btn--sm" href="#/write">이어 쓰기</a>
      </section>` : ''}
      <section class="pblock card">
        <div class="cal__head">
          <b>${m.getFullYear()}년 ${m.getMonth() + 1}월</b>
          <div><button type="button" class="icon-btn" data-cal="-1" aria-label="이전 달">${icon('left')}</button><button type="button" class="icon-btn" data-cal="1" aria-label="다음 달">${icon('right')}</button></div>
        </div>
        <div class="cal">${WEEK.map((w) => `<span class="cal__w">${w}</span>`).join('')}${cells.join('')}</div>
        <div class="evts">
          ${shown.length ? shown.map((e) => `<button type="button" class="evt" data-ev="${esc(e.id)}"><i class="evt__bar ev-${evTone(e)}"></i><span><small>${esc(evWhen(e))} · ${esc(evLabel(e))}</small><b>${esc(e.title)}</b></span></button>`).join('')
            : `<p class="hint">${emptyMsg}</p>`}
        </div>
        <a class="pblock__more" href="#/calendar">월정표 전체 보기${icon('right')}</a>
      </section>
      <section class="pblock card">
        <h2>${icon('heart')}이번 주 기도제목</h2>
        <div id="panelPrayers">${latestPr ? prayerList(latestPr) : '<span class="sk sk-line"></span><span class="sk sk-line" style="width:70%"></span>'}</div>
      </section>`;
    $p.querySelectorAll('[data-cal]').forEach((b) => { b.onclick = () => { state.calMonth = new Date(m.getFullYear(), m.getMonth() + Number(b.dataset.cal), 1); renderPanel(); }; });
    $p.querySelectorAll('[data-day]').forEach((b) => { b.onclick = () => { state.panelDay = state.panelDay === b.dataset.day ? '' : b.dataset.day; renderPanel(); }; });
    $p.querySelectorAll('[data-ev]').forEach((b) => { b.onclick = () => openEvent(evs.find((e) => e.id === b.dataset.ev), calR.perms || { viewDepts: [], editDepts: [] }, mKey); });
    if (!latestPr) {
      await Promise.all(posts.slice(0, 6).map(fetchBody));
      const pr = posts.find((p) => p.prayers.length);
      const el = document.getElementById('panelPrayers');
      if (el) el.innerHTML = pr ? prayerList(pr) : '<p class="hint">아직 기도제목이 없어요</p>';
    }
  }
  const prayerList = (p) => `<p class="hint" style="margin-bottom:10px">${tag(p.dept)} ${fullDate(p.date)}</p>
    <ul class="plist">${p.prayers.slice(0, 5).map((x) => `<li>${avatar(x.name, '', 'xs')}<span><b>${esc(x.name)}</b>${esc(x.text)}</span></li>`).join('')}</ul>
    <a class="pblock__more" href="#/prayers">기도제목 모두 보기${icon('right')}</a>`;

  /* ─── 로그인 화면 (로그인해야 들어갈 수 있음) ─── */
  function signOut() {
    auth.clear();
    calCache.clear();
    state.posts = null; state.loading = null; state.rosters = null; state.schedule = null;
    document.getElementById('panel').innerHTML = '';
  }
  function viewLogin() {
    $app.innerHTML = `
      <div class="login">
        <div class="login__art" id="loginArt" aria-hidden="true">
          <div class="login__sky"><i class="c1"></i><i class="c2"></i><i class="c3"></i><i class="sun"></i></div>
        </div>
        <div class="login__panel">
          <div class="login__inner">
            <div class="login__brand">
              <h1>${esc(APP)}</h1>
              <p>교제록과 기도제목을 함께 나눠요</p>
            </div>
            <form class="login__form" id="loginForm" autocomplete="on" novalidate>
              <label class="field"><span class="field__label">깨사모 아이디</span><input class="input" name="userid" value="${esc(store.get('lastUserid', ''))}" autocomplete="username" autocapitalize="off" spellcheck="false" enterkeyhint="next"></label>
              <label class="field"><span class="field__label">비밀번호</span>
                <span class="pw"><input class="input" name="password" type="password" autocomplete="current-password" enterkeyhint="go"><button type="button" class="pw__eye" aria-label="비밀번호 보기" aria-pressed="false">${icon('eye')}</button></span></label>
              <p class="inline-error" id="loginError" role="alert" hidden></p>
              <button class="btn btn--primary btn--lg btn--block" type="submit" id="loginBtn">로그인</button>
            </form>
            <p class="login__note">${icon('lock')}회원만 들어올 수 있어요. 비밀번호는 저장하지 않아요.</p>
          </div>
        </div>
      </div>`;
    // 교회 그림 (assets/church.png|jpg|webp) — 있으면 배경으로, 없으면 하늘 그림
    const art = document.getElementById('loginArt');
    const tryImg = (list) => {
      if (!list.length) return;
      const img = new Image();
      img.onload = () => {
        // 뒤: 같은 그림을 크게 흐리게 깔아 화면을 채우고 / 앞: 교회 그림 전체를 잘리지 않게 또렷하게
        const bg = img.cloneNode();
        bg.className = 'login__bg';
        bg.alt = '';
        img.className = 'login__pic';
        img.alt = '';
        art.append(bg, img);
        art.classList.add('has-img');
      };
      img.onerror = () => tryImg(list.slice(1));
      img.src = list[0];
    };
    tryImg(['/assets/church.png', '/assets/church.jpg', '/assets/church.webp']);

    const $f = document.getElementById('loginForm');
    const $btn = document.getElementById('loginBtn');
    const $err = document.getElementById('loginError');
    const $eye = $f.querySelector('.pw__eye');
    $eye.onclick = () => {
      const show = $f.password.type === 'password';
      $f.password.type = show ? 'text' : 'password';
      $eye.setAttribute('aria-pressed', String(show));
      $eye.setAttribute('aria-label', show ? '비밀번호 숨기기' : '비밀번호 보기');
    };
    const fieldErr = (msg, field) => {
      $err.innerHTML = `${icon('alert')}${esc(msg)}`;
      $err.hidden = false;
      field?.classList.add('is-invalid');
      field?.focus();
    };
    $f.addEventListener('input', (e) => { e.target.classList.remove('is-invalid'); $err.hidden = true; });
    if (window.matchMedia('(min-width: 861px)').matches) $f[store.get('lastUserid', '') ? 'password' : 'userid'].focus();
    $f.onsubmit = async (e) => {
      e.preventDefault();
      const userid = String($f.userid.value || '').trim();
      if (!userid) return fieldErr('아이디를 적어 주세요', $f.userid);
      if (!$f.password.value) return fieldErr('비밀번호를 적어 주세요', $f.password);
      $btn.disabled = true; $btn.innerHTML = `${spinner}로그인 중`; $err.hidden = true;
      const r = await callApi('login', { Userid: userid, password: String($f.password.value || '') });
      if (r.status !== 'ok' || !r.hash) {
        $btn.disabled = false; $btn.textContent = '로그인';
        $f.password.value = '';
        return fieldErr(String(r.result || '로그인하지 못했어요'), $f.password);
      }
      const m = await callApi('me', { hash: r.hash });
      signOut();
      auth.set(r.hash, m.status === 'ok' ? m.result : null);
      store.set('lastUserid', userid);
      route();
      toast(`${m.result?.name ? m.result.name + '님, ' : ''}반가워요`);
    };
  }

  /* ─── 라우터 ─── */
  let prevName = null;
  /* 화면 전환: 탭끼리는 살짝 떠오르며 나타나고(페이드), 글·앨범·번개로 들어갈 땐 오른쪽에서(푸시), 나올 땐 왼쪽에서.
   * 예전 화면을 찍어 두는 방식(View Transitions)은 휴대폰에서 끊겨서, 새 화면만 가볍게 움직임.
   * 바뀌는 건 가운데(#app)만. '동작 줄이기' 설정이면 그냥 바뀜 */
  let vtTop = null, vtDepth = 0;
  function route() {
    const [name, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
    const top = name || 'list';
    const depth = name === 'post' || rest.length ? 1 : 0;
    let kind = '';
    if (auth.hash && vtTop !== null) {
      if (depth > vtDepth) kind = 'push';
      else if (depth < vtDepth) kind = 'pop';
      else if (top !== vtTop || depth === 1) kind = 'fade';
    }
    vtTop = auth.hash ? top : null; vtDepth = depth;
    renderRoute();
    if (!kind || reduceMotion()) return;
    $app.classList.remove('vt-fade', 'vt-push', 'vt-pop');
    void $app.offsetWidth; // 같은 효과를 다시 시작하려면 한 번 끊어 줘야 함
    $app.classList.add(`vt-${kind}`);
  }
  function renderRoute() {
    const locked = !auth.hash;
    document.body.classList.toggle('locked', locked);
    if (locked) { prevName = null; window.scrollTo(0, 0); document.title = APP; return viewLogin(); }
    const h = location.hash.replace(/^#\/?/, '');
    const [name, ...rest] = h.split('/');
    const tab = name === 'post' ? 'post' : (name || 'list');
    if (!prevName || prevName === 'list') state.listScroll = window.scrollY;
    const restore = name === '' && prevName === 'post';
    prevName = name || 'list';
    renderChrome(tab === 'post' ? 'list' : tab);
    loadPosts().then(() => { if (auth.hash) renderChrome(tab === 'post' ? 'list' : tab); });
    if (name !== 'album') checkNewAlbums();
    document.title = tab === 'list' ? APP : document.title;
    window.scrollTo(0, 0);
    renderPanel();
    if (name === 'post') return viewPost(decodeURIComponent(rest.join('/')));
    if (name === 'prayers') return viewPrayers();
    if (name === 'attendance') return isAdmin() ? viewAttendance() : viewAdminOnly();
    if (name === 'write') return viewWrite();
    if (name === 'settings') return viewSettings();
    if (name === 'calendar') return viewCalendar();
    if (name === 'meetup') return rest.length ? viewMeetup(decodeURIComponent(rest.join('/'))) : viewMeetups();
    if (name === 'admin') return viewAdmin();
    if (name === 'album') return rest.length ? viewAlbum(decodeURIComponent(rest.join('/'))) : viewAlbums();
    return viewList({ restore });
  }
  window.addEventListener('hashchange', route);
  window.matchMedia('(min-width: 1180px)').addEventListener?.('change', renderPanel);

  // 인터넷 끊김 알림
  const $off = document.getElementById('offline');
  window.addEventListener('offline', () => { $off.hidden = false; });
  window.addEventListener('online', () => { $off.hidden = true; toast('다시 연결됐어요'); });
  if (!navigator.onLine) $off.hidden = false;

  // "/" 키로 검색칸으로
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    const s = [document.getElementById('gq'), document.querySelector('.search input')].find((x) => x && x.offsetParent);
    if (s) { e.preventDefault(); s.focus(); }
  });

  route();
  if (auth.hash) swReady(); // 알림용 서비스 워커 (알림을 켠 기기에서 계속 받으려면 등록돼 있어야 함)
  if (auth.hash) setTimeout(() => { if (auth.hash) maybeAskPush().catch(() => {}); }, 2500); // 들어오고 잠시 뒤 알림 받을지 물어봄

  // 로그인돼 있으면 이름·관리자 여부를 새로 받아 둠 (관리자 목록이 바뀌어도 반영되도록)
  if (auth.hash) {
    callApi('me').then((m) => {
      if (m.status !== 'ok' || !auth.hash) return;
      const was = isAdmin();
      auth.set(auth.hash, m.result);
      const cur = location.hash.replace(/^#\/?/, '').split('/')[0];
      renderChrome(cur === 'post' || !cur ? 'list' : cur);
      if (was !== isAdmin() && cur === 'attendance') route();
    });
  }
})();
