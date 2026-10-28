// ==UserScript==
// @name         디자인번들 이번주 무료 → 자동 다운로드 + 옵시디언 저장 (5일마다 새로고침)
// @namespace    whdhrdus07
// @version      0.9
// @description  [v0.9 대시보드 전송 추가] designbundles.net/free-design-resources 의 'Free products of the week' 4개를 차례로 들어가 다운로드하고 목록으로 돌아오기를 반복, 끝나면 옵시디언에 자동 저장(obsidian://new + 클립보드). 5일마다 새로고침.
// @match        https://designbundles.net/*
// @match        https://fontbundles.net/*
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ================= 설정 ================= */
  const CONFIG = {
    VAULT: '',                                             // 옵시디언 볼트 이름 (비우면 마지막으로 연 볼트)
    FOLDER: '05_자료/링크 아카이브/mhtml/designbundles',   // 저장 폴더
    LIST_PATH: '/free-design-resources',                   // 시작(목록) 페이지 경로
    SAVE_MODE: 'daily',     // 'daily' = 이번에 받은 항목을 노트 1개로 / 'each' = 항목마다 노트 1개
    REFRESH_DAYS: 5,        // 며칠마다 새로고침 + 자동 실행
    START_DELAY: 3,         // 목록 페이지 열고 n초 뒤 시작
    WAIT_BUTTON_SEC: 25,    // 상세 페이지에서 다운로드 버튼이 나타날 때까지 최대 대기(초)
    MAX_RETRY: 1,           // 렉일 때 새로고침 후 재시도 횟수
    STUCK_RELOAD_SEC: 40,   // 파일 준비가 이 시간(초) 넘게 멈추면 새로고침 후 재시도
    BUSY_MAX_SEC: 90,       // 파일 준비(aria-busy)가 끝나길 기다리는 최대 시간(초)
    AFTER_CLICK_MS: 8000,   // 마지막 클릭 후 다음으로 넘어가기까지 대기(ms)
    BETWEEN_CLICK_MS: 2500, // 한 페이지 안에서 버튼 클릭 사이 대기(ms)
    MAX_CLICKS: 4,          // 한 페이지에서 최대 클릭 횟수 (무한 반복 방지)
    EACH_SAVE_GAP: 2500,    // 'each' 모드에서 노트 사이 간격(ms)
    STATE_TTL_MIN: 60,      // 진행 상태가 이 시간(분) 넘게 멈춰 있으면 버림
  };


  // ---------- 무료 정보 허브(대시보드)로 전송 ----------
  const HUB_URL = '';     // Apps Script 웹 앱 URL (…/exec 로 끝나는 주소)
  const HUB_SECRET = '';  // Apps Script 스크립트 속성 SECRET 과 같은 값

  function hubToast(text) {
    try {
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'fixed', left: '16px', bottom: '16px', zIndex: 2147483647, background: '#222', color: '#fff',
        padding: '8px 12px', borderRadius: '8px', font: '12px/1.4 sans-serif', boxShadow: '0 4px 14px rgba(0,0,0,.35)',
      });
      el.textContent = text;
      document.documentElement.appendChild(el);
      setTimeout(() => el.remove(), 7000);
    } catch (e) {}
  }

  function pushToHub(source, items, opts) {
    if (!items || !items.length) return;
    if (!HUB_URL || !HUB_SECRET) { console.warn('[허브] HUB_URL / HUB_SECRET 이 비어 있어서 전송 안 함'); return; }
    GM_xmlhttpRequest({
      method: 'POST',
      url: HUB_URL,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ secret: HUB_SECRET, action: 'push', source, ttl_days: (opts && opts.ttl) || 14, items }),
      onload: (r) => {
        let ok = false;
        try { ok = JSON.parse(r.responseText).ok === true; } catch (e) {}
        console.log('[허브] 전송 결과', r.status, (r.responseText || '').slice(0, 120));
        hubToast(ok ? `📤 허브로 ${items.length}개 전송 완료 (${source})` : `⚠ 허브 전송 실패: ${(r.responseText || r.status + '').slice(0, 40)}`);
      },
      onerror: () => hubToast('⚠ 허브 전송 실패 (네트워크)'),
    });
  }

  /* ================= 유틸 ================= */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DL_PATH = 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4';
  const WEEKLY_RE = /(free-font-of-the-week|free-design-of-the-week)/;
  const DAY = 24 * 60 * 60 * 1000;
  const pad = (n) => String(n).padStart(2, '0');
  const D = new Date();
  const today = () => `${D.getFullYear()}-${pad(D.getMonth() + 1)}-${pad(D.getDate())}`;
  const timeStr = () => `${pad(D.getHours())}${pad(D.getMinutes())}`;
  const safeName = (str, max = 120) => {
    let t = String(str).replace(/[^\p{L}\p{N}\p{M} _\-.,·()]/gu, '_');
    t = t.replace(/\s+/g, ' ').replace(/_{2,}/g, '_').replace(/ ?_ ?/g, '_').replace(/^[_ .]+|[_ .]+$/g, '');
    return t.length > max ? t.slice(0, max).replace(/[_ .]+$/g, '') : t;
  };
  const cleanTitle = (t) => String(t).replace(/\s*[-–|]\s*free (font|design)s? of (the )?week\s*$/i, '').trim();
  const yq = (s) => String(s).replace(/"/g, "'").replace(/\s+/g, ' ').trim();
  const isListPage = () => location.hostname === 'designbundles.net' && location.pathname.replace(/\/$/, '') === CONFIG.LIST_PATH;

  /* ================= 저장소 (도메인이 달라도 공유됨) ================= */
  const DL_PREFIX = 'dl:';
  const keyOf = (title) => DL_PREFIX + title.toLowerCase().replace(/\s+/g, ' ').trim();
  const getDone = (title) => { try { return GM_getValue(keyOf(title), null); } catch (e) { return null; } };
  const markDone = (title) => { try { GM_setValue(keyOf(title), { at: new Date().toISOString() }); } catch (e) {} };
  const doneKeys = () => { try { return GM_listValues().filter((k) => k.startsWith(DL_PREFIX)); } catch (e) { return []; } };
  const LAST_RUN_KEY = 'lastRunAt';
  const getLastRun = () => { try { return Number(GM_getValue(LAST_RUN_KEY, 0)) || 0; } catch (e) { return 0; } };
  const setLastRun = () => { try { GM_setValue(LAST_RUN_KEY, Date.now()); } catch (e) {} };

  // 진행 상태: { phase:'visit'|'save', queue:[{title,url,image}], idx, done:[...], clicked, at }
  const STATE_KEY = 'runState';
  const getState = () => {
    try {
      const s = GM_getValue(STATE_KEY, null);
      if (!s) return null;
      if (Date.now() - (s.at || 0) > CONFIG.STATE_TTL_MIN * 60000) { GM_deleteValue(STATE_KEY); return null; }
      return s;
    } catch (e) { return null; }
  };
  const setState = (s) => { try { s.at = Date.now(); GM_setValue(STATE_KEY, s); } catch (e) {} };
  const clearState = () => { try { GM_deleteValue(STATE_KEY); } catch (e) {} };

  /* ================= 상태 배지 ================= */
  let badge = null;
  function say(t) {
    if (!badge) {
      badge = document.createElement('div');
      Object.assign(badge.style, {
        position: 'fixed', right: '16px', bottom: '16px', zIndex: 2147483647, background: '#222', color: '#fff',
        padding: '10px 14px', borderRadius: '10px', font: '13px/1.4 sans-serif', whiteSpace: 'pre',
        boxShadow: '0 4px 14px rgba(0,0,0,.35)', cursor: 'pointer',
      });
      badge.title = isListPage() ? '더블클릭: 지금 바로 실행' : '더블클릭: 진행 중단';
      badge.addEventListener('dblclick', () => { if (isListPage()) startRun(true); else { clearState(); say('⏹ 중단했어요'); } });
      document.documentElement.appendChild(badge);
    }
    badge.textContent = t;
  }

  /* ================= 목록 페이지: 이번주 무료 카드 수집 ================= */
  function collectWeekly() {
    const seen = new Set(), items = [];
    document.querySelectorAll('a[href]').forEach((a) => {
      let u; try { u = new URL(a.href, location.href); } catch (e) { return; }
      if (!WEEKLY_RE.test(u.pathname)) return;
      const key = u.origin + u.pathname;
      if (seen.has(key)) return;
      const box = a.closest('div,li,article') || a.parentElement;
      const img = a.querySelector('img') || (box && box.querySelector('img'));
      const title = (a.innerText || (img && img.alt) || '').replace(/\s+/g, ' ').trim();
      if (!title) return;
      seen.add(key);
      items.push({ title, url: a.href, image: img ? (img.currentSrc || img.src || '') : '' });
    });
    return items.slice(0, 8);
  }

  /* ================= 옵시디언 저장 ================= */
  function saveToObsidian(name, content) {
    GM_setClipboard(content, 'text');
    let uri = 'obsidian://new?';
    if (CONFIG.VAULT) uri += `vault=${encodeURIComponent(CONFIG.VAULT)}&`;
    uri += `file=${encodeURIComponent(`${CONFIG.FOLDER}/${name}`)}&clipboard&overwrite=true`;
    location.href = uri;
  }
  const itemMd = (it, h) =>
    `${h} ${it.title}\n\n` + (it.image ? `![${yq(it.title)}](${it.image})\n\n` : '') +
    `- 링크: ${it.url.split('?')[0]}\n- 상태: ${it.status}\n`;
  const frontmatter = (title, extra) =>
    `---\ntitle: "${yq(title)}"\nsource: "https://designbundles.net${CONFIG.LIST_PATH}"\ncreated: ${today()}\ntags:\n  - clippings\n  - designbundles\n${extra || ''}---\n\n`;

  async function saveNotes(done) {
    if (!done.length) return;
    if (CONFIG.SAVE_MODE === 'each') {
      for (const it of done) {
        saveToObsidian(`${today()} - ${safeName(it.title)}`, frontmatter(it.title) + itemMd(it, '#'));
        await sleep(CONFIG.EACH_SAVE_GAP);
      }
    } else {
      // 노트 제목 = 받은 항목 이름들 (카드 제목에서 "- Free Font Of The Week" 같은 꼬리표는 뺌)
      const names = done.map((it) => cleanTitle(it.title));
      const title = names.join(', ');
      saveToObsidian(safeName(`${today()} - ${title}`, 180),
        frontmatter(title, `count: ${done.length}\n`) + done.map((it) => itemMd(it, '##')).join('\n'));
    }
  }

  /* ================= 로그인/가입 팝업 감지 ================= */
  const blockedByModal = () =>
    Array.from(document.querySelectorAll('[role="dialog"],[class*="modal"],[class*="Modal"]')).some((m) => {
      const r = m.getBoundingClientRect();
      return r.width > 100 && r.height > 100 && /sign in|log in|login|create (an )?account/i.test(m.innerText || '');
    });

  // 'Start free trial & download' 같은 유료(Unlimited) 안내 팝업 감지 → 닫기
  function paywallModal() {
    return Array.from(document.querySelectorAll('[role="dialog"],[class*="scrim"]')).find((m) =>
      /start free trial|download this (font|design)? ?free|7-day free trial/i.test(m.innerText || '')) || null;
  }
  function closePaywall(m) {
    const c = m && m.querySelector('button[aria-label="Close"]');
    if (c) c.click();
  }

  /* ================= 상세 페이지: 다운로드 버튼 찾기 ================= */
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const clickedEls = new WeakSet();
  // 1순위: 아이콘 버튼(aria-label "Download ...") / 2순위: 글자만 "Download"인 버튼(팝업·패널 안의 확인 버튼)
  // 본문 아래의 "More ..." / Related 등 추천 목록은 통째로 삭제 (거기 있는 다운로드 버튼이 눌리지 않게)
  const EXTRA_RE = /^(more|related|you may also like|similar|recommended|you might)\b/i;
  function stripMore() {
    Array.from(document.querySelectorAll('h2,h3,h4')).forEach((h) => {
      if (h.closest('header,nav,footer,[role="dialog"],[class*="scrim"]')) return;
      const t = (h.innerText || '').trim();
      if (!t || t.length > 80 || !EXTRA_RE.test(t)) return;
      const sec = h.closest('section');
      if (sec && !sec.querySelector('h1')) sec.remove();
      else { while (h.nextSibling) h.nextSibling.remove(); h.remove(); }
    });
  }
  function findNextBtn() {
    stripMore();
    const all = Array.from(document.querySelectorAll('button,a,[role="button"]'))
      .filter((b) => !clickedEls.has(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && visible(b)
        && !b.closest('header,nav,footer,[role="navigation"],[role="banner"]')   // 메뉴·머리글·바닥글은 제외
        && !/trial|subscribe|unlimited|upgrade/i.test((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')));   // 유료 가입 버튼은 절대 누르지 않음
    const icon = all.find((b) => b.querySelector('svg path[d="' + DL_PATH + '"]') || /^download\b/i.test(b.getAttribute('aria-label') || ''));
    if (icon) return icon;
    return all.find((b) => /^\s*download\s*$/i.test(b.innerText || '')) || null;
  }

  /* ================= 시작 (목록 페이지) ================= */
  async function startRun(force) {
    if (getState()) { const s = getState(); if (s.phase === 'visit') { say('이미 진행 중이에요'); return; } }
    for (let s = 0; s < 20; s++) {
      if (collectWeekly().length) break;
      say(`⏳ 이번주 무료 카드 찾는 중... (${s + 1}/20)`);
      await sleep(1000);
    }
    const all = collectWeekly();
    if (!all.length) { say('⚠ 이번주 무료 카드를 못 찾았어요\n카드 HTML을 Claude에게 보내주세요'); return; }
    const queue = force === true ? all : all.filter((it) => !getDone(it.title));
    if (!queue.length) {
      setLastRun();
      say(`✔ 새 항목 없음 (${all.length}개 모두 받음)\n${CONFIG.REFRESH_DAYS}일 뒤 다시 확인 · 더블클릭: 강제 재실행`);
      return;
    }
    say(`▶ ${queue.length}개 시작`);
    setState({ phase: 'visit', queue, idx: 0, done: [], clicked: false });
    await sleep(800);
    location.href = queue[0].url;
  }

  // 다운로드 준비(zip 생성 등) 중이면 버튼이 aria-busy="true" → 끝날 때까지 대기 (페이지를 떠나면 다운로드가 끊길 수 있음)
  async function waitIdle(label, maxSec) {
    for (let i = 0; i < (maxSec || CONFIG.BUSY_MAX_SEC); i++) {
      if (!document.querySelector('[aria-busy="true"]')) return true;
      say(`⏳ 파일 준비 중... ${i + 1}초\n${label}`);
      await sleep(1000);
    }
    return false;   // 너무 오래 걸림 (렉)
  }

  /* ================= 상세 페이지 처리 ================= */
  async function visitStep(s) {
    const it = s.queue[s.idx];
    const total = s.queue.length;

    // 클릭이 페이지 이동/새로고침을 일으킨 경우 → 이미 처리한 항목, 바로 다음으로
    if (s.clicked) { await sleep(1500); return next(s); }

    // 첫 버튼이 나타날 때까지 대기
    let btn = null;
    for (let i = 0; i < CONFIG.WAIT_BUTTON_SEC; i++) {
      btn = findNextBtn();
      if (btn) break;
      say(`🔎 (${s.idx + 1}/${total}) 다운로드 버튼 찾는 중... ${i + 1}\n${it.title.slice(0, 40)}`);
      await sleep(1000);
    }
    if (!btn && (s.retry || 0) < CONFIG.MAX_RETRY) {            // 렉으로 안 뜬 경우: 새로고침 후 한 번 더
      s.retry = (s.retry || 0) + 1; s.clicked = false; setState(s);
      say(`🔄 버튼이 안 떠서 새로고침 후 재시도\n${it.title.slice(0, 40)}`);
      await sleep(1200);
      location.reload();
      return;
    }
    if (!btn) {
      s.done.push({ ...it, status: '버튼 못 찾음' });
      say(`⚠ 버튼 못 찾음 → 건너뜀\n${it.title.slice(0, 40)}`);
      await sleep(1500);
      return next(s);
    }

    // 클릭 전에 상태 저장 (클릭이 페이지를 이동시켜도 이어갈 수 있게)
    s.clicked = true;
    const rec = { ...it, status: '다운로드 클릭함' };
    s.done.push(rec);
    setState(s);
    markDone(it.title);

    // 버튼을 순서대로 누름 (예: 아이콘 버튼 → 뜬 창의 Download 버튼 / 폰트는 2개). 새로 생긴 버튼이 없으면 종료
    let n = 0;
    while (btn && n < CONFIG.MAX_CLICKS) {
      n++;
      clickedEls.add(btn);
      say(`⬇ (${s.idx + 1}/${total}) ${n}번째 클릭\n${it.title.slice(0, 40)}`);
      btn.scrollIntoView({ block: 'center' });
      const where = `${btn.tagName.toLowerCase()} "${(btn.getAttribute('aria-label') || btn.innerText || '').trim().slice(0, 30)}" 위치:${(btn.closest('aside,main,section,[role="dialog"],form,div') || btn).tagName.toLowerCase()}`;
      console.log('[디자인번들] 클릭 대상', n, where, btn);
      say(`⬇ (${s.idx + 1}/${total}) ${n}번째 클릭\n${where}`);
      const oldOutline = btn.style.outline; btn.style.outline = '3px solid red';   // 눌리는 버튼에 빨간 테두리
      await sleep(700);
      btn.style.outline = oldOutline;
      btn.click();
      await sleep(CONFIG.BETWEEN_CLICK_MS);
      if (!(await waitIdle(it.title.slice(0, 40), CONFIG.STUCK_RELOAD_SEC)) && (s.retry || 0) < CONFIG.MAX_RETRY) {
        s.retry = (s.retry || 0) + 1; s.clicked = false;            // 준비가 멈춘 경우: 이 항목 기록을 되돌리고 새로고침
        s.done = s.done.filter((d) => d !== rec && d.title !== it.title);
        try { GM_deleteValue(keyOf(it.title)); } catch (e) {}
        setState(s);
        say(`🔄 다운로드가 멈춰서 새로고침 후 재시도\n${it.title.slice(0, 40)}`);
        await sleep(1200);
        location.reload();
        return;
      }
      const pw = paywallModal();
      if (pw) {
        closePaywall(pw);
        rec.status = '유료 안내 팝업(무료 아님) → 건너뜀';
        try { GM_deleteValue(keyOf(it.title)); } catch (e) {}
        say(`⚠ 유료 안내 팝업 → 닫고 건너뜀\n${it.title.slice(0, 40)}`);
        setState(s);
        await sleep(1200);
        return next(s);
      }
      if (blockedByModal()) {
        rec.status = '로그인 필요(중단)';
        try { GM_deleteValue(keyOf(it.title)); } catch (e) {}
        say('⚠ 로그인/가입 창이 떠서 중단했어요\n로그인 후 목록에서 더블클릭');
        s.phase = 'save'; s.clicked = false; setState(s);
        await sleep(2000);
        location.href = `https://designbundles.net${CONFIG.LIST_PATH}`;
        return;
      }
      btn = findNextBtn();
    }
    rec.status = `다운로드 클릭 ${n}회`;
    setState(s);
    await waitIdle(it.title.slice(0, 40));
    say(`✔ 다운로드 요청 완료, 잠시 대기\n${it.title.slice(0, 40)}`);
    await sleep(CONFIG.AFTER_CLICK_MS);
    return next(s);
  }

  async function next(s) {
    s.idx += 1; s.clicked = false; s.retry = 0;
    if (s.idx < s.queue.length) {
      setState(s);
      say(`➡ 다음 항목으로 (${s.idx + 1}/${s.queue.length})`);
      await sleep(800);
      location.href = s.queue[s.idx].url;
    } else {
      s.phase = 'save'; setState(s);
      say('↩ 목록으로 돌아가는 중...');
      await sleep(800);
      location.href = `https://designbundles.net${CONFIG.LIST_PATH}`;
    }
  }

  /* ================= 마무리 (목록 페이지로 돌아온 뒤) ================= */
  async function finish(s) {
    say(`✅ ${s.done.length}개 처리 → 옵시디언 저장 중`);
    clearState();
    setLastRun();
    await saveNotes(s.done);
    say(`✅ ${s.done.length}개 다운로드 + 옵시디언 저장 완료\n${CONFIG.REFRESH_DAYS}일 뒤 자동 새로고침`);
  }

  /* ================= 5일 주기 새로고침 (목록 페이지에서만) ================= */
  function scheduleReload() {
    const last = getLastRun();
    const due = last ? last + CONFIG.REFRESH_DAYS * DAY : 0;
    const wait = Math.max(due - Date.now(), 60 * 1000);
    setTimeout(() => { if (!getState()) location.reload(); }, Math.min(wait, 2 ** 31 - 1));
  }

  /* ================= 메뉴 ================= */
  try {
    GM_registerMenuCommand('지금 바로 실행 (새 항목만)', () => { if (isListPage()) startRun(false); else alert('목록 페이지(designbundles.net/free-design-resources)에서 실행하세요.'); });
    GM_registerMenuCommand('받은 기록 보기', () => {
      const k = doneKeys();
      alert(k.length ? `받은 항목 ${k.length}개\n\n` + k.map((x) => x.slice(DL_PREFIX.length)).join('\n') : '기록이 없어요.');
    });
    GM_registerMenuCommand('받은 기록 전체 삭제', () => {
      const k = doneKeys();
      if (confirm(`받은 기록 ${k.length}개를 삭제할까요? (다음 실행 때 다시 받아요)`)) { k.forEach((x) => GM_deleteValue(x)); GM_deleteValue(LAST_RUN_KEY); clearState(); alert('삭제했어요.'); }
    });
    GM_registerMenuCommand('진행 상태 초기화 (멈췄을 때)', () => { clearState(); alert('초기화했어요.'); });
  } catch (e) {}


  /* ================= 대시보드로 전송 (목록 페이지에 들어올 때마다) ================= */
  async function pushFromListPage() {
    for (let i = 0; i < 20; i++) {
      const all = collectWeekly();
      if (all.length) {
        pushToHub('디자인번들', all.map((it) => ({
          title: cleanTitle(it.title),
          url: it.url.split('?')[0],
          image: (it.image || '').startsWith('data:') ? '' : it.image,
          category: 'design',
          tags: ['이번 주 무료'],
          badge: '이번 주',
        })), { ttl: CONFIG.REFRESH_DAYS * 2 });
        return;
      }
      await sleep(1000);
    }
  }

  /* ================= 시작점 ================= */
  (async function boot() {
    const s = getState();
    if (s && s.phase === 'visit') {
      if (isListPage()) return;                 // 방문 중 목록으로 튕겨온 경우: 건드리지 않음
      return visitStep(s);
    }
    if (!isListPage()) return;                  // 그 외 페이지는 아무것도 안 함
    pushFromListPage();                         // 이번 주 무료 항목을 대시보드로 전송
    scheduleReload();
    if (s && s.phase === 'save') return finish(s);
    const last = getLastRun();
    const due = !last || Date.now() - last >= CONFIG.REFRESH_DAYS * DAY;
    if (!due) {
      const left = Math.ceil((last + CONFIG.REFRESH_DAYS * DAY - Date.now()) / DAY);
      say(`⏱ 다음 자동 실행까지 약 ${left}일\n더블클릭: 지금 실행`);
      return;
    }
    for (let i = CONFIG.START_DELAY; i > 0; i--) { say(`⏳ ${i}초 뒤 자동 시작 (더블클릭: 즉시)`); await sleep(1000); }
    startRun(false);
  })();
})();