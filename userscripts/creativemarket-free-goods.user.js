// ==UserScript==
// @name         Creative Market 무료 상품 → 무료 정보 허브로 전송
// @namespace    whdhrdus07
// @version      1.0
// @description  creativemarket.com/free-goods 의 이번 주 무료 상품 4개를 대시보드(Apps Script)로 보냅니다. 보내기만 하고 다운로드는 하지 않아요.
// @match        https://creativemarket.com/free-goods*
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------- 설정 ----------
  const HUB_URL = '';     // Apps Script 웹 앱 URL (…/exec 로 끝나는 주소)
  const HUB_SECRET = '';  // Apps Script 스크립트 속성 SECRET 과 같은 값
  const MAX_ITEMS = 4;    // 매주 무료는 4개

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // ---------- 무료 상품 읽기 ----------
  // 주소 모양: /숍이름/숫자-상품-이름  (번역 확장 때문에 화면 글자는 한국어로 바뀔 수 있어서, 영어 제목은 주소에서 뽑아요)
  const PRODUCT_RX = /^\/[^/]+\/\d+-(.+)$/;

  function titleFromHref(href) {
    try {
      const m = new URL(href, location.href).pathname.match(PRODUCT_RX);
      return m ? decodeURIComponent(m[1]).replace(/-+/g, ' ').replace(/\s+/g, ' ').trim() : '';
    } catch (e) { return ''; }
  }

  // 숍 프로필 사진(images/users/…, avatar)은 빼고, 화면에서 가장 크게 그려진 이미지를 상품 이미지로 봄
  function bestImage(box) {
    let best = null, bestArea = 0;
    box.querySelectorAll('img').forEach((im) => {
      const src = im.currentSrc || im.src || '';
      if (!/^https?:/i.test(src)) return;
      if (/\/images\/users\//i.test(src) || /avatar/i.test(src + ' ' + im.className)) return;
      const r = im.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { best = src; bestArea = area; }
    });
    return best || '';
  }

  function readFree() {
    const out = [];
    const seen = new Set();
    // .featured-asset = 대표 1개, .free-asset-card = 나머지 3개. (아래의 '월간 드롭' 유료 상품은 다른 클래스라 안 걸려요)
    document.querySelectorAll('.featured-asset, .free-asset-card').forEach((box) => {
      const a = Array.from(box.querySelectorAll('a[href]')).find((x) => PRODUCT_RX.test(new URL(x.href, location.href).pathname));
      if (!a) return;
      const url = new URL(a.href, location.href);
      url.search = '';
      const href = url.toString();
      if (seen.has(href)) return;
      seen.add(href);
      const title = titleFromHref(href) || (a.textContent || '').replace(/\s+/g, ' ').trim();
      const shop = url.pathname.split('/')[1] || '';
      if (!title) return;
      out.push({
        title,
        url: href,
        image: bestImage(box),
        category: 'design',
        tags: ['이번 주 무료'].concat(shop ? [shop] : []),
        badge: '이번 주',
      });
    });
    return out.slice(0, MAX_ITEMS);
  }

  (async function main() {
    let items = [];
    // 화면이 다 그려질 때까지 최대 ~20초 기다림 (이미지는 늦게 뜨는 경우가 있어서 조금 더 기다림)
    for (let i = 0; i < 20; i++) {
      items = readFree();
      if (items.length >= MAX_ITEMS && items.every((x) => x.image)) break;
      await sleep(1000);
    }
    if (!items.length) {
      console.warn('[허브] 무료 상품 영역(.featured-asset / .free-asset-card)을 못 찾았어요');
      hubToast('⚠ Creative Market 무료 상품을 못 찾았어요');
      return;
    }
    console.log('[허브] Creative Market 무료 상품', items);
    pushToHub('Creative Market', items, { ttl: 10 });
  })();
})();
