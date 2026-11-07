/* 청년회 교제록 — 화면 동작
 * 구성: 모아보기(목록·상세·검색·월별) / 기도제목 / 참석 흐름 / 작성(복사해서 붙여넣기) / 설정
 * 게시판 API가 아직 확정되지 않아, 연결이 안 되면 예시 데이터로 화면을 보여줍니다.
 */
(() => {
  'use strict';
  const C = window.APP_CONFIG;
  const $app = document.getElementById('app');
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const DAY_MS = 86400000;

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

  /* ─── API 중계 호출 ──────────────────────── */
  async function callApi(api, params) {
    try {
      const res = await fetch('/api/jbch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api, params }),
      });
      const text = await res.text();
      try { return JSON.parse(text); } catch { return { status: 'error', result: `중계 서버 응답 오류 (HTTP ${res.status})` }; }
    } catch {
      return { status: 'error', result: '인터넷 연결을 확인해 주세요' };
    }
  }

  /* ─── 게시글 정리 (응답 모양이 확정되지 않아 여러 이름을 받아줌) ─── */
  const pick = (o, keys) => {
    for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k];
    return '';
  };
  function rowsOf(r) {
    const x = r.result ?? r.list ?? r.data;
    if (Array.isArray(x)) return x;
    if (x && typeof x === 'object') {
      for (const k of ['list', 'rows', 'posts', 'data', 'items']) if (Array.isArray(x[k])) return x[k];
      return [x];
    }
    return [];
  }
  function htmlToText(html) {
    const prepared = String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n');
    const doc = new DOMParser().parseFromString(prepared, 'text/html');
    return (doc.body.textContent || '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  const SECTION_KEYS = [
    ['참석', 'people'], ['말씀', 'verse'], ['나눔', 'share'], ['기도', 'prayer'],
    ['번개', 'bungae'], ['작성', 'writer'], ['날짜', 'date'],
  ];
  function parseSections(text) {
    const out = {};
    let cur = null;
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*[■▶●◆]\s*([^:：(（]+)(?:[(（][^)）]*[)）])?\s*[:：]?\s*(.*)$/);
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
  function normPost(o) {
    const body = String(pick(o, ['content', 'contents', 'memo', 'body', 'bd_content', 'text']));
    const text = htmlToText(body);
    const sec = parseSections(text);
    const date = parseDate(sec.date?.[0]) || parseDate(pick(o, ['regdate', 'reg_date', 'wdate', 'date', 'created_at', 'writeday', 'w_date']));
    const people = (sec.people?.join(' ') || '')
      .split(/[,，、·/]+|\s+/).map((s) => s.trim()).filter((s) => s.length >= 2 && !/^\d+명$/.test(s));
    const prayers = (sec.prayer || []).map((l) => {
      const m = l.match(/^[-·•*]?\s*([^:：]{1,12}?)\s*[:：]\s*(.+)$/);
      return m ? { name: m[1].trim(), text: m[2].trim() } : { name: '', text: l.replace(/^[-·•*]\s*/, '') };
    });
    return {
      id: String(pick(o, ['idx', 'id', 'no', 'seq', 'post_idx', 'boardb_idx', 'bd_idx', 'num', 'uid'])),
      title: String(pick(o, ['subject', 'title', 'bd_subject']) || (date ? `교제록 · ${korDate(date)}` : '교제록')),
      author: String(sec.writer?.[0] || pick(o, ['name', 'writer', 'user_name', 'username', 'nick'])),
      date,
      body,
      text,
      sec,
      people,
      verse: sec.verse?.[0] || '',
      verseNote: (sec.verse || []).slice(1).join('\n'),
      share: (sec.share || []).join('\n'),
      bungae: (sec.bungae || []).join('\n'),
      prayers,
      structured: Object.keys(sec).length >= 2,
    };
  }

  /* ─── 게시글 불러오기 ────────────────────── */
  const state = { posts: null, source: '', error: '', loading: null, q: '', month: '', prayerMode: 'person' };

  function loadPosts(force) {
    if (state.posts && !force) return Promise.resolve(state.posts);
    if (state.loading && !force) return state.loading;
    state.loading = (async () => {
      const B = C.board;
      const all = [];
      const seen = new Set();
      let firstError = '';
      for (let page = 1; page <= B.pagesToLoad; page++) {
        const r = await callApi('board_post', { ...B.listParams, [B.pageParam]: page });
        if (r.status !== 'ok') {
          if (page === 1) firstError = r.status === 'not' ? '게시글이 없습니다' : String(r.result || '알 수 없는 오류');
          break;
        }
        const rows = rowsOf(r).map(normPost).filter((p) => p.id && !seen.has(p.id));
        if (!rows.length) break;
        rows.forEach((p) => { seen.add(p.id); all.push(p); });
      }
      if (all.length) {
        state.source = 'api'; state.error = '';
        state.posts = all;
      } else {
        state.source = 'sample'; state.error = firstError;
        state.posts = window.SAMPLE_POSTS.map(normPost);
      }
      state.posts.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
      state.loading = null;
      return state.posts;
    })();
    return state.loading;
  }

  async function loadDetail(id) {
    const posts = await loadPosts();
    let p = posts.find((x) => x.id === id);
    if (p && !p.body && state.source === 'api') {
      const B = C.board;
      const r = await callApi('board_post', { ...B.listParams, [B.detailParam]: id });
      if (r.status === 'ok' && rowsOf(r)[0]) {
        const full = normPost(rowsOf(r)[0]);
        Object.assign(p, full, { id: p.id });
      }
    }
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

  const sampleNotice = () =>
    state.source === 'sample'
      ? `<div class="notice"><span>📋</span><div><b>예시 데이터로 보여주는 중</b><br>게시판 API가 아직 연결되지 않았어요.${state.error ? ` <span class="muted">(${esc(state.error)})</span>` : ''} 설정 → 연결 확인에서 테스트할 수 있어요.</div></div>`
      : '';
  const skeleton = () => `<div class="loading">${'<div class="skeleton"></div>'.repeat(4)}</div>`;

  /* ─── 화면: 모아보기 ─────────────────────── */
  async function viewList() {
    $app.innerHTML = `
      <div class="page-head"><h1>교제록 모아보기</h1><p>주마다 나눈 말씀과 교제를 한눈에</p></div>
      <div id="notice"></div>
      <label class="search"><input class="input" id="q" type="search" placeholder="이름, 말씀, 나눔 내용으로 검색" value="${esc(state.q)}" autocomplete="off"></label>
      <div class="chips" id="months"></div>
      <div id="list">${skeleton()}</div>`;
    const posts = await loadPosts();
    if (!document.getElementById('list')) return;
    document.getElementById('notice').innerHTML = sampleNotice();

    const months = [...new Set(posts.filter((p) => p.date).map((p) => monthKey(p.date)))];
    const $months = document.getElementById('months');
    const drawMonths = () => {
      $months.innerHTML = [['', '전체'], ...months.map((m) => [m, monthLabel(m)])]
        .map(([k, l]) => `<button class="chip" data-m="${k}" aria-pressed="${state.month === k}">${l}</button>`).join('');
    };
    drawMonths();
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
      const rows = posts.filter((p) =>
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
              <p class="excerpt">${highlight(excerpt, state.q)}</p>
              <div class="meta">
                ${p.people.length ? `<span>👥 ${p.people.length}명</span>` : ''}
                ${p.prayers.length ? `<span>🙏 기도제목 ${p.prayers.length}</span>` : ''}
                ${p.bungae ? `<span>⚡ 번개 후기</span>` : ''}
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
          sec('번개 후기', para(p.bungae)),
        ].join('')
      : `<div class="section raw-html">${sanitize(p.body)}</div>`;
    $app.innerHTML = `
      <a class="back" href="#/">목록</a>
      ${sampleNotice()}
      <article class="card detail">
        <h1>${esc(p.title)}</h1>
        <div class="meta">${p.date ? `<span>📅 ${dotDate(p.date)} (${WEEK[p.date.getDay()]})</span>` : ''}${p.author ? `<span>✍️ ${esc(p.author)}</span>` : ''}</div>
        ${body}
      </article>`;
  }

  /* ─── 화면: 기도제목 모아보기 ────────────── */
  async function viewPrayers() {
    $app.innerHTML = `
      <div class="page-head"><h1>기도제목</h1><p>서로의 기도제목을 기억하고 함께 기도해요</p></div>
      <div id="notice"></div>
      <label class="search"><input class="input" id="pq" type="search" placeholder="이름이나 내용으로 찾기" autocomplete="off"></label>
      <div class="chips" id="pmode"></div>
      <div id="plist">${skeleton()}</div>`;
    const posts = await loadPosts();
    if (!document.getElementById('plist')) return;
    document.getElementById('notice').innerHTML = sampleNotice();
    const items = posts.flatMap((p) => p.prayers.map((x) => ({ ...x, date: p.date, postId: p.id })));
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
    $app.innerHTML = `<div class="page-head"><h1>참석 흐름</h1><p>주마다 누가 함께했는지 살펴봐요</p></div><div id="body">${skeleton()}</div>`;
    const posts = (await loadPosts()).filter((p) => p.date && p.people.length);
    const $b = document.getElementById('body');
    if (!$b) return;
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

  /* ─── 명단·작성 순번 ─────────────────────── */
  const getRoster = () => store.get('roster', []);
  const getDuty = () => store.get('duty', { order: [], start: '' });
  function dutyFor(date) {
    const { order, start } = getDuty();
    const list = order.length ? order : getRoster();
    if (!list.length) return '';
    const s = parseDate(start);
    if (!s) return list[0];
    const w = Math.floor((date - s) / (7 * DAY_MS));
    return list[((w % list.length) + list.length) % list.length];
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
    const roster = getRoster();
    const today = new Date();
    const draft = store.get('draft', null) || { date: ymd(today), writer: dutyFor(today), people: [], extra: '', verse: '', verseNote: '', share: '', prayers: {}, bungae: '' };

    $app.innerHTML = `
      <div class="page-head"><h1>교제록 작성</h1><p>양식대로 쓰고, 복사해서 교회 사이트 게시판에 붙여넣어요</p></div>
      ${roster.length ? '' : `<div class="notice"><span>👥</span><div><b>명단이 비어 있어요</b><br>참석자를 체크하려면 <a href="#/settings">설정</a>에서 청년회 명단을 먼저 입력해 주세요.</div></div>`}
      <div class="duty"><div>이번 주 작성 담당 <b id="dutyName">${esc(dutyFor(parseDate(draft.date) || today) || '—')}</b></div><span class="small muted">다음 주: ${esc(dutyFor(new Date((parseDate(draft.date) || today).getTime() + 7 * DAY_MS)) || '—')}</span></div>
      <form class="card form-card" id="f" autocomplete="off">
        <div class="grid-2">
          <label class="field"><span>날짜</span><input class="input" type="date" name="date" value="${esc(draft.date)}"></label>
          <label class="field"><span>작성자</span><input class="input" name="writer" list="rosterList" value="${esc(draft.writer)}" placeholder="이름"></label>
        </div>
        <datalist id="rosterList">${roster.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <div class="field"><span>참석자 <b id="pc" class="muted"></b></span>
          <div class="checks" id="checks">${roster.map((n) => `<label class="check"><input type="checkbox" name="people" value="${esc(n)}"${draft.people.includes(n) ? ' checked' : ''}><span>${esc(n)}</span></label>`).join('')}</div>
          <input class="input" name="extra" value="${esc(draft.extra)}" placeholder="명단에 없는 사람 (쉼표로 구분, 예: 새가족 홍길동)" style="margin-top:8px">
        </div>
        <label class="field"><span>말씀 본문</span><input class="input" name="verse" value="${esc(draft.verse)}" placeholder="예: 요한복음 15:5"></label>
        <label class="field"><span>말씀 요약</span><textarea class="textarea" name="verseNote" placeholder="말씀에서 받은 은혜를 간단히">${esc(draft.verseNote)}</textarea></label>
        <label class="field"><span>나눔</span><textarea class="textarea" name="share" rows="5" placeholder="함께 나눈 이야기">${esc(draft.share)}</textarea></label>
        <div class="field"><span>기도제목</span><div class="prayer-inputs" id="prayers"></div></div>
        <label class="field"><span>번개 후기 <span class="muted small">(선택)</span></span><textarea class="textarea" name="bungae" placeholder="이번 주 번개 모임이 있었다면">${esc(draft.bungae)}</textarea></label>
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
        <ol class="steps">
          <li><b>제목 복사</b> → 게시판 글쓰기의 제목 칸에 붙여넣기</li>
          <li><b>본문 복사</b> → 내용 칸에 붙여넣기</li>
          <li>줄인 사진을 게시판의 사진 첨부로 올리기</li>
        </ol>
      </div>

      <div class="sticky-actions"><div class="btn-row">
        <button class="btn" id="copyTitle">제목 복사</button>
        <button class="btn btn--primary" id="copyBody">본문 복사</button>
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
        date: String(fd.get('date') || ''), writer: String(fd.get('writer') || '').trim(),
        people, extra, all: [...people, ...extras.filter((n) => !people.includes(n))],
        verse: String(fd.get('verse') || '').trim(), verseNote: String(fd.get('verseNote') || '').trim(),
        share: String(fd.get('share') || '').trim(), bungae: String(fd.get('bungae') || '').trim(),
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
    const titleOf = (d) => { const dt = parseDate(d.date); return `${C.groupName} 교제록 · ${dt ? `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일` : ''}`; };
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
      if (d.bungae) out.push(['번개 후기', '', d.bungae]);
      return out;
    }
    const toText = (d) => lines(d).map(([k, v, more]) => `■ ${k}${v ? ': ' + v : ''}${more ? '\n' + more : ''}`).join('\n\n');
    const toHtml = (d) => lines(d).map(([k, v, more]) =>
      `<p><b>■ ${esc(k)}</b>${v ? ': ' + esc(v) : ''}</p>${more ? more.split('\n').map((l) => `<p>${esc(l)}</p>`).join('') : ''}<p><br></p>`).join('');

    function update() {
      const d = read();
      drawPrayers(d.all);
      document.getElementById('pc').textContent = d.all.length ? `${d.all.length}명` : '';
      const dt = parseDate(d.date);
      if (dt) document.getElementById('dutyName').textContent = dutyFor(dt) || '—';
      document.getElementById('preview').innerHTML = `<p><b>${esc(titleOf(d))}</b></p><p><br></p>` + toHtml(d);
      const { all, ...save } = d;
      store.set('draft', save);
    }
    $f.addEventListener('input', update);
    $f.addEventListener('change', update);
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
    const roster = getRoster();
    const duty = getDuty();
    const defaultParams = JSON.stringify({ ...C.board.listParams, [C.board.pageParam]: 1 }, null, 2);
    $app.innerHTML = `
      <div class="page-head"><h1>설정</h1><p>명단과 작성 순번은 이 기기에만 저장돼요</p></div>
      <div class="stack">
        <section class="card stack">
          <h2 class="month" style="margin:0">청년회 명단</h2>
          <p class="small muted" style="margin:0">한 줄에 한 명씩. 작성 화면의 참석자 체크 목록이 됩니다.</p>
          <textarea class="textarea" id="roster" rows="8" placeholder="김가람&#10;이나래&#10;박한결">${esc(roster.join('\n'))}</textarea>
          <div class="btn-row"><button class="btn btn--primary" id="saveRoster">명단 저장</button><button class="btn" id="fromPosts">교제록에서 이름 가져오기</button></div>
        </section>
        <section class="card stack">
          <h2 class="month" style="margin:0">작성 담당 순번</h2>
          <p class="small muted" style="margin:0">돌아가며 쓸 순서대로 한 줄에 한 명씩. 비워두면 명단 순서를 따라요. 시작 날짜에 첫 번째 사람이 담당이고, 매주 다음 사람으로 넘어갑니다.</p>
          <textarea class="textarea" id="order" rows="6">${esc(duty.order.join('\n'))}</textarea>
          <label class="field"><span>시작 날짜</span><input class="input" type="date" id="start" value="${esc(duty.start)}"></label>
          <div class="btn-row"><button class="btn btn--primary" id="saveDuty">순번 저장</button></div>
          <p class="small" id="dutyPreview" style="margin:0"></p>
        </section>
        <section class="card stack">
          <h2 class="month" style="margin:0">API 연결 확인</h2>
          <p class="small muted" style="margin:0">게시판 API 파라미터를 시험해 보는 곳이에요. 결과가 <b>status: ok</b>로 나오면 성공입니다.</p>
          <label class="field"><span>API</span>
            <select class="select" id="api">
              <option value="board_post">게시글 목록·상세 (load_boardb_post)</option>
              <option value="board_latest">최신글 (load_boardb_latest)</option>
              <option value="board_comment">댓글 (load_boardb_comment)</option>
              <option value="member_search">회원 검색 (load_member_search) — hash 필요</option>
            </select>
          </label>
          <label class="field"><span>보낼 값 (JSON)</span><textarea class="textarea" id="params" rows="6" style="font-family:ui-monospace,Menlo,monospace;font-size:14px">${esc(defaultParams)}</textarea></label>
          <div class="btn-row"><button class="btn btn--primary" id="run">호출하기</button><button class="btn" id="reload">교제록 다시 불러오기</button></div>
          <pre class="json" id="out" hidden></pre>
        </section>
      </div>`;

    const lines = (id) => document.getElementById(id).value.split('\n').map((s) => s.trim()).filter(Boolean);
    const drawDutyPreview = () => {
      const now = new Date();
      const next = [0, 1, 2, 3].map((i) => {
        const d = new Date(now.getTime() + i * 7 * DAY_MS);
        return `${d.getMonth() + 1}/${d.getDate()} ${esc(dutyFor(d) || '—')}`;
      });
      document.getElementById('dutyPreview').innerHTML = `<span class="muted">앞으로 4주:</span> ${next.join(' · ')}`;
    };
    drawDutyPreview();

    document.getElementById('saveRoster').onclick = () => {
      store.set('roster', [...new Set(lines('roster'))]);
      toast('명단을 저장했어요');
      drawDutyPreview();
    };
    document.getElementById('fromPosts').onclick = async () => {
      const posts = await loadPosts();
      const names = [...new Set([...lines('roster'), ...posts.flatMap((p) => p.people)])];
      document.getElementById('roster').value = names.join('\n');
      toast(`${names.length}명을 채웠어요. 확인 후 저장을 눌러주세요`);
    };
    document.getElementById('saveDuty').onclick = () => {
      store.set('duty', { order: lines('order'), start: document.getElementById('start').value });
      toast('순번을 저장했어요');
      drawDutyPreview();
    };
    document.getElementById('api').onchange = (e) => {
      const v = e.target.value;
      document.getElementById('params').value = v === 'member_search'
        ? JSON.stringify({ hash: '', q: '' }, null, 2)
        : defaultParams;
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
      toast(state.source === 'api' ? `교제록 ${state.posts.length}개를 불러왔어요` : `연결 실패: ${state.error || '예시 데이터 사용 중'}`);
    };
  }

  /* ─── 라우터 ─────────────────────────────── */
  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const [name, ...rest] = h.split('/');
    const tab = name === 'post' || !name ? 'list' : name;
    document.querySelectorAll('.tabs a').forEach((a) => {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
    if (name === 'post') return viewPost(decodeURIComponent(rest.join('/')));
    if (name === 'prayers') return viewPrayers();
    if (name === 'attendance') return viewAttendance();
    if (name === 'write') return viewWrite();
    if (name === 'settings') return viewSettings();
    return viewList();
  }
  window.addEventListener('hashchange', route);
  route();
})();
