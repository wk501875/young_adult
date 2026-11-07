// ───────────────────────────────────────────────
// 앱 설정 — 게시판이 바뀌면 여기만 고치면 됩니다.
// (2026-11-07 apps.jbch.org 매뉴얼과 실제 응답으로 확인한 값)
// ───────────────────────────────────────────────
window.APP_CONFIG = {
  appName: '일산교회 청년회',   // 앱 이름 (로고·로그인·브라우저 탭)
  groupName: '청년회',          // 글 제목에 들어가는 이름
  groupCode: 684,              // 청년회 부서 코드 (교회 일정 불러올 때)
  meetingName: '토요교제',   // 글 제목 끝말: [2026 순종부] 2026.10.24 토요교제

  // 교회 사이트 교제록 게시판 (청년회교제실)
  board: {
    boardId: 2122,
    chId: 86,

    // 게시판 목록 화면 (복사한 내용을 붙여넣을 곳)
    siteUrl:
      'https://church.jbch.org/age/board/list.php?flag=1&chId=86&use_kind=1&boardId=2122&page=1&menu_num=4&smenu_num=3&gCode=684',

    // load_boardb_post.php 로 보낼 값 — 회원 전용 게시판이라 로그인(hash)이 있어야 글이 옵니다.
    listParams: { boardId: 2122, chId: 86, use_kind: 1, flag: 1 },
    pageParam: 'page',     // 페이지 번호 (1부터, 매뉴얼에는 없지만 동작 확인)
    limitParam: 'limit',   // 한 번에 받을 글 수 (기본 20, 매뉴얼에는 없지만 동작 확인)
    pageSize: 40,          // 모아보기에서 한 번에 불러올 글 수
    detailParam: 'uid',    // 글 하나의 본문을 받을 때: uid = 목록의 postUid
    bodiesToLoad: 24,      // 기도제목·참석 흐름을 위해 본문까지 읽어 둘 최근 글 수

    // 앱에서 바로 올리기 (boardb_write_json.php) 사용 여부
    writeEnabled: true,
  },
};
