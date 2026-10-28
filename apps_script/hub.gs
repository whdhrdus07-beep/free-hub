/**
 * 무료정보 허브 — Apps Script (웹 앱 하나로 두 가지 일을 해요)
 *
 *  1) 받기(POST, action="push"): 탬퍼몽키 스크립트가 보낸 항목을 저장
 *     (Creative Fabrica / 디자인번들 / Creative Market 처럼 GitHub 서버에서는 막히는 곳)
 *  2) 내보내기(GET): 저장된 항목을 JSON 으로 돌려줌 → 대시보드(index.html)가 읽어감
 *  3) 메일(POST, action 없음): 크롤러가 보낸 임박·신규 항목을 내 Gmail 로 발송
 *
 * 설정
 *  1) script.google.com 에서 프로젝트를 열고 이 코드로 통째로 바꿔 붙여넣기
 *  2) 프로젝트 설정 → 스크립트 속성 → SECRET = 아무 긴 문자열 (탬퍼몽키 스크립트의 HUB_SECRET, GitHub 의 WEBHOOK_SECRET 과 같은 값)
 *  3) test() 를 한 번 실행해서 메일 발송 권한 허용
 *  4) 배포 → 새 배포 → 웹 앱 / 실행 사용자: 나 / 액세스: 모든 사용자   (이미 배포했다면: 배포 관리 → 연필 아이콘 → 버전: 새 버전 → 배포)
 *  5) 나온 웹 앱 URL(…/exec)을 탬퍼몽키 스크립트 3개의 HUB_URL, index.html 의 HUB_URL, GitHub 시크릿 WEBHOOK_URL 에 넣기
 */

const CAT = { game: "게임", design: "디자인 소스", photo: "사진", gov: "지원금·공지", trial: "체험단" };
const KEEP_DAYS_DEFAULT = 14;   // 보낸 지 이만큼 지나면 대시보드에서 자동으로 사라짐 (스크립트가 ttl_days 로 바꿀 수 있어요)
const MAX_ITEMS_PER_SOURCE = 8;
const MAX_PROP_BYTES = 8500;    // 스크립트 속성 한 칸은 9KB 까지라서 여유를 둠

function props_() { return PropertiesService.getScriptProperties(); }
function text_(s) { return ContentService.createTextOutput(s); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ───────── 대시보드가 읽어가는 쪽 ───────── */
function doGet() {
  const now = Date.now();
  const all = props_().getProperties();
  const items = [];
  let updated = 0;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf("src::") !== 0) return;
    let rec;
    try { rec = JSON.parse(all[k]); } catch (err) { return; }
    const ttl = (Number(rec.ttl_days) || KEEP_DAYS_DEFAULT) * 86400000;
    if (now - rec.pushed_at > ttl) return;
    updated = Math.max(updated, rec.pushed_at);
    (rec.items || []).forEach(function (it) { items.push(it); });
  });
  return json_({ updated: updated ? new Date(updated).toISOString() : null, items: items });
}

/* ───────── 받는 쪽 ───────── */
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return text_("bad request"); }
  const secret = props_().getProperty("SECRET");
  if (!secret || body.secret !== secret) return text_("denied");

  if (body.action === "push") {
    try { return json_(push_(body)); }
    catch (err) { return json_({ ok: false, error: String(err).slice(0, 100) }); }
  }

  // 기존 기능: 크롤러가 보낸 항목을 메일로
  const items = body.items || [];
  if (items.length) {
    MailApp.sendEmail({
      to: Session.getEffectiveUser().getEmail(),
      subject: "[무료정보] 확인할 항목 " + items.length + "건",
      htmlBody: render_(items),
    });
  }
  return text_("ok");
}

function push_(body) {
  const source = String(body.source || "").trim().slice(0, 40);
  if (!source) return { ok: false, error: "no source" };
  const key = "src::" + source;

  // 같은 출처를 다시 보내면 통째로 교체. 이전에 본 항목은 first_seen(처음 본 시각)을 이어받음
  const prev = readRec_(key);
  const prevById = {};
  (prev.items || []).forEach(function (it) { prevById[it.id] = it; });

  const nowIso = new Date().toISOString();
  const seen = {};
  let items = [];
  (body.items || []).forEach(function (raw) {
    const url = safeUrl_(raw.url);
    if (!url) return;
    const id = sha_(url);
    if (seen[id]) return;
    seen[id] = true;
    const title = String(raw.title || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!title) return;
    items.push({
      id: id,
      category: CAT[raw.category] ? raw.category : "design",
      title: title,
      url: url,
      source: source,
      deadline: parseDate_(raw.deadline),
      image: safeUrl_(raw.image) || "",
      tags: (raw.tags || []).slice(0, 4).map(function (t) { return String(t).slice(0, 30); }),
      badge: raw.badge ? String(raw.badge).slice(0, 8) : "",
      first_seen: (prevById[id] && prevById[id].first_seen) || nowIso,
    });
  });
  items = items.slice(0, MAX_ITEMS_PER_SOURCE);

  const rec = { pushed_at: Date.now(), ttl_days: Number(body.ttl_days) || KEEP_DAYS_DEFAULT, items: items };
  while (items.length && JSON.stringify(rec).length > MAX_PROP_BYTES) items.pop();   // 한 칸 용량을 넘으면 뒤에서부터 덜어냄
  props_().setProperty(key, JSON.stringify(rec));
  return { ok: true, saved: items.length };
}

function readRec_(key) {
  try { return JSON.parse(props_().getProperty(key)) || {}; } catch (err) { return {}; }
}

function safeUrl_(u) {
  u = String(u || "").trim();
  return /^https?:\/\//i.test(u) && u.length <= 400 ? u : "";
}

function parseDate_(d) {
  if (!d) return null;
  const t = new Date(d);
  return isNaN(t.getTime()) ? null : t.toISOString();
}

function sha_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ("0" + ((b < 0 ? b + 256 : b)).toString(16)).slice(-2); }).join("").slice(0, 12);
}

/* ───────── 메일 ───────── */
function render_(items) {
  const today = new Date();
  const rows = items
    .map(function (it) {
      let d = "상시";
      if (it.deadline) {
        const n = Math.ceil((new Date(it.deadline) - today) / 86400000);
        d = n <= 0 ? "오늘 마감" : "D-" + n;
      }
      const url = /^https?:\/\//.test(it.url) ? it.url : "#";
      return (
        "<tr>" +
        '<td style="padding:8px 12px;font-weight:bold;white-space:nowrap">' + esc_(d) + "</td>" +
        '<td style="padding:8px 12px"><a href="' + esc_(url) + '">' + esc_(it.title) + "</a><br>" +
        '<span style="color:#666;font-size:12px">' + esc_(CAT[it.category] || "기타") + " / " + esc_(it.source) + "</span></td>" +
        "</tr>"
      );
    })
    .join("");
  return '<table style="border-collapse:collapse;font-family:sans-serif">' + rows + "</table>";
}

function esc_(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/** 권한 허용 + 메일 모양 확인용 (에디터에서 한 번 실행) */
function test() {
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: "[무료정보] 테스트",
    htmlBody: render_([
      { title: "샘플 항목", url: "https://example.com", source: "테스트", category: "game", deadline: new Date(Date.now() + 86400000).toISOString() },
    ]),
  });
}
