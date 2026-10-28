# 무료 정보 허브

무료 정보를 한 페이지에 모아 보는 개인용 웹사이트예요.

```
[GitHub Actions, 6시간마다]  crawler/crawl.py ──> data/items.json ─┐
  (Epic, GamePower, Codester, 텀블벅, 보조금24)                       ├──> index.html (GitHub Pages)
[내 브라우저, 페이지 열 때]  userscripts/*.user.js ──> Apps Script ─┘
  (Creative Fabrica, 디자인번들, Creative Market)     (hub.gs, 저장·내보내기)
                                       └─ 임박·신규 항목 ──> 내 Gmail
```

Creative Fabrica·디자인번들·Creative Market은 GitHub 서버의 요청을 403으로 막아서, 내 브라우저에서 도는 탬퍼몽키 스크립트가 찾은 항목을 Apps Script로 직접 보내요.

## 설정 순서

1. **Apps Script**: `apps_script/hub.gs` 내용으로 통째로 교체 → 스크립트 속성 `SECRET` 설정 → 웹 앱으로 배포(액세스: 모든 사용자) → `…/exec` 주소 복사
2. **탬퍼몽키 스크립트 3개**(`userscripts/`): 설치하고 각 파일 위쪽의 `HUB_URL`, `HUB_SECRET` 채우기
3. **index.html**: `HUB_URL`에 같은 주소 넣고 저장소에 업로드
4. `crawler/crawl.py`, `crawler/sources.json`도 저장소에 업로드
5. Creative Fabrica / 디자인번들 목록 / Creative Market 무료 페이지를 브라우저로 한 번씩 열기 → 화면 왼쪽 아래에 "📤 허브로 N개 전송 완료"가 뜨면 성공

## 알아둘 점

- 탬퍼몽키가 보낸 항목은 일정 기간 안 보내면 대시보드에서 사라져요 (Creative Fabrica 2일, 디자인번들·Creative Market 10일).
- 크롤링 전에 각 사이트의 이용약관과 robots.txt를 확인하세요.
- 저장(★)과 확인 표시는 브라우저 localStorage에만 저장돼요.
- GitHub 쪽 출처 추가는 `crawler/sources.json`에서 해요 (rss / html).
