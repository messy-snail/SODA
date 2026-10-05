@AGENTS.md

## Claude Code

- **규칙 원본**: `AGENTS.md`가 공통 규칙의 원본이다. 이 파일에는 Claude Code 전용 사항만 둔다.
- **로컬 메모**: 이 PC에만 해당하는 메모는 `CLAUDE.local.md`에 둔다(git 제외).
- **권한 설정**: 도구 권한과 허용 목록은 `.claude/settings*.json`에서 관리하고, 이 파일에 적지 않는다.
- **큰 변경**: 새 도구 패널, 새 지구본 레이어, API 여러 개 변경 같은 작업은 구현 전에 계획을 세우고 사용자에게 의미 있는 선택지를 확인받는다.
- **서버 실행**
  - `uv run soda serve`는 background로 실행한다.
  - 포트가 이미 쓰이고 있으면 `--port`로 바꾸고, `SODA_URL`로 스모크 테스트에 알려준다.
- **화면 확인**
  - Playwright 스모크 테스트를 돌린 뒤 `.cache/screenshots/*.png`를 Read로 직접 열어 본다.
  - 스크린샷을 연 직후 같은 파일에 다시 쓰면 Windows 파일 잠금으로 실패할 수 있다. 그때는 한 번 더 실행한다.
- **CelesTrak 네트워크 요청**: 서버의 자동 갱신과 사용자 조작으로만 발생하게 한다. 디버깅하려고 curl로 CelesTrak을 반복 호출하지 않는다. 응답 형식은 `tests/fixtures/omm_iss.json`을 참고한다.
- **관련 스킬**: `python-project-setup`, `javascript-typescript-project`, `web-project`, `documentation-style`, `commitizen-commit`, `git-workflow`
