# 무료 정보 허브

무료 정보를 한 페이지에 모아 보는 개인용 웹사이트예요.

```
GitHub Actions (6시간마다)
  crawler/crawl.py ──> data/items.json ──> GitHub Pages (index.html)
        │
        └─ 임박·신규 항목 ──> Apps Script 웹훅 ──> 내 Gmail
```

## 설치 순서

1. 이 폴더를 GitHub 저장소로 올리기
2. Settings → Pages → Deploy from branch → `main` / root
3. (선택) 공공데이터포털에서 "행정안전부_대한민국 공공서비스(혜택) 정보" 활용 신청 후, 일반 인증키(Decoding)를 저장소 시크릿 `DATA_GO_KR_KEY`로 등록
4. 메일 알림: `apps_script/reminder.gs` 상단 주석대로 배포하고, 웹 앱 URL을 `WEBHOOK_URL`, 스크립트 속성에 넣은 값을 `WEBHOOK_SECRET` 시크릿으로 등록
5. Actions 탭 → crawl → Run workflow 로 첫 수집 실행

`index.html`은 `data/items.json`이 없으면 샘플 데이터를 보여줘요.

## 출처 추가하기 (`crawler/sources.json`)

- `rss`: 피드 주소만 넣으면 돼요. `include`에 넣은 단어가 제목·요약에 있는 글만 가져와요.
- `html`: 목록 페이지에서 `item`(한 줄), `link`, `title` CSS 선택자를 지정해요.
- 마감일은 글 안의 날짜 중 마지막 것을 자동으로 잡아요. 못 찾으면 "상시"로 표시돼요.

## 알아둘 점

- 크롤링 전에 각 사이트의 이용약관과 robots.txt를 확인하세요. 개인 열람용으로 낮은 빈도로 가져오는 걸 전제로 짰어요.
- 로그인이 필요하거나 자바스크립트로 목록을 그리는 사이트는 `html` 방식으로 안 잡혀요. 그런 곳은 공개 API나 RSS가 있는지 먼저 찾아보세요.
- Gmail에는 들어오는 웹훅이 없어서, Apps Script 웹 앱이 웹훅을 받아 메일을 보내는 구조로 만들었어요. 일반 계정은 하루 발송 한도가 있어서 항목을 묶어 한 통으로 보내요.
- 저장(★)과 확인 표시는 브라우저 localStorage에만 저장돼요.
