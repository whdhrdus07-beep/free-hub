#!/usr/bin/env python3
"""무료정보 허브 크롤러.

여러 출처를 모아 data/items.json 으로 저장하고,
마감이 임박했거나 새로 올라온 항목은 구글 메일 웹훅(Apps Script)으로 알립니다.
"""
import hashlib
import html as htmllib
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "items.json"
CONF = Path(__file__).with_name("sources.json")
KST = timezone(timedelta(hours=9))
UA = "Mozilla/5.0 (compatible; FreeInfoHub/1.0; personal use)"
S = requests.Session()
S.headers["User-Agent"] = UA


def now():
    return datetime.now(KST)


def clean(s):
    """HTML 태그 제거 + 공백 정리"""
    return " ".join(htmllib.unescape(re.sub(r"<[^>]+>", " ", s or "")).split())


def make_item(cat, title, url, source, deadline=None, summary="", image="", tags=None):
    return {
        "id": hashlib.sha1(url.encode()).hexdigest()[:12],
        "category": cat,  # game | design | photo | gov | trial
        "title": clean(title),
        "url": url,
        "source": source,
        "deadline": deadline.astimezone(KST).isoformat() if deadline else None,
        "summary": clean(summary)[:200],
        "image": image or "",
        "tags": [t for t in (tags or []) if t],
    }


def parse_deadline(text):
    """텍스트 안의 날짜 중 마지막 것을 마감일로 봅니다. ('9.1 ~ 9.30' → 9/30). 못 찾으면 None."""
    dates = [
        (int(m[1]), int(m[2]), int(m[3]))
        for m in re.finditer(r"(20\d{2})[.\-/년 ]+(\d{1,2})[.\-/월 ]+(\d{1,2})", text)
    ]
    if not dates:
        n = now()
        for m in re.finditer(r"(?<![\d.])(\d{1,2})[./월 ]\s?(\d{1,2})\s?일?(?![\dA-Za-z])", text):
            mo, d = int(m[1]), int(m[2])
            if 1 <= mo <= 12 and 1 <= d <= 31:
                y = n.year
                try:
                    if datetime(y, mo, d, tzinfo=KST) < n - timedelta(days=200):
                        y += 1  # 연말에 '1월 5일'이 나오면 내년으로
                except ValueError:
                    continue
                dates.append((y, mo, d))
    if not dates:
        return None
    y, mo, d = dates[-1]
    try:
        return datetime(y, mo, d, 23, 59, tzinfo=KST)
    except ValueError:
        return None


def match(text, src):
    t = text.lower()
    inc, exc = src.get("include") or [], src.get("exclude") or []
    return (not inc or any(k.lower() in t for k in inc)) and not any(k.lower() in t for k in exc)


# ───────── 내장 출처 ─────────
def epic():
    """Epic Games 지금 무료인 게임 (공개 엔드포인트)"""
    r = S.get(
        "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions",
        params={"locale": "ko", "country": "KR", "allowCountries": "KR"},
        timeout=20,
    )
    r.raise_for_status()
    out = []
    for g in r.json()["data"]["Catalog"]["searchStore"]["elements"]:
        offers = (g.get("promotions") or {}).get("promotionalOffers") or []
        if not offers or not offers[0].get("promotionalOffers"):
            continue  # 예고(upcoming)는 제외, 지금 무료인 것만
        if ((g.get("price") or {}).get("totalPrice") or {}).get("discountPrice", 1) != 0:
            continue
        end = offers[0]["promotionalOffers"][0]["endDate"]
        slug = (
            g.get("productSlug")
            or (g.get("offerMappings") or [{}])[0].get("pageSlug")
            or g.get("urlSlug")
        )
        url = f"https://store.epicgames.com/ko/p/{slug}" if slug else "https://store.epicgames.com/ko/free-games"
        img = next(
            (k["url"] for k in g.get("keyImages", []) if k.get("type") in ("Thumbnail", "OfferImageWide")), ""
        )
        out.append(
            make_item(
                "game", g["title"], url, "Epic Games",
                datetime.fromisoformat(end.replace("Z", "+00:00")),
                g.get("description", ""), img, ["Epic", "지금 무료"],
            )
        )
    return out


def gamerpower():
    """GamePower 무료 배포 게임 (Steam, GOG, Ubisoft 등)"""
    r = S.get("https://www.gamerpower.com/api/giveaways", params={"type": "game"}, timeout=20)
    r.raise_for_status()
    out = []
    for g in r.json():
        if g.get("status") != "Active":
            continue
        end = g.get("end_date")
        dl = None
        if end and end != "N/A":
            dl = datetime.strptime(end, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        worth = g.get("worth")
        tags = [p.strip() for p in (g.get("platforms") or "").split(",")][:2]
        if worth and worth != "N/A":
            tags.append(f"정가 {worth}")
        out.append(
            make_item("game", g["title"], g["open_giveaway_url"], "GamePower", dl,
                      g.get("description", ""), g.get("thumbnail", ""), tags)
        )
    return out


def gov24():
    """보조금24(공공서비스 혜택) — 공공데이터포털 API 키 필요 (환경변수 DATA_GO_KR_KEY)"""
    key = os.environ.get("DATA_GO_KR_KEY")
    if not key:
        print("  (DATA_GO_KR_KEY 없음 → 건너뜀)")
        return []
    r = S.get(
        "https://api.odcloud.kr/api/gov24/v3/serviceList",
        params={"page": 1, "perPage": 100, "serviceKey": key},
        timeout=30,
    )
    r.raise_for_status()
    out = []
    for d in r.json().get("data", []):
        title = d.get("서비스명")
        sid = d.get("서비스ID")
        if not title or not sid:
            continue
        url = d.get("상세조회URL") or f"https://www.gov.kr/portal/rcvfvrSvc/dtlEx/{sid}"
        out.append(
            make_item(
                "gov", title, url, d.get("소관기관명") or "보조금24",
                parse_deadline(d.get("신청기한") or ""),
                d.get("서비스목적요약") or d.get("지원내용") or "",
                "", [d.get("지원유형"), d.get("신청기한") if not parse_deadline(d.get("신청기한") or "") else None],
            )
        )
    return out


# ───────── 직접 추가하는 출처 (sources.json 의 custom) ─────────
def crawl_rss(src):
    import feedparser

    feed = feedparser.parse(src["url"], agent=UA)
    out = []
    for e in feed.entries[: src.get("limit", 30)]:
        text = f'{e.get("title", "")} {clean(e.get("summary", ""))}'
        if not match(text, src):
            continue
        out.append(
            make_item(src["category"], e.get("title", ""), e.get("link", ""), src["name"],
                      parse_deadline(text), e.get("summary", ""))
        )
    return [i for i in out if i["url"]]


def crawl_html(src):
    from bs4 import BeautifulSoup

    r = S.get(src["url"], timeout=20)
    r.raise_for_status()
    r.encoding = r.apparent_encoding  # 구청 사이트 등 euc-kr 대비
    soup = BeautifulSoup(r.text, "html.parser")
    out = []
    for row in soup.select(src["item"])[: src.get("limit", 30)]:
        a = row.select_one(src.get("link", "a"))
        if not a or not a.get("href"):
            continue
        t_el = row.select_one(src["title"]) if src.get("title") else a
        title = (t_el or a).get_text(" ", strip=True)
        text = row.get_text(" ", strip=True)
        if not title or not match(text, src):
            continue
        out.append(
            make_item(src["category"], title, urljoin(src["url"], a["href"]), src["name"],
                      parse_deadline(text), text)
        )
    return out


def creativefabrica_daily():
    """Creative Fabrica 데일리 기프트(폰트/그래픽/크래프트 3개).

    페이지는 Next.js로 서버에서 미리 렌더링돼서 requests만으로도 상품명이 담긴
    JSON 조각(productName)을 그대로 읽을 수 있어요(화니의 '영어 제목 유지' 스크립트와 같은 원리).
    다만 상품 URL/이미지 키 이름은 직접 열어 확인하지 못해 추정으로 짰어요 —
    실행해서 0건이 나오면 daily-gifts 페이지의 <script id="__NEXT_DATA__"> 안쪽을
    Claude에게 보내주면 선택자를 정확히 맞출 수 있어요.
    """
    r = S.get("https://www.creativefabrica.com/daily-gifts", timeout=20)
    r.raise_for_status()
    html = r.text
    names = [m.replace('\\"', '"') for m in re.findall(r'productName\\?":\\?"(.*?)\\?"', html)]
    slugs = re.findall(r'"slug\\?":\\?"(.*?)\\?"', html)
    imgs = re.findall(r'"(?:thumbnail|image|imageUrl)\\?":\\?"(https:[^"\\]+)', html)
    # 3그룹(폰트/그래픽/크래프트) x [받을 선물, 추천1, 추천2] 순서라 0,3,6번째가 실제 선물
    out = []
    for i in (0, 3, 6):
        if i >= len(names) or not names[i]:
            continue
        url = f"https://www.creativefabrica.com/product/{slugs[i]}/" if i < len(slugs) else "https://www.creativefabrica.com/daily-gifts"
        img = imgs[i] if i < len(imgs) else ""
        out.append(make_item("design", names[i], url, "Creative Fabrica", None, "", img, ["데일리 기프트"]))
    return out


def designbundles_weekly():
    """디자인번들 '이번 주 무료' 4개 (화니의 자동다운로드 스크립트와 같은 목록 페이지)."""
    from bs4 import BeautifulSoup

    weekly_re = re.compile(r"(free-font-of-the-week|free-design-of-the-week)")
    r = S.get("https://designbundles.net/free-design-resources", timeout=20)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    seen, out = set(), []
    for a in soup.select("a[href]"):
        href = urljoin(r.url, a["href"])
        if not weekly_re.search(href) or href in seen:
            continue
        seen.add(href)
        box = a.find_parent(["div", "li", "article"]) or a.parent
        img = a.find("img") or (box.find("img") if box else None)
        title = clean(a.get_text(" ")) or (img.get("alt") if img else "") or ""
        title = re.sub(r"\s*[-–|]\s*free (font|design)s? of (the )?week\s*$", "", title, flags=re.I).strip()
        if not title:
            continue
        out.append(make_item("design", title, href, "디자인번들", None, "",
                             img.get("src") or img.get("data-src") or "" if img else "", ["이번 주 무료"]))
        if len(out) >= 4:
            break
    return out


BUILTIN = {"epic": epic, "gamerpower": gamerpower, "gov24": gov24,
           "creativefabrica": creativefabrica_daily, "designbundles": designbundles_weekly}
CUSTOM = {"rss": crawl_rss, "html": crawl_html}


# ───────── 병합 · 알림 ─────────
def load_old():
    if OUT.exists():
        try:
            return {i["id"]: i for i in json.loads(OUT.read_text("utf-8"))["items"]}
        except Exception:
            pass
    return {}


def merge(old, fresh, t):
    for id_, it in fresh.items():
        prev = old.get(id_, {})
        it["first_seen"] = prev.get("first_seen", t)
        it["last_seen"] = t
        it["notified"] = prev.get("notified", False)
        old[id_] = {**prev, **it}
    keep = []
    for it in old.values():
        dl = datetime.fromisoformat(it["deadline"]) if it.get("deadline") else None
        if dl and dl < now() - timedelta(days=1):
            continue  # 마감 지난 항목 정리
        if not dl and datetime.fromisoformat(it["last_seen"]) < now() - timedelta(days=14):
            continue  # 2주간 안 보인 상시 항목 정리
        keep.append(it)
    far = datetime.max.replace(tzinfo=KST)
    keep.sort(key=lambda i: datetime.fromisoformat(i["deadline"]) if i.get("deadline") else far)
    return keep


def pick_notify(items, conf, t, allow_new=True):
    n = conf.get("notify", {})
    soon = now() + timedelta(days=n.get("within_days", 3))
    out = []
    for it in items:
        if it.get("notified"):
            continue
        dl = datetime.fromisoformat(it["deadline"]) if it.get("deadline") else None
        is_new = allow_new and it["first_seen"] == t and it["category"] in n.get("new_categories", [])
        if (dl and dl <= soon) or is_new:
            out.append(it)
    return out[: n.get("max_items", 30)]


def send_webhook(items):
    url, secret = os.environ.get("WEBHOOK_URL"), os.environ.get("WEBHOOK_SECRET")
    if not (url and secret and items):
        return False
    r = S.post(url, json={"secret": secret, "items": items}, timeout=30)
    return r.ok and r.text.strip() == "ok"


def main():
    conf = json.loads(CONF.read_text("utf-8"))
    tasks = [(n, BUILTIN[n]) for n in conf.get("builtin", [])]
    for s in conf.get("custom", []):
        if s.get("enabled") and s.get("url"):
            tasks.append((s["name"], lambda s=s: CUSTOM[s["type"]](s)))

    fresh = {}
    for name, fn in tasks:
        try:
            items = fn()
            print(f"✓ {name}: {len(items)}건")
        except Exception as e:  # 한 출처가 죽어도 나머지는 계속
            print(f"✗ {name}: {e}", file=sys.stderr)
            continue
        for it in items:
            fresh[it["id"]] = it

    t = now().isoformat()
    old = load_old()
    first_run = not old  # 첫 실행에서 수십 건이 한꺼번에 메일로 가지 않게
    keep = merge(old, fresh, t)

    targets = pick_notify(keep, conf, t, allow_new=not first_run)
    if send_webhook(targets):
        ids = {i["id"] for i in targets}
        for it in keep:
            if it["id"] in ids:
                it["notified"] = True
        print(f"✉ 알림 {len(targets)}건 전송")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"updated": t, "items": keep}, ensure_ascii=False, indent=1), "utf-8")
    print(f"저장: {len(keep)}건 → {OUT}")


if __name__ == "__main__":
    main()
