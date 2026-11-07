/* 청년회 교제록 — 화면 동작
 * 구성: 모아보기(목록·상세·검색·월별) / 기도제목 / 참석 흐름 / 작성(복사해서 붙여넣기) / 설정
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
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }
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
  const NO_HASH_APIS = ['login', 'board_comment'];
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
  function prayersFrom(lines) {
    const out = [];
    for (const raw of lines) {
      const l = raw.trim();
      if (!l) continue;
      const m = l.match(/^[-·•*]?\s*([가-힣]{2,5}[bsBS]?)\s*[:：\-–]\s*(.+)$/);
      if (m) out.push({ name: cleanName(m[1]), text: m[2].trim() });
      else if (out.length && !/^[-·•*]/.test(l)) out[out.length - 1].text += ' ' + l;
      else out.push({ name: '', text: l.replace(/^[-·•*]\s*/, '') });
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
    return (doc.body.textContent || '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
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
      // 앱 양식(■)으로 쓴 글만 칸별로 다시 그리고, 나머지는 원문을 그대로 보여줌
      structured: /■/.test(text) && Object.keys(sec).length >= 2,
    };
  }

  /* ─── 게시글 불러오기 ────────────────────── */
  const state = {
    posts: null, source: '', error: '', loading: null, page: 0, hasMore: false,
    q: '', month: '', dept: '', prayerMode: 'person',
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

  const sampleNotice = () => (state.source === 'error'
    ? `<div class="notice is-error"><span>⚠️</span><div><b>교제록을 불러오지 못했어요</b><br>${esc(state.error)}<div class="btn-row" style="margin-top:8px"><button class="btn btn--sm" onclick="location.reload()">다시 시도</button></div></div></div>`
    : '');
  const skeleton = () => `<div class="loading">${'<div class="skeleton"></div>'.repeat(4)}</div>`;
  const progress = (label) => `<div class="loading-label" id="prog">${esc(label)}</div>${skeleton()}`;
  const setProgress = (done, total) => {
    const el = document.getElementById('prog');
    if (el) el.textContent = `최근 교제록 읽는 중… ${done}/${total}`;
  };
  // 부서 칩 (순종부·사랑부·겸손부 …) — 글 제목의 [2026 순종부] 에서 읽음
  function deptChips(posts, onChange) {
    const depts = [...new Set(posts.map((p) => p.dept))];
    if (depts.length < 2) return { html: '', bind() {} };
    const draw = () => [['', '전체'], ...depts.map((d) => [d, d])]
      .map(([k, l]) => `<button class="chip" data-d="${esc(k)}" aria-pressed="${state.dept === k}">${esc(l)}</button>`).join('');
    return {
      html: `<div class="chips" id="depts">${draw()}</div>`,
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

  /* ─── 화면: 모아보기 ─────────────────────── */
  async function viewList() {
    $app.innerHTML = `
      <div class="page-head"><h1>교제록 모아보기</h1><p>주마다 나눈 말씀과 교제를 한눈에</p></div>
      <div id="notice"></div>
      <label class="search"><input class="input" id="q" type="search" placeholder="이름, 말씀, 나눔 내용으로 검색" value="${esc(state.q)}" autocomplete="off"></label>
      <div id="deptWrap"></div>
      <div class="chips" id="months"></div>
      <div id="list">${skeleton()}</div>
      <div class="more" id="more"></div>`;
    const posts = await loadPosts();
    if (!document.getElementById('list')) return;
    document.getElementById('notice').innerHTML = sampleNotice();
    const dc = deptChips(posts, () => drawList());
    document.getElementById('deptWrap').innerHTML = dc.html;
    dc.bind();

    const $months = document.getElementById('months');
    const drawMonths = () => {
      const months = [...new Set(posts.filter((p) => p.date).map((p) => monthKey(p.date)))];
      $months.innerHTML = [['', '전체'], ...months.map((m) => [m, monthLabel(m)])]
        .map(([k, l]) => `<button class="chip" data-m="${k}" aria-pressed="${state.month === k}">${l}</button>`).join('');
    };
    drawMonths();

    // 더 불러오기
    const $more = document.getElementById('more');
    const drawMore = () => {
      $more.innerHTML = state.hasMore ? `<button class="btn" id="moreBtn">이전 교제록 더 불러오기</button>` : '';
      const b = document.getElementById('moreBtn');
      if (b) b.onclick = async () => {
        b.disabled = true; b.textContent = '불러오는 중…';
        const n = await loadMore();
        if (!document.getElementById('list')) return;
        if (n) toast(`${n}개를 더 불러왔어요`);
        drawMonths(); drawList(); drawMore();
      };
    };
    drawMore();
    // 최근 글 본문을 뒤에서 받아와서 참석자·기도제목·검색에 반영
    if (state.source === 'api') {
      fillBodies().then(() => { if (document.getElementById('list')) drawList(); });
    }
    $months.onclick = (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      state.month = b.dataset.m;
      drawMonths();
      drawList();
    };
    const $q = document.getElementById('q');
    $q.oninput = () => { state.q = $q.value.trim(); drawList(); };

    function drawList() {
      const q = state.q.toLowerCase();
      const rows = posts.filter((p) => inDept(p) &&
        (!state.month || (p.date && monthKey(p.date) === state.month)) &&
        (!q || (p.title + '\n' + p.text + '\n' + p.author).toLowerCase().includes(q)));
      const $list = document.getElementById('list');
      if (!rows.length) { $list.innerHTML = `<div class="empty">찾는 교제록이 없어요</div>`; return; }
      let html = '';
      let lastMonth = '';
      for (const p of rows) {
        const mk = p.date ? monthKey(p.date) : '';
        if (mk !== lastMonth) {
          if (lastMonth !== '') html += '</div>';
          html += `<h2 class="month">${mk ? monthLabel(mk) : '날짜 없음'}</h2><div class="post-list">`;
          lastMonth = mk;
        }
        const excerpt = q && !p.share.toLowerCase().includes(q) ? findSnippet(p.text, q) : (p.share || p.text.slice(0, 120));
        html += `
          <a class="post-item" href="#/post/${encodeURIComponent(p.id)}">
            <div class="date-badge">${p.date ? `<b>${p.date.getDate()}</b><small>${p.date.getMonth() + 1}월 ${WEEK[p.date.getDay()]}</small>` : '<b>·</b>'}</div>
            <div>
              <h3>${highlight(p.title, state.q)}</h3>
              ${p.verse ? `<div class="verse">${highlight(p.verse, state.q)}</div>` : ''}
              ${excerpt ? `<p class="excerpt">${highlight(excerpt, state.q)}</p>` : ''}
              <div class="meta">
                ${p.people.length ? `<span>👥 ${p.people.length}명</span>` : ''}
                ${p.prayers.length ? `<span>🙏 기도제목 ${p.prayers.length}</span>` : ''}
                ${p.etc ? `<span>📌 기타</span>` : ''}
                ${p.photos.length ? `<span>📷 ${p.photos.length}</span>` : ''}
                ${p.comments ? `<span>💬 ${p.comments}</span>` : ''}
                ${p.author ? `<span>✍️ ${esc(p.author)}</span>` : ''}
              </div>
            </div>
          </a>`;
      }
      $list.innerHTML = html + '</div>';
    }
    drawList();
  }
  function findSnippet(text, q) {
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return text.slice(0, 120);
    const s = Math.max(0, i - 30);
    return (s > 0 ? '…' : '') + text.slice(s, i + q.length + 70).replace(/\n/g, ' ');
  }

  /* ─── 화면: 상세 ─────────────────────────── */
  async function viewPost(id) {
    $app.innerHTML = `<a class="back" href="#/">목록</a>${skeleton()}`;
    const p = await loadDetail(id);
    if (!p) { $app.innerHTML = `<a class="back" href="#/">목록</a><div class="empty">교제록을 찾을 수 없어요</div>`; return; }
    const sec = (title, inner) => (inner ? `<section class="section"><h2>${title}</h2>${inner}</section>` : '');
    const para = (s) => (s ? `<p>${esc(s)}</p>` : '');
    const body = p.structured
      ? [
          sec(`참석자 ${p.people.length}명`, p.people.length ? `<div class="people">${p.people.map((n) => `<span class="person">${esc(n)}</span>`).join('')}</div>` : ''),
          sec('말씀', p.verse ? `<p><b>${esc(p.verse)}</b></p>${para(p.verseNote)}` : ''),
          sec('나눔', para(p.share)),
          sec('기도제목', p.prayers.length ? `<ul class="prayer-list">${p.prayers.map((x) => `<li>${x.name ? `<b>${esc(x.name)}</b>` : ''}${esc(x.text)}</li>`).join('')}</ul>` : ''),
          sec('기타', para(p.etc)),
        ].join('')
      : (p.people.length ? sec(`참석자 ${p.people.length}명`, `<div class="people">${p.people.map((n) => `<span class="person">${esc(n)}</span>`).join('')}</div>`) : '') +
        `<div class="section raw-html">${sanitize(p.body) || '<p class="muted">본문이 없어요</p>'}</div>`;
    const photos = p.photos.length
      ? `<section class="section"><h2>사진 ${p.photos.length}장</h2><div class="gallery">${p.photos.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="" loading="lazy"></a>`).join('')}</div></section>`
      : '';
    $app.innerHTML = `
      <a class="back" href="#/">목록</a>
      ${sampleNotice()}
      <article class="card detail">
        <h1>${esc(p.title)}</h1>
        <div class="meta">
          ${p.date ? `<span>📅 ${dotDate(p.date)} (${WEEK[p.date.getDay()]})</span>` : ''}
          ${p.author ? `<span>✍️ ${esc(p.author)}</span>` : ''}
          ${p.hits ? `<span>👀 ${p.hits}</span>` : ''}
          ${p.likes ? `<span>♥ ${p.likes}</span>` : ''}
        </div>
        ${body}
        ${photos}
        <section class="section" id="comments"></section>
      </article>`;
    if (state.source === 'api') drawComments(p);
  }

  async function drawComments(p) {
    const $c = document.getElementById('comments');
    if (!$c) return;
    $c.innerHTML = `<h2>댓글</h2><p class="muted small">불러오는 중…</p>`;
    const r = await callApi('board_comment', { board_uid: p.id, orderby: 'ASC' });
    if (!document.getElementById('comments')) return;
    // 댓글 API는 { status } 없이 배열만 돌려줌
    const list = (Array.isArray(r) ? r : (Array.isArray(r.result) ? r.result : [])).filter((x) => x && x.comment);
    const myId = String(auth.me?.userid || '').toLowerCase();
    $c.innerHTML = `<h2>댓글 ${list.length}</h2>` + (list.length
      ? `<ul class="comment-list">${list.map((x) => {
          const d = parseDate(x.created);
          const mine = myId && String(x.userid || '').toLowerCase() === myId;
          return `<li><div class="comment-head"><b>${esc(x.username || '')}</b>${x.sex ? `<span class="muted"> ${esc(x.sex)}</span>` : ''}${d ? `<time>${d.getMonth() + 1}.${d.getDate()}</time>` : ''}${mine ? `<button class="comment-del" data-del="${esc(x.uid)}" aria-label="내 댓글 지우기">지우기</button>` : ''}</div><p>${esc(htmlToText(x.comment))}</p></li>`;
        }).join('')}</ul>`
      : `<p class="muted small">아직 댓글이 없어요. 첫 댓글을 남겨 주세요</p>`) + `
      <form class="comment-form" id="commentForm">
        <textarea class="textarea" name="comment" rows="2" maxlength="1000" placeholder="댓글을 남겨 주세요" required></textarea>
        <button class="btn btn--primary" type="submit">등록</button>
      </form>`;

    const $form = document.getElementById('commentForm');
    const $ta = $form.comment;
    $form.onsubmit = async (e) => {
      e.preventDefault();
      const text = $ta.value.trim();
      if (text.length < 2) { toast('댓글은 2자 이상 써 주세요'); return; }
      const $btn = $form.querySelector('button');
      $btn.disabled = true; $btn.textContent = '등록 중…';
      const res = await callApi('comment', {
        mode: 'add_comment', board_uid: p.id, comment: text,
        url: `${location.origin}/#/post/${p.id}`,
      });
      if (res.status !== 'ok') {
        $btn.disabled = false; $btn.textContent = '등록';
        toast(`댓글을 달지 못했어요: ${typeof res.result === 'string' ? res.result : '알 수 없는 오류'}`);
        return;
      }
      p.comments = (p.comments || 0) + 1;
      toast('댓글을 달았어요');
      drawComments(p);
    };
    $c.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('이 댓글을 지울까요?')) return;
        b.disabled = true;
        const res = await callApi('comment', { mode: 'del_comment', board_uid: p.id, comment_uid: b.dataset.del });
        if (res.status !== 'ok') { b.disabled = false; toast(`지우지 못했어요: ${typeof res.result === 'string' ? res.result : '알 수 없는 오류'}`); return; }
        p.comments = Math.max(0, (p.comments || 1) - 1);
        toast('댓글을 지웠어요');
        drawComments(p);
      };
    });
  }

  /* ─── 화면: 기도제목 모아보기 ────────────── */
  async function viewPrayers() {
    $app.innerHTML = `
      <div class="page-head"><h1>기도제목</h1><p>서로의 기도제목을 기억하고 함께 기도해요</p></div>
      <div id="notice"></div>
      <label class="search"><input class="input" id="pq" type="search" placeholder="이름이나 내용으로 찾기" autocomplete="off"></label>
      <div id="deptWrap"></div>
      <div class="chips" id="pmode"></div>
      <div id="plist">${progress('교제록 불러오는 중…')}</div>`;
    const posts = await loadPosts();
    if (!document.getElementById('plist')) return;
    if (state.source === 'api') await fillBodies(setProgress);
    if (!document.getElementById('plist')) return;
    document.getElementById('notice').innerHTML = sampleNotice();
    const dc = deptChips(posts, () => draw());
    document.getElementById('deptWrap').innerHTML = dc.html;
    dc.bind();
    let items = [];
    const $mode = document.getElementById('pmode');
    const $pq = document.getElementById('pq');
    const drawMode = () => {
      $mode.innerHTML = [['person', '사람별'], ['week', '주차별']]
        .map(([k, l]) => `<button class="chip" data-k="${k}" aria-pressed="${state.prayerMode === k}">${l}</button>`).join('');
    };
    $mode.onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) { state.prayerMode = b.dataset.k; drawMode(); draw(); } };
    $pq.oninput = draw;
    drawMode();
    draw();

    function draw() {
      items = posts.filter(inDept).flatMap((p) => p.prayers.map((x) => ({ ...x, date: p.date, postId: p.id })));
      const q = $pq.value.trim();
      const ql = q.toLowerCase();
      const rows = items.filter((x) => !ql || (x.name + ' ' + x.text).toLowerCase().includes(ql));
      const $l = document.getElementById('plist');
      if (!rows.length) { $l.innerHTML = `<div class="empty">${items.length ? '찾는 기도제목이 없어요' : '아직 모인 기도제목이 없어요'}</div>`; return; }
      const groups = new Map();
      for (const x of rows) {
        const key = state.prayerMode === 'person' ? (x.name || '이름 없음') : (x.date ? ymd(x.date) : '날짜 없음');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(x);
      }
      $l.innerHTML = [...groups].map(([key, list]) => {
        const head = state.prayerMode === 'person'
          ? `${highlight(key, q)} <small>${list.length}개</small>`
          : `${list[0].date ? korDate(list[0].date) : key} <small>${list.length}명</small>`;
        return `<div class="card prayer-group"><h3>${head}</h3>${list.map((x) => `
          <div class="prayer-row">
            <time>${state.prayerMode === 'person' ? (x.date ? `${x.date.getMonth() + 1}.${x.date.getDate()}` : '') : esc(x.name)}</time>
            <a href="#/post/${encodeURIComponent(x.postId)}" style="text-decoration:none">${highlight(x.text, q)}</a>
          </div>`).join('')}</div>`;
      }).join('');
    }
  }

  /* ─── 화면: 참석 흐름 ────────────────────── */
  async function viewAttendance() {
    $app.innerHTML = `<div class="page-head"><h1>참석 흐름</h1><p>주마다 누가 함께했는지 살펴봐요</p></div><div id="deptWrap"></div><div id="body">${progress('교제록 불러오는 중…')}</div>`;
    const all = await loadPosts();
    if (!document.getElementById('body')) return;
    if (state.source === 'api') await fillBodies(setProgress);
    if (!document.getElementById('body')) return;
    const dc = deptChips(all.filter((p) => p.people.length), () => viewAttendance());
    document.getElementById('deptWrap').innerHTML = dc.html;
    dc.bind();
    const posts = all.filter((p) => p.date && p.people.length && inDept(p));
    const $b = document.getElementById('body');
    if (!posts.length) { $b.innerHTML = sampleNotice() + `<div class="empty">참석자 정보가 있는 교제록이 없어요</div>`; return; }
    const weeks = posts.slice(0, 12).reverse(); // 오래된 주 → 최근 주
    const max = Math.max(...weeks.map((p) => p.people.length));
    const avg = weeks.reduce((s, p) => s + p.people.length, 0) / weeks.length;
    const recentWeeks = posts.slice(0, 8);
    const count = new Map();
    recentWeeks.forEach((p) => p.people.forEach((n) => count.set(n, (count.get(n) || 0) + 1)));
    const names = [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || a.localeCompare(b, 'ko'));
    const cols = [...recentWeeks].reverse();

    $b.innerHTML = `
      ${sampleNotice()}
      <div class="stats">
        <div class="stat"><small>지난주 참석</small><b>${posts[0].people.length}명</b></div>
        <div class="stat"><small>평균 (최근 ${weeks.length}주)</small><b>${avg.toFixed(1)}명</b></div>
        <div class="stat"><small>함께한 사람</small><b>${names.length}명</b></div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <h2 class="month" style="margin:0">주별 참석 인원</h2>
        <div class="trend" role="img" aria-label="주별 참석 인원 막대그래프">
          ${weeks.map((p) => `
            <div class="trend__bar" title="${korDate(p.date)} · ${p.people.length}명">
              <b>${p.people.length}</b>
              <i style="height:${Math.round((p.people.length / max) * 78)}%"></i>
              <span>${p.date.getMonth() + 1}/${p.date.getDate()}</span>
            </div>`).join('')}
        </div>
      </div>
      <div class="card">
        <h2 class="month" style="margin:0 0 8px">최근 ${cols.length}주 출석표</h2>
        <div class="matrix-wrap">
          <table class="matrix">
            <thead><tr><th>이름</th>${cols.map((p) => `<th>${p.date.getMonth() + 1}/${p.date.getDate()}</th>`).join('')}<th>참석</th></tr></thead>
            <tbody>
              ${names.map((n) => `<tr><td>${esc(n)}</td>${cols.map((p) => `<td><span class="dot${p.people.includes(n) ? ' on' : ''}" aria-label="${p.people.includes(n) ? '참석' : '불참'}"></span></td>`).join('')}<td class="rate">${count.get(n)}/${cols.length}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  /* ─── 명단 ──────────────────────────── */
  const getRoster = () => store.get('roster', []);
  // 부서별 명단 (Cloudflare 환경 변수 ROSTERS → 로그인한 회원만 받음, 기기에 저장 안 함)
  async function loadRosters() {
    if (!auth.hash) return {};
    if (!state.rosters) {
      const r = await callApi('rosters');
      state.rosters = r.status === 'ok' && r.result && typeof r.result === 'object' ? r.result : {};
    }
    return state.rosters;
  }

  /* ─── 사진 축소 ──────────────────────────── */
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

  /* ─── 화면: 작성 ─────────────────────────── */
  const photos = [];
  async function viewWrite() {
    $app.innerHTML = `<div class="page-head"><h1>교제록 작성</h1></div>${skeleton()}`;
    const rosters = await loadRosters();
    if (location.hash.replace(/^#\/?/, '') !== 'write') return;
    const depts = Object.keys(rosters).filter((k) => rosters[k].length);
    const today = new Date();
    const draft = store.get('draft', null) || { date: ymd(today), writer: auth.me?.name || "", people: [], extra: '', verse: '', verseNote: '', share: '', prayers: {}, etc: '' };
    let dept = depts.includes(draft.dept) ? draft.dept : (depts.includes(store.get('lastDept', '')) ? store.get('lastDept', '') : (depts[0] || ''));
    const rosterOf = (d) => (d && rosters[d]) || getRoster();
    const roster = rosterOf(dept);
    const canPost = C.board.writeEnabled && !!auth.hash;
    const checkBoxes = (list, checked) => list.map((n) => `<label class="check"><input type="checkbox" name="people" value="${esc(n)}"${checked.includes(n) ? ' checked' : ''}><span>${esc(n)}</span></label>`).join('');

    $app.innerHTML = `
      <div class="page-head"><h1>교제록 작성</h1><p>양식대로 쓰고, 게시판에 바로 올리거나 복사해서 붙여넣어요</p></div>
      ${depts.length || roster.length ? '' : `<div class="notice"><span>👥</span><div><b>부서 명단이 아직 없어요</b><br>부서별 명단이 등록되면 여기서 참석자를 고를 수 있어요. 그 전에는 아래 칸에 이름을 직접 적어 주세요.</div></div>`}
      <form class="card form-card" id="f" autocomplete="off">
        ${depts.length ? `<div class="field"><span>부서</span><div class="chips" id="deptPick" style="margin:0">${depts.map((d) => `<button type="button" class="chip" data-d="${esc(d)}" aria-pressed="${d === dept}">${esc(d)}</button>`).join('')}</div></div>` : ''}
        <div class="grid-2">
          <label class="field"><span>날짜</span><input class="input" type="date" name="date" value="${esc(draft.date)}"></label>
          <label class="field"><span>작성자</span><input class="input" name="writer" list="rosterList" value="${esc(draft.writer)}" placeholder="이름"></label>
        </div>
        <datalist id="rosterList">${roster.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <div class="field"><span>참석자 <b id="pc" class="muted"></b></span>
          <div class="checks" id="checks">${checkBoxes(roster, draft.people)}</div>
          <input class="input" name="extra" value="${esc(draft.extra)}" placeholder="${roster.length ? '명단에 없는 사람' : '참석자 이름'} (쉼표로 구분, 예: 새가족 홍길동)" style="margin-top:8px">
        </div>
        <label class="field"><span>말씀 본문</span><input class="input" name="verse" value="${esc(draft.verse)}" placeholder="예: 요한복음 15:5"></label>
        <label class="field"><span>말씀 요약</span><textarea class="textarea" name="verseNote" placeholder="말씀에서 받은 은혜를 간단히">${esc(draft.verseNote)}</textarea></label>
        <label class="field"><span>나눔</span><textarea class="textarea" name="share" rows="5" placeholder="함께 나눈 이야기">${esc(draft.share)}</textarea></label>
        <div class="field"><span>기도제목</span><div class="prayer-inputs" id="prayers"></div></div>
        <label class="field"><span>기타 <span class="muted small">(선택)</span></span><textarea class="textarea" name="etc" placeholder="광고, 모임 소식, 덧붙일 이야기">${esc(draft.etc ?? draft.bungae ?? '')}</textarea></label>
        <div class="field"><span>사진 <span class="muted small">(자동으로 줄여서 저장해요)</span></span>
          <input type="file" id="photoInput" accept="image/*" multiple hidden>
          <div class="btn-row"><button type="button" class="btn" id="addPhoto">＋ 사진 고르기</button><button type="button" class="btn" id="savePhotos" ${photos.length ? '' : 'hidden'}>줄인 사진 저장</button></div>
          <div class="photos" id="photos" style="margin-top:10px"></div>
        </div>
      </form>

      <h2 class="month" style="margin-top:28px">미리보기</h2>
      <div class="preview" id="preview"></div>

      <div class="card" style="margin-top:16px">
        <h2 class="month" style="margin:0 0 6px">게시판에 올리는 방법</h2>
        ${canPost ? `<p class="small" style="margin:0 0 8px"><b>게시판에 바로 올리기</b>를 누르면 제목·본문·사진이 청년회교제실에 한 번에 올라가요. <span class="muted">(${esc(auth.me?.name || '내')} 이름으로 등록)</span></p><p class="small muted" style="margin:0 0 4px">직접 붙여넣고 싶다면:</p>` : ''}
        <ol class="steps">
          <li><b>제목 복사</b> → 게시판 글쓰기의 제목 칸에 붙여넣기</li>
          <li><b>본문 복사</b> → 내용 칸에 붙여넣기</li>
          <li>줄인 사진을 게시판의 사진 첨부로 올리기</li>
        </ol>
      </div>

      <div class="sticky-actions"><div class="btn-row">
        ${canPost ? `<button class="btn btn--primary" id="postNow">게시판에 바로 올리기</button>` : ''}
        <button class="btn" id="copyTitle">제목 복사</button>
        <button class="btn${canPost ? '' : ' btn--primary'}" id="copyBody">본문 복사</button>
        <a class="btn" href="${esc(C.board.siteUrl)}" target="_blank" rel="noopener">게시판 열기 ↗</a>
        <button class="btn btn--ghost" id="reset">새로 쓰기</button>
      </div></div>`;

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
      if (cur === all.join('|')) return;
      $p.innerHTML = all.length
        ? all.map((n) => `<div class="prayer-input"><label for="pr-${esc(n)}">${esc(n)}</label><input class="input" id="pr-${esc(n)}" data-name="${esc(n)}" value="${esc(prayerDraft[n] || '')}" placeholder="기도제목"></div>`).join('')
        : `<div class="muted small">참석자를 체크하면 사람마다 입력 칸이 생겨요</div>`;
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

    function update() {
      const d = read();
      drawPrayers(d.all);
      document.getElementById('pc').textContent = d.all.length ? `${d.all.length}명` : '';
      document.getElementById('preview').innerHTML = `<p><b>${esc(titleOf(d))}</b></p><p><br></p>` + toHtml(d);
      const { all, ...save } = d;
      store.set('draft', save);
    }
    $f.addEventListener('input', update);
    $f.addEventListener('change', update);
    // 부서를 바꾸면 그 부서 명단으로 참석자 칸을 다시 그림 (다른 부서에서 체크한 사람은 풀림)
    const $dp = document.getElementById('deptPick');
    if ($dp) $dp.onclick = (e) => {
      const b = e.target.closest('[data-d]');
      if (!b || b.dataset.d === dept) return;
      dept = b.dataset.d;
      store.set('lastDept', dept);
      $dp.querySelectorAll('[data-d]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.d === dept)));
      const list = rosterOf(dept);
      const kept = new FormData($f).getAll('people').filter((n) => list.includes(n));
      document.getElementById('checks').innerHTML = checkBoxes(list, kept);
      document.getElementById('rosterList').innerHTML = list.map((n) => `<option value="${esc(n)}">`).join('');
      update();
    };
    $f.addEventListener('submit', (e) => e.preventDefault());
    update();

    async function copy(html, text) {
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
    document.getElementById('copyTitle').onclick = async () => {
      const t = titleOf(read());
      toast((await copy(esc(t), t)) ? '제목을 복사했어요' : '복사하지 못했어요. 미리보기를 길게 눌러 복사해 주세요');
    };
    document.getElementById('copyBody').onclick = async () => {
      const d = read();
      if (!d.all.length && !d.share) { toast('참석자나 나눔을 먼저 입력해 주세요'); return; }
      toast((await copy(toHtml(d), toText(d))) ? '본문을 복사했어요. 게시판에 붙여넣으세요' : '복사하지 못했어요. 미리보기를 길게 눌러 복사해 주세요');
    };
    const $post = document.getElementById('postNow');
    if ($post) $post.onclick = async () => {
      const d = read();
      if (!d.all.length && !d.share) { toast('참석자나 나눔을 먼저 입력해 주세요'); return; }
      const title = titleOf(d);
      if (!confirm(`청년회교제실 게시판에 올릴까요?\n\n제목: ${title}\n참석자: ${d.all.length}명 · 사진: ${photos.length}장\n\n올리면 교회 사이트에 바로 보여요.`)) return;
      const label = $post.textContent;
      $post.disabled = true;
      const done = (msg) => { $post.disabled = false; $post.textContent = label; if (msg) toast(msg); };
      // 1) 사진을 한 장씩 올려서 fileId 받기
      const fileId = [];
      const fileName = [];
      for (const [i, ph] of photos.entries()) {
        $post.textContent = `사진 올리는 중… ${i + 1}/${photos.length}`;
        const r = await uploadPhoto(ph.blob, ph.name);
        const f = r.status === 'ok' && r.result && typeof r.result === 'object' ? r.result : null;
        if (!f?.fileId) { done(`사진을 올리지 못했어요: ${typeof r.result === 'string' ? r.result : '알 수 없는 오류'}`); return; }
        fileId.push(String(f.fileId));
        fileName.push(String(f.fileName || ph.name));
      }
      // 2) 글 등록
      $post.textContent = '글 올리는 중…';
      const r = await callApi('board_write', {
        boardId: String(C.board.boardId), subject: title, content: toHtml(d),
        ...(fileId.length ? { fileId, fileName } : {}),
      });
      if (r.status !== 'ok') { done(`올리지 못했어요: ${typeof r.result === 'string' ? r.result : '알 수 없는 오류'}`); return; }
      store.del('draft');
      photos.splice(0).forEach((p) => URL.revokeObjectURL(p.url));
      state.posts = null; state.loading = null; state.rosters = null; // 목록 새로 불러오기
      toast('게시판에 올렸어요 🎉');
      location.hash = r.result?.uid ? `#/post/${r.result.uid}` : '#/';
    };

    document.getElementById('reset').onclick = () => {
      if (!confirm('작성 중인 내용을 지우고 새로 쓸까요?')) return;
      store.del('draft');
      photos.splice(0).forEach((p) => URL.revokeObjectURL(p.url));
      viewWrite();
    };

    // 사진
    const $pi = document.getElementById('photoInput');
    const $save = document.getElementById('savePhotos');
    const drawPhotos = () => {
      document.getElementById('photos').innerHTML = photos.map((p, i) => `
        <div class="photo"><img src="${p.url}" alt=""><small>${mb(p.before)} → ${mb(p.after)}</small><button type="button" data-del="${i}" aria-label="사진 빼기">×</button></div>`).join('');
      $save.hidden = !photos.length;
    };
    drawPhotos();
    document.getElementById('addPhoto').onclick = () => $pi.click();
    $pi.onchange = async () => {
      const files = [...$pi.files];
      $pi.value = '';
      if (!files.length) return;
      toast(`사진 ${files.length}장을 줄이는 중…`);
      for (const f of files) {
        try { photos.push(await shrink(f)); } catch { toast(`${f.name}: 읽을 수 없는 사진이에요`); }
      }
      drawPhotos();
      toast('사진을 줄였어요');
    };
    document.getElementById('photos').onclick = (e) => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      const [p] = photos.splice(Number(b.dataset.del), 1);
      URL.revokeObjectURL(p.url);
      drawPhotos();
    };
    $save.onclick = async () => {
      const files = photos.map((p) => new File([p.blob], p.name, { type: 'image/jpeg' }));
      if (navigator.canShare?.({ files })) {
        try { await navigator.share({ files }); return; } catch (e) { if (e.name === 'AbortError') return; }
      }
      photos.forEach((p) => { const a = document.createElement('a'); a.href = p.url; a.download = p.name; document.body.appendChild(a); a.click(); a.remove(); });
    };
  }

  /* ─── 화면: 설정 ─────────────────────────── */
  async function viewSettings() {
    syncNav();
    const roster = getRoster();
    const B = C.board;
    const SAMPLES = {
      board_post: { ...B.listParams, [B.pageParam]: 1, [B.limitParam]: 5 },
      board_latest: { boardIds: String(B.boardId), cnt: 3 },
      board_comment: { board_uid: '', orderby: 'ASC' },
      member_search: { q: '' },
    };
    const sampleJson = (api) => JSON.stringify(SAMPLES[api] || {}, null, 2);
    const defaultParams = sampleJson('board_post');
    const me = auth.me;
    $app.innerHTML = `
      <div class="page-head"><h1>설정</h1><p>명단은 이 기기에만 저장돼요</p></div>
      <div class="stack">
        <section class="card stack" id="loginCard">
          <h2 class="month" style="margin:0">내 계정</h2>
          <div class="login-on"><span class="avatar" aria-hidden="true">${esc((me?.name || '나').slice(0, 1))}</span><div><b>${esc(me?.name || '로그인됨')}</b>${me?.sex ? ` ${esc(me.sex)}` : ''}${me?.admin ? ' <span class="badge">관리자</span>' : ''}<br><span class="small muted">${esc([me?.church, me?.userid].filter(Boolean).join(' · '))}</span></div></div>
          <div class="btn-row"><button class="btn" id="logout">로그아웃</button></div>
        </section>
        <section class="card stack">
          <h2 class="month" style="margin:0">이 기기 명단</h2>
          <p class="small muted" style="margin:0">한 줄에 한 명씩. 부서 명단이 등록되기 전에만 작성 화면의 참석자 목록으로 쓰여요.</p>
          <textarea class="textarea" id="roster" rows="8" placeholder="김가람&#10;이나래&#10;박한결">${esc(roster.join('\n'))}</textarea>
          <div class="btn-row"><button class="btn btn--primary" id="saveRoster">명단 저장</button><button class="btn" id="fromPosts">교제록에서 이름 가져오기</button></div>
        </section>
        <section class="card stack">
          <h2 class="month" style="margin:0">API 연결 확인</h2>
          <p class="small muted" style="margin:0">게시판 API 파라미터를 시험해 보는 곳이에요. 결과가 <b>status: ok</b>로 나오면 성공입니다. 로그인돼 있으면 hash는 자동으로 붙어요.</p>
          <label class="field"><span>API</span>
            <select class="select" id="api">
              <option value="board_post">게시글 목록·상세 (load_boardb_post)</option>
              <option value="board_latest">최신글 (load_boardb_latest)</option>
              <option value="board_comment">댓글 (load_boardb_comment)</option>
              <option value="member_search">회원 검색 (load_member_search) — 로그인 필요</option>
            </select>
          </label>
          <label class="field"><span>보낼 값 (JSON)</span><textarea class="textarea" id="params" rows="6" style="font-family:ui-monospace,Menlo,monospace;font-size:14px">${esc(defaultParams)}</textarea></label>
          <div class="btn-row"><button class="btn btn--primary" id="run">호출하기</button><button class="btn" id="reload">교제록 다시 불러오기</button></div>
          <pre class="json" id="out" hidden></pre>
        </section>
      </div>`;

    const lines = (id) => document.getElementById(id).value.split('\n').map((s) => s.trim()).filter(Boolean);
    document.getElementById('saveRoster').onclick = () => {
      store.set('roster', [...new Set(lines('roster'))]);
      toast('명단을 저장했어요');
    };
    document.getElementById('fromPosts').onclick = async () => {
      const posts = await loadPosts();
      const names = [...new Set([...lines('roster'), ...posts.flatMap((p) => p.people)])];
      document.getElementById('roster').value = names.join('\n');
      toast(`${names.length}명을 채웠어요. 확인 후 저장을 눌러주세요`);
    };
    document.getElementById('api').onchange = (e) => {
      document.getElementById('params').value = sampleJson(e.target.value);
    };

    document.getElementById('logout').onclick = () => {
      if (!confirm('로그아웃할까요?')) return;
      signOut();
      toast('로그아웃했어요');
      location.hash = '#/';
      route();
    };
    document.getElementById('run').onclick = async () => {
      const $out = document.getElementById('out');
      let params;
      try { params = JSON.parse(document.getElementById('params').value || '{}'); } catch { toast('JSON 모양이 올바르지 않아요'); return; }
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

  /* ─── 관리자 (Cloudflare 환경 변수 ADMINS 에 아이디가 있는 사람) ─── */
  const isAdmin = () => !!(auth.hash && auth.me?.admin);
  const syncNav = () => {
    const a = document.querySelector('.tabs a[data-tab="attendance"]');
    if (a) a.hidden = !isAdmin();
  };
  function viewAdminOnly() {
    $app.innerHTML = `<div class="page-head"><h1>참석 흐름</h1></div><div class="empty">🔒 관리자만 볼 수 있는 화면이에요</div>`;
  }

  /* ─── 로그인 화면 (로그인해야 교제록에 들어갈 수 있음) ─── */
  function signOut() {
    auth.clear();
    state.posts = null; state.loading = null; state.rosters = null;
  }
  function viewLogin() {
    $app.innerHTML = `
      <div class="login">
        <div class="login__brand">
          <span class="brand__mark login__mark" aria-hidden="true"></span>
          <h1><b>${esc(C.groupName)}</b> 교제록</h1>
          <p>깨사모 아이디로 로그인해 주세요</p>
        </div>
        <form class="card login__card" id="loginForm" autocomplete="on">
          <label class="field"><span>아이디</span><input class="input" name="userid" value="${esc(store.get('lastUserid', ''))}" autocomplete="username" autocapitalize="off" spellcheck="false" required></label>
          <label class="field"><span>비밀번호</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
          <p class="login__error" id="loginError" role="alert" hidden></p>
          <button class="btn btn--primary login__btn" type="submit" id="loginBtn">로그인</button>
        </form>
        <p class="login__note">청년회교제실은 회원 전용이에요. 비밀번호는 저장하지 않고,<br>로그인 확인값만 이 기기에 남아요.</p>
      </div>`;
    const $f = document.getElementById('loginForm');
    const $btn = document.getElementById('loginBtn');
    const $err = document.getElementById('loginError');
    $f[store.get('lastUserid', '') ? 'password' : 'userid'].focus();
    $f.onsubmit = async (e) => {
      e.preventDefault();
      const userid = String($f.userid.value || '').trim();
      $btn.disabled = true; $btn.textContent = '로그인 중…'; $err.hidden = true;
      const r = await callApi('login', { Userid: userid, password: String($f.password.value || '') });
      if (r.status !== 'ok' || !r.hash) {
        $btn.disabled = false; $btn.textContent = '로그인';
        $err.textContent = String(r.result || '로그인하지 못했어요');
        $err.hidden = false;
        $f.password.value = '';
        $f.password.focus();
        return;
      }
      const m = await callApi('me', { hash: r.hash });
      signOut();
      auth.set(r.hash, m.status === 'ok' ? m.result : null);
      store.set('lastUserid', userid);
      toast(`${m.result?.name || ''} 반가워요 👋`.trim());
      route();
    };
  }

  /* ─── 라우터 ─────────────────────────────── */
  function route() {
    const locked = !auth.hash;
    document.body.classList.toggle('locked', locked);
    if (locked) { window.scrollTo(0, 0); return viewLogin(); }
    const h = location.hash.replace(/^#\/?/, '');
    const [name, ...rest] = h.split('/');
    const tab = name === 'post' || !name ? 'list' : name;
    syncNav();
    document.querySelectorAll('.tabs a').forEach((a) => {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
    if (name === 'post') return viewPost(decodeURIComponent(rest.join('/')));
    if (name === 'prayers') return viewPrayers();
    if (name === 'attendance') return isAdmin() ? viewAttendance() : viewAdminOnly();
    if (name === 'write') return viewWrite();
    if (name === 'settings') return viewSettings();
    return viewList();
  }
  window.addEventListener('hashchange', route);
  route();

  // 로그인돼 있으면 이름·관리자 여부를 새로 받아 둠 (관리자 목록이 바뀌어도 반영되도록)
  if (auth.hash) {
    callApi('me').then((m) => {
      if (m.status !== 'ok' || !auth.hash) return;
      const was = isAdmin();
      auth.set(auth.hash, m.result);
      syncNav();
      if (was !== isAdmin() && /^#\/attendance/.test(location.hash)) route();
    });
  }
})();
