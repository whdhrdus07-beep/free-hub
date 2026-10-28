// ==UserScript==
// @name         Creative Fabrica - 데일리 기프트 자동 다운로드 + 옵시디언 저장
// @namespace    hwani-tampermonkey
// @version      0.5
// @description  [v0.5 대시보드 전송 추가] daily-gifts 페이지 FREE 항목(최대 3개) 자동 다운로드 + 하루 2번 자동 새로고침 + 웹클리퍼 없이 옵시디언에 당일 스냅샷 자동 저장(하루 1회, 중복 방지)
// @author       화니
// @match        https://www.creativefabrica.com/daily-gifts*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// ==/UserScript==

(function () {
  'use strict';

  const MAX_FREE_ITEMS = 3;
  const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12시간 = 하루 2번
  const VAULT = ''; // 특정 볼트를 지정하려면 '볼트이름' 입력, 비우면 마지막으로 연 볼트 사용
  const OBSIDIAN_FOLDER = '05_자료/링크 아카이브/mhtml/creativefabrica';


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

  let alreadyRan = false;

  // ---------- 공통: FREE 카드 찾기 ----------
  function isBadgeText(t) {
    t = (t || '').trim().toUpperCase();
    if (!t || t.length > 20) return false;
    return t === 'FREE' || t.startsWith('FREE ');
  }

  function findFreeCards(limit) {
    const cards = [];
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();

    while (node && cards.length < limit) {
      if (node.children.length === 0 && isBadgeText(node.textContent)) {
        let ancestor = node.parentElement;
        let depth = 0;
        while (ancestor && depth < 10) {
          if (ancestor.querySelector('button')) {
            if (!seen.has(ancestor)) {
              seen.add(ancestor);
              cards.push(ancestor);
            }
            break;
          }
          ancestor = ancestor.parentElement;
          depth++;
        }
      }
      node = walker.nextNode();
    }
    return cards;
  }

  function isAlreadyDownloaded(card) {
    return (card.textContent || '').toUpperCase().includes('DOWNLOADED');
  }

  function findDownloadButton(card) {
    const buttons = Array.from(card.querySelectorAll('button'));
    return (
      buttons.find((b) => !(b.textContent || '').toUpperCase().includes('SAVE TO MY DOWNLOADS')) ||
      buttons[0]
    );
  }

  function extractCardInfo(card) {
    const h2 = card.querySelector('h2');
    const title = h2 ? h2.textContent.trim() : '(제목 없음)';
    const links = Array.from(card.querySelectorAll('a[href]'));
    const productLink = links.find((a) => !a.href.includes('/designer/'));
    const designerLink = links.find((a) => a.href.includes('/designer/'));
    const img = card.querySelector('img');
    return {
      title,
      url: productLink ? productLink.href : '',
      designer: designerLink ? designerLink.textContent.trim() : '',
      designerUrl: designerLink ? designerLink.href : '',
      thumbnail: img ? img.src : '',
      downloaded: isAlreadyDownloaded(card),
    };
  }

  // ---------- 1) 자동 다운로드 ----------
  function autoSaveFreeItems() {
    if (alreadyRan) return [];

    const cards = findFreeCards(MAX_FREE_ITEMS);
    if (cards.length === 0) return [];

    const infos = [];
    cards.forEach((card, idx) => {
      const info = extractCardInfo(card);
      if (!info.downloaded) {
        const btn = findDownloadButton(card);
        if (btn && !btn.disabled) {
          console.log(`[CF 데일리기프트] ${idx + 1}번째 프리 항목 다운로드 클릭: ${info.title}`);
          btn.click();
          info.downloaded = true; // 클릭 완료로 표시
        }
      } else {
        console.log(`[CF 데일리기프트] ${idx + 1}번째 항목 이미 다운로드됨: ${info.title}`);
      }
      infos.push(info);
    });

    alreadyRan = true;
    return infos;
  }

  // ---------- 2) 옵시디언 저장 ----------
  function safeName(s) {
    return (s || '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function todayStr() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function saveToObsidian(folder, name, content) {
    GM_setClipboard(content, 'text');
    const file = `${folder}/${safeName(name)}`;
    let uri = 'obsidian://new?';
    if (VAULT) uri += `vault=${encodeURIComponent(VAULT)}&`;
    uri += `file=${encodeURIComponent(file)}&clipboard&overwrite=true`;
    location.href = uri;
  }

  function buildNote(items) {
    const date = todayStr();
    const titles = items.map((i) => i.title).join(' - ');
    const noteName = `${date} - ${titles || '데일리기프트'}`;

    const frontmatter = [
      '---',
      `title: "크리에이티브 파브리카 데일리 기프트 (${date})"`,
      `source: "${location.href}"`,
      `published: ${date}`,
      `created: ${date}`,
      `description: "${safeName(titles)} 외 ${items.length}개 프리 항목"`,
      'tags:',
      '  - clippings',
      '  - creativefabrica',
      '---',
      '',
    ].join('\n');

    const body = items
      .map((i, idx) => {
        return [
          `## ${idx + 1}. ${i.title}`,
          i.designer ? `- 디자이너: [${i.designer}](${i.designerUrl})` : '',
          i.url ? `- 링크: ${i.url}` : '',
          i.thumbnail ? `- 썸네일: ${i.thumbnail}` : '',
          `- 다운로드 상태: ${i.downloaded ? '✅ 완료' : '❌ 실패/미확인'}`,
          '',
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n');

    return { noteName, content: frontmatter + body };
  }

  function maybeSaveSnapshot(items) {
    if (!items || items.length === 0) return;

    const archiveKey = 'cf_daily_gifts_archive';
    const archive = (() => {
      try {
        return GM_getValue(archiveKey, {}) || {};
      } catch (e) {
        return {};
      }
    })();

    const today = todayStr();
    if (archive[today]) {
      console.log('[CF 데일리기프트] 오늘자 스냅샷은 이미 옵시디언에 저장됨 — 건너뜀');
      return;
    }

    const { noteName, content } = buildNote(items);
    console.log('[CF 데일리기프트] 옵시디언에 저장:', noteName);
    saveToObsidian(OBSIDIAN_FOLDER, noteName, content);

    archive[today] = Date.now();
    GM_setValue(archiveKey, archive);
  }


  // ---------- 3) 대시보드로 전송 ----------
  let pushScheduled = false;
  function schedulePush(items) {
    if (pushScheduled || !items || !items.length) return;
    pushScheduled = true;
    // '영어 제목 유지' 스크립트가 제목을 되돌릴 시간을 준 뒤, 카드를 다시 읽어서 전송
    setTimeout(() => {
      let fresh = [];
      try { fresh = findFreeCards(MAX_FREE_ITEMS).map(extractCardInfo); } catch (e) {}
      const list = fresh.length ? fresh : items;
      pushToHub('Creative Fabrica', list.map((i) => ({
        title: i.title,
        url: i.url || location.href,
        image: (i.thumbnail || '').startsWith('data:') ? '' : i.thumbnail,
        category: 'design',
        tags: ['데일리 기프트'].concat(i.designer ? [i.designer] : []),
        badge: '오늘',
      })), { ttl: 2 });
    }, 8000);
  }

  // ---------- 실행 ----------
  let tries = 0;
  const tryTimer = setInterval(() => {
    tries++;
    const items = autoSaveFreeItems();
    if (items.length > 0) {
      maybeSaveSnapshot(items);
      schedulePush(items);
    }
    if (alreadyRan || tries >= 3) clearInterval(tryTimer);
  }, 1500);

  // ---------- 하루 약 2번(12시간 간격) 자동 새로고침 ----------
  const REFRESH_KEY = 'cf_daily_gifts_last_refresh';

  function scheduleNextRefresh() {
    const last = Number(localStorage.getItem(REFRESH_KEY) || 0);
    const now = Date.now();
    const remaining = Math.max(REFRESH_INTERVAL_MS - (now - last), 5000);

    setTimeout(() => {
      localStorage.setItem(REFRESH_KEY, String(Date.now()));
      location.reload();
    }, remaining);
  }

  if (!localStorage.getItem(REFRESH_KEY)) {
    localStorage.setItem(REFRESH_KEY, String(Date.now()));
  }
  scheduleNextRefresh();
})();
