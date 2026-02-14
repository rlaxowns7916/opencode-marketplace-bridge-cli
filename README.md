# opencode-marketplace-bridge-cli

Claude Code 마켓플레이스/플러그인 포맷을 OpenCode가 인식할 수 있는 형태로 변환해 설치하는 브릿지 CLI입니다.

핵심은 "이 저장소 자체"보다도, 임의의 Claude Code 마켓플레이스 소스를 받아 OpenCode 디스커버리 경로(`.opencode/skills`, `.opencode/commands`, `.opencode/agents`)에 배치 가능하게 만드는 것입니다.

## 이 프로젝트가 하는 일

`npx opencode-marketplace-bridge-cli install <source>` 실행 시:

1. `<source>`의 `.claude-plugin/marketplace.json`을 읽어 플러그인 정보를 파싱
2. 플러그인 루트의 `skills/`, `commands/`, `agents/`에서 참조하는 디렉토리만 스마트 캐시
3. `.md` 콘텐츠를 OpenCode 호환 형태로 변환
   - 경로 리라이트
   - `tools` 필드 정규화
   - `model` 필드 정규화
4. 변환된 파일을 `.opencode/` 디스커버리 경로에 설치
5. 설치 이력을 `.opencode` 레지스트리에 기록

## 용어 정리

| 용어 | 의미 |
|---|---|
| Marketplace | `.claude-plugin/marketplace.json`을 가진 상위 레포 |
| Plugin | marketplace의 `plugins[]` 항목 하나 (`name`, `source`) |
| Bridge CLI | 위 Claude Code 포맷을 OpenCode 설치 구조로 변환/설치하는 도구 |

## 빠른 시작 (OpenCode)

```bash
npx opencode-marketplace-bridge-cli install <owner>/<marketplace-repo>
```

자주 쓰면 global 설치 후 `ombc` 명령으로 실행할 수 있습니다.

```bash
npm i -g opencode-marketplace-bridge-cli
ombc install <owner>/<marketplace-repo>
```

### 지원하는 source 형식

| 입력 | 해석 |
|---|---|
| `owner/repo` | `https://github.com/owner/repo.git` |
| `https://github.com/...` | 그대로 clone |
| `/path/to/local` | clone 없이 로컬 경로 사용 |

### CLI 명령

```bash
ombc install <source>            # marketplace 전체 설치
ombc install <source> <plugin>   # 특정 plugin만 설치
ombc uninstall <name>            # 설치된 marketplace 제거
ombc list                        # 설치된 marketplace 목록
```

### 충돌 처리 옵션

```bash
ombc install <source> --force
```

- `--force`는 "다른 marketplace가 소유한" 동명 파일만 덮어쓸 수 있습니다.
- 사용자가 직접 만든 파일(관리 마커/레지스트리 미추적)은 항상 보호됩니다.

## 설치/재설치/삭제 동작

### install (최초)

- 캐시: `.opencode/plugins/cache/<marketplace>/`
- 스킬: `.opencode/skills/<skill>/SKILL.md` + managed marker
- 커맨드: `.opencode/commands/<cmd>.md`
- 에이전트: `.opencode/agents/<agent>.md`
- 레지스트리: `.opencode` 내부 registry file

### install (재실행, 멱등)

- 같은 marketplace 재설치 시:
  - 기존 관리 대상 스킬/커맨드/에이전트 정리
  - 캐시 교체
  - 다시 설치
- 사용자 관리 파일은 보존

### uninstall

- 레지스트리 기준으로 해당 marketplace가 소유한 설치물만 삭제
- 사용자 파일은 보존
- 미설치 대상 uninstall은 에러가 아니라 idempotent 동작(종료 코드 0)

## 변환 규칙

### 1) 스마트 캐시 (참조 기반)

전체 플러그인을 복사하지 않고, `.md`에서 실제로 참조된 상위 디렉토리만 캐시에 복사합니다.

- 입력 스캔 대상: `skills/`, `commands/`, `agents/`의 `.md`
- 무조건 제외: `.git`, `.github`, `.claude`, `node_modules`, `.DS_Store`, `skills`, `commands`, `agents`
- 노이즈 필터: 코드블록/트리다이어그램/테이블/주석/URL/`~/` 경로

### 2) 경로 리라이트

예:

- `rules/common/review-baseline.md`
  -> `.opencode/plugins/cache/<marketplace>/rules/common/review-baseline.md`

리라이트 제외:

- URL 내부 경로
- 이미 `.opencode/` prefix가 있는 경로

### 3) frontmatter 정규화

- `tools: ["Read", "Grep"]` 또는 `tools: Read, Grep`
  ->
  ```yaml
  tools:
    read: true
    grep: true
  ```

- `model: sonnet|opus|haiku`
  -> `anthropic/claude-sonnet-4-5`, `anthropic/claude-opus-4-5`, `anthropic/claude-haiku-4-5`

## Tool-only 프로젝트

이 저장소는 marketplace 콘텐츠 저장소가 아니라 브릿지 도구 자체에 집중합니다.

- 런타임에 필요한 것은 `bin/cli.js`와 npm 메타데이터입니다.
- marketplace 샘플 데이터는 저장소 루트가 아닌 테스트 fixture에서만 관리합니다.

## 검증

```bash
npm test
```

- `node --test` 기반 CLI 테스트 통과를 기준으로 동작을 검증합니다.

## 제약 사항

- OpenCode는 고정 디스커버리 경로만 스캔하므로 파일이 해당 경로에 물리적으로 존재해야 합니다.
- Claude Code는 캐시 업데이트를 자동 반영하지 않으므로 `/plugin update`가 필요할 수 있습니다.
- MCP 의존 스킬은 설치를 "안내"할 수는 있어도 강제할 수는 없습니다.

## 라이선스

MIT
