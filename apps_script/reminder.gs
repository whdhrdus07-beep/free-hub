/**
 * 무료정보 허브 → 구글 메일 알림 (웹훅 수신)
 *
 * 설정
 * 1) script.google.com 에서 새 프로젝트 만들고 이 코드를 붙여넣기
 * 2) 프로젝트 설정 → 스크립트 속성 → SECRET = 아무 긴 문자열 (GitHub의 WEBHOOK_SECRET과 같은 값)
 * 3) test() 를 한 번 실행해서 메일 발송 권한 허용
 * 4) 배포 → 새 배포 → 웹 앱 / 실행 사용자: 나 / 액세스: 모든 사용자
 * 5) 나온 웹 앱 URL 을 GitHub 시크릿 WEBHOOK_URL 에 저장
 */

const CAT = { game: "게임", design: "디자인 소스", photo: "사진", gov: "지원금·공지", trial: "체험단" };

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput("bad request");
  }
  const secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  if (!secret || body.secret !== secret) {
    return ContentService.createTextOutput("denied");
  }
  const items = body.items || [];
  if (items.length) {
    MailApp.sendEmail({
      to: Session.getEffectiveUser().getEmail(),
      subject: "[무료정보] 확인할 항목 " + items.length + "건",
      htmlBody: render_(items),
    });
  }
  return ContentService.createTextOutput("ok");
}

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
