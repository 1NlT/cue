# Cue

행사 포스터·공지문 사진 또는 PDF·HWP·HWPX 파일을 선택하면 AI가 행사 여부를 먼저 판정하고, 행사일 때만 이름·종류·시간·장소 후보를 추출하는 Flutter 앱입니다. 사용자가 후보를 확인하고 승인해야 기기 캘린더에 일정과 알림이 저장됩니다. 저장·관심 표시 등의 행동으로 취향을 점진적으로 파악해 등록된 행사를 추천합니다.

## 구성

- `lib/`: Flutter 앱. 카메라/사진첩/문서 선택, 후보 선택과 직접 수정, 캘린더 저장과 저장된 일정의 수정·취소, 개인화 피드백, 라이트/다크 테마와 일정 기본값 설정.
- `server/`: Node.js 22.13+ API. OpenAI 호출, Supabase 익명 사용자 식별, 문서 텍스트 추출, Supabase PostgreSQL 저장소와 개인화 서비스. Supabase를 설정하지 않은 로컬 테스트에서는 SQLite를 사용합니다.
- `supabase/migrations/`: Supabase PostgreSQL 테이블·RLS·인덱스·프로필 생성 트리거.
- OpenAI 키는 **서버 프로세스의 `OPENAI_API_KEY` 환경변수에만** 둡니다. 앱에는 서버 URL만 전달합니다. `server/setup_key.command`에서 화면에 표시되지 않는 입력으로 키를 받아 권한 `600`의 `server/.env`에 보관하고, 서버 시작 시 환경변수로 읽습니다. 이 파일은 Git에서 제외됩니다.

## 로컬 실행

```bash
cd server
export OPENAI_API_KEY='YOUR_KEY'
export OPENAI_MODEL='gpt-4.1-mini'
npm ci
npm start
```

Mac에서는 `server/setup_key.command`를 더블클릭해 키를 입력할 수도 있습니다. 이 창은 키를 저장한 다음 서버를 `8788` 포트에서 실행합니다. 앱이 Mac의 로컬 서버를 쓰는 동안 창을 열어 두세요.

다른 터미널에서:

```bash
flutter pub get
# iOS 시뮬레이터: 호스트 localhost
flutter run --dart-define=CUE_API_URL=http://localhost:8787
# Android 에뮬레이터: 호스트는 10.0.2.2
flutter run --dart-define=CUE_API_URL=http://10.0.2.2:8787
# 이번 iPhone 실기기: Mac의 Cue 서버(8788)
flutter run --release -d 00008140-000E65980C10801C --dart-define=CUE_API_URL=http://gimnagyun-ui-MacBookAir.local:8788
```

위 iPhone 주소는 같은 로컬 네트워크에서 테스트하기 위한 것입니다. Mac 서버를 종료하거나 네트워크가 바뀌면 분석할 수 없습니다. 외부 배포에서는 HTTPS 서버 주소를 사용하세요. 개발용 Android 디버그 빌드에서만 일반 HTTP 연결을 허용합니다. Supabase 설정이 없는 로컬 테스트 데이터는 권한 `600`의 `server/data/cue.sqlite`에 저장됩니다. 기존 `cue.json`이 있으면 새 DB의 첫 시작에서 사용자 토큰·저장 일정·추천 목록을 한 번 가져옵니다. 원본 JSON은 백업으로 남고 두 파일 모두 Git에서 제외됩니다.

## 사용자 기억과 추천

- 설치별 익명 토큰으로 사용자를 분리합니다. 사용자별 `profiles`, `events`, `event_sessions`, `user_events`, `event_interactions`, `interest_profiles`, `goals`, `tasks`, `agent_memories`, `recommendations` 테이블을 서버 DB에 둡니다.
- `관심 있음`, `관심 없음`, `계획하기`, 일정 저장·취소를 원본 행동으로 기록합니다. 가중치와 90일 감쇠 규칙은 `server/src/personalization.js`에 모았습니다. 반복된 근거가 있을 때만 만료 기한이 있는 Memory를 만듭니다.
- 추천은 실제 등록된 미래 행사 중 관심 분야에 맞고 신청 기한이 지나지 않았으며 Cue에 저장한 일정과 겹치지 않는 후보를 고릅니다. 기기 캘린더 전체나 위치 정보는 현재 읽지 않으므로 그 조건을 추정하지 않습니다. 추천 이유와 사용자 반응을 기록합니다.
- 설정에서 개인화를 끄면 새 관심 행동 기록과 추천을 중단하고 계산된 관심도·Memory를 비웁니다. `DELETE /v1/account`는 서버의 사용자 데이터를 삭제합니다. 기기 캘린더 항목은 별도로 관리합니다.

## Supabase 연결

SQL 마이그레이션을 프로젝트 SQL Editor에서 실행하고 익명 로그인을 활성화합니다. `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`를 서버 환경변수(또는 Git에서 제외된 `server/.env`)와 Flutter `--dart-define`에 지정하면 앱이 Supabase Auth 익명 사용자를 만들고 서버가 JWT를 검증합니다. `profiles` 행은 가입 트리거로 생성됩니다. 행사·목표·상호작용은 사용자의 JWT와 RLS로 저장됩니다. 관심도·Memory·추천 계산 결과는 백엔드가 사용자 ID를 검증한 뒤 서버 전용 `SUPABASE_SERVICE_ROLE_KEY`로 저장합니다. 기존 SQLite 사용자 데이터는 해당 사용자의 첫 클라우드 요청 때 한 번 이전합니다. 공유 행사 목록 등록과 Auth 계정 삭제에도 서버 전용 키가 필요합니다. Flutter에는 공개용 URL·publishable key만 들어가며 비밀 키와 OpenAI 키는 넣지 않습니다. 설정 화면에서 연결 상태와 사용자 ID를 확인할 수 있습니다.

## 추천 행사 등록

추천은 확인 가능한 행사 목록을 기반으로 합니다. 목록이 비어 있으면 앱은 빈 상태를 보여주며, 임의의 행사를 만들어 추천하지 않습니다. 관리자가 `CATALOG_ADMIN_TOKEN` 환경변수를 설정한 뒤 실제 행사를 등록할 수 있습니다.

```bash
curl -X POST http://localhost:8787/v1/catalog/import \
  -H "Authorization: Bearer $CATALOG_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"events":[{"title":"행사 이름","venue":"행사 장소","startsAt":"2027-01-01T18:00:00+09:00","endsAt":"2027-01-01T20:00:00+09:00","category":"음악","description":"공식 안내문에서 확인한 설명"}]}'
```

지원 종류: 음악, 전시, 공연, 스포츠, 음식, 교육, 커뮤니티, 기타. 사용자가 저장한 행사 종류와 일치하는 미래 행사만 추천합니다.

## 데이터와 예외 흐름

- 서버는 1차 판정에서 행사 안내물이 아니라고 판단하면 2차 추출 호출을 하지 않습니다.
- 여러 시간·장소 조합은 별도 후보로 전달합니다. 앱에서는 하나를 선택해야 저장할 수 있습니다.
- 추출한 세부 정보가 불명확하면 사용자가 직접 입력해야 합니다. AI가 추출한 정보는 저장 전 수정할 수 있습니다.
- 캘린더 저장에 성공한 뒤에만 서버의 개인 취향 기록을 추가합니다. 사진과 문서는 서버 디스크에 저장하지 않습니다. PDF는 OpenAI에 파일 입력으로 전달하며 HWP/HWPX는 서버에서 본문 텍스트를 추출해 전달합니다. 암호화되거나 글자를 읽을 수 없는 한글 문서는 오류를 표시합니다.
- `내 일정`에서 저장한 일정의 이름·장소·시간·행사 종류·알림을 수정하거나 일정과 알림을 함께 취소할 수 있습니다. 수정·취소는 기기 캘린더와 Cue 기록에 반영됩니다. 이전 버전에서 저장한 일정은 제목·장소·시작/종료 시간이 일치하는 캘린더 항목이 정확히 하나일 때만 연결합니다.
- 현재 로컬 모드에서는 앱 설치별 임의 토큰으로 사용자를 식별합니다. 재설치·기기 변경 시 계정 복원은 제공되지 않습니다. Supabase Auth를 구성하면 익명 계정으로 시작하고 추후 계정 연결을 할 수 있습니다.

## 검사

```bash
flutter analyze
flutter test
cd server && npm test
```
