# 생명선앱스(api.jbch.org) 게시판 API 정리

2026-11-07 apps.jbch.org 매뉴얼(게시판 API 8개 + 로그인)을 보고, 매뉴얼의 테스트 버튼으로 청년회교제실(boardId 2122)에 실제로 호출해서 확인한 내용입니다.

- 베이스 URL `https://api.jbch.org`, 모두 `POST` + JSON (사진 업로드만 multipart)
- 모든 요청에 `dev_name`(teach_bible), `tokenId`(50자리, Cloudflare 환경 변수 `JBCH_TOKEN`) — 중계 함수가 붙입니다
- 성공 여부는 본문의 `status`: `ok` / `not`(결과 없음) / `error`

## ⚠ 꼭 알아둘 점 (실제 호출로 확인)
1. **청년회교제실은 회원 전용** — `hash` 없이 부르면 `{"status":"not","result":null}`. 그래서 앱에 깨사모 로그인을 넣었습니다.
2. **목록에는 본문(content)이 비어 옴** — 본문은 `uid=글번호`로 한 번 더 불러야 옵니다.
3. **목록 행의 `uid`는 게시판 번호(2122)** 이고, 글 번호는 **`postUid`** 입니다.
4. 매뉴얼에 없지만 **`page`(1부터)·`limit`(기본 20)** 이 동작합니다. (page=3, limit=7 → 15번째 글부터 7개 확인)
5. 게시판에 쓰던 양식은 `[ 참석 B S ]`, `[ 기도부탁 ]`, `[ 광고 ]` 같은 대괄호 소제목이고, 이름 뒤에 형제 `b`·자매 `s`를 붙입니다. 앱은 이 양식과 앱 양식(`■`) 둘 다 읽습니다.
6. 제목에 부서가 들어갑니다: `[2026 순종부] 2026.10.24 토요교제`, `2026.10.10 청년회 토요교제`. 청년회교제실 전체 글 수는 약 3,500개.

## 1. 로그인 `/in/login.php`
| 이름 | 필수 | 설명 |
|---|---|---|
| Userid | 필수 | 깨사모 아이디 |
| password | 필수 | 비밀번호 |
| device | 필수 | 기기 종류 (앱은 `Web`) |
| output | 선택 | `1`이면 JSON, 아니면 `status@@ok@@hash` 글자 |

응답: `result`(ok/error), `hash`(성공 시), `comment`(실패 메시지). 토큰 오류는 HTTP 500 + `Not_certification!`.
같은 그룹: `/in/autologin.php`(hash로 웹 자동 로그인), `/in/member_json.php`(hash → 내 회원정보).

## 2. 게시글 목록·상세 `/in/load_boardb_post.php`
| 이름 | 필수 | 설명 |
|---|---|---|
| chId | 필수 | 교회 번호 (86) |
| use_kind | 필수 | 1 게시판 · 2 교회뉴스 · 3 앨범 |
| flag | 필수 | 1 교회 |
| boardId | 선택 | 게시판 번호 (2122) |
| hash | 선택 | 회원 전용 글을 보려면 필요 |
| uid | 선택 | 글 번호(postUid) → 그 글 하나 + 본문 |
| gId | 선택 | 부서 id (청년회 684) |
| swCount | 선택 | 1 전체 글 수(`total`), 2 최초·최신 등록일 |
| page, limit | (매뉴얼에 없음) | 페이지(1부터), 한 번에 받을 수 |

응답: `{ status, result: [ ... ] }`. 글 한 건의 주요 값:
`postUid`(글 번호), `subject`, `content`(HTML, 상세에서만), `created`, `username`, `userid`, `hit`, `total_comment`, `total_good`, `position`(=게시판 번호), `position_name`(청년회교제실), `files[]`(`filepath`, `originalname`, `extention`, `filesize`), `imgs[]`, `auth_write`·`auth_view`·`auth_reply`.

## 3. 최신글 `/in/load_boardb_latest.php`
| 이름 | 필수 | 설명 |
|---|---|---|
| boardIds | 필수 | 게시판 번호들 |
| cnt | 선택 | 게시판별 개수 (기본 1, 최대 100) |
| hash | 선택 | 회원 전용 게시판은 필요 (2122는 hash 없으면 빈 응답) |

응답은 `status` 없이 게시판 번호를 키로 하는 객체:
`{ "2122": { position, position_name, img_primary, posts: [ { uid, position, subject, opened, created, userid, username, ... } ] } }`

## 4. 댓글 목록 `/in/load_boardb_comment.php`
| 이름 | 필수 | 설명 |
|---|---|---|
| board_uid | 선택 | 글 번호 |
| uid | 선택 | 댓글 번호 |
| orderby | 선택 | 정렬 (기본 DESC) |

응답은 `status` 없이 **배열만**: `[ { uid, board_uid, category_uid, userid, comment, created, username, sex, sexori, churchname, chid, profilePic } ]`. 댓글 없으면 `[]`. hash 없이도 옵니다.

## 5. 댓글·좋아요 처리 `/in/boardb_pro_json.php`
공통: `hash`(필수), `mode`(필수), `board_uid`, `chId`
| mode | 더 필요한 값 | 응답 |
|---|---|---|
| add_comment | comment(2자 이상), url(깨사모 알림 링크) | `{status, uid, profilePic, comment, writer, churchname}` |
| del_comment | comment_uid | `{status, total_comment}` |
| processLike | sw (1 좋아요, 2 취소) | `{status, process: plus/minus, total_like}` |
| chkLike | — | `{status, liked, total_like}` |
| countComment | — | `{status, total_comment}` |
| updateHit | — | `{status}` |

## 6. 글쓰기 `/in/boardb_write_json.php` ✅ 있음
| 이름 | 필수 | 설명 |
|---|---|---|
| hash | 필수 | 작성자 |
| boardId | 필수 | 게시판 번호 |
| subject | 필수 | 제목 |
| content | 선택 | 본문 |
| tags | 선택 | 쉼표로 구분 |
| notice, front_on | 선택 | 0/1 |
| view | 선택 | 0/1/2 (기본 1) |
| pw | 선택 | 비밀번호 |
| fileId[], fileName[] | 선택 | 업로드 API가 준 값 (순서 맞춰서) |

응답: `{ status, result: { uid, position, num, flag, chId } }`. 쓰기 권한 게시판(auth_write=1)은 권한 있는 회원만. 푸시·SNS 공유는 안 됨.

## 7. 첨부 업로드 `/in/boardb_upload_json.php` (multipart/form-data)
`hash`(필수), `file`(필수), `chId`(선택). 파일 하나에 한 번 호출.
응답: `{ status, result: { fileId, fileName, isImage, sumUrl } }` → 글쓰기의 `fileId[]`/`fileName[]`로 넘김. 이미지는 회전 보정·썸네일 자동.

## 8. 글 삭제 `/in/boardb_delete_json.php`
`hash`, `uid`(글 번호). 본인 글만. 응답 `{ status, result: { uid, deleted } }`.

## 9. 게시판 정보 `/in/load_category_board.php`
`chId`(필수), `use_kind`(필수), `boardId`, `flag`. 응답: 게시판 제목·권한·이미지 설정 등.

## 푸시 API
매뉴얼에 **푸시를 보내는 API는 없습니다.** 비슷한 것:
- `/in/noti_newcount_json.php` — hash로 내 새 알림 개수 (`result.total`)
- `/in/send_message_json2.php` — 깨사모 쪽지 보내기 (`toIds`, `subject`, `content`, 첨부)
- 댓글 추가(`add_comment`)의 `url`이 깨사모 알림에 저장됨
