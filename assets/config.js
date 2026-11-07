// ───────────────────────────────────────────────
// 앱 설정 — API 파라미터가 확정되면 여기만 고치면 됩니다.
// ───────────────────────────────────────────────
window.APP_CONFIG = {
  groupName: '청년회',

  // 교회 사이트 교제록 게시판
  board: {
    // 게시판 글쓰기 화면(복사한 내용을 붙여넣을 곳)
    siteUrl:
      'https://church.jbch.org/age/board/list.php?flag=1&chId=86&use_kind=1&boardId=2122&page=1&menu_num=4&smenu_num=3&gCode=684',

    // load_boardb_post.php 로 보낼 값 (⚠ 이름은 아직 추정 — 문서 확인 후 수정)
    listParams: { boardId: 2122, chId: 86, gCode: 684 },
    pageParam: 'page',      // 페이지 번호 파라미터 이름
    detailParam: 'idx',     // 상세 글 번호 파라미터 이름
    pagesToLoad: 5,         // 처음 불러올 페이지 수 (모아보기·기도제목·참석 흐름에 사용)
  },
};
