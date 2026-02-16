# opencode-marketplace-bridge-cli

`opencode-marketplace-bridge-cli`(실행 명령: `ombc`)는 Claude Code marketplace/plugin 포맷을 OpenCode에서 바로 사용할 수 있도록 설치해주는 브릿지 CLI입니다.

이 도구는 `.claude-plugin/marketplace.json`을 기준으로 플러그인을 해석하고, OpenCode 디스커버리 경로에 필요한 파일을 배치한 뒤 설치 소유권을 레지스트리로 관리합니다.

## 목차

- [프로젝트 목적](#프로젝트-목적)
- [요구 사항](#요구-사항)
- [설치](#설치)
- [사용 방법](#사용-방법)
- [명령어 레퍼런스](#명령어-레퍼런스)
- [동작 보장 사항](#동작-보장-사항)
- [콘텐츠 정규화 규칙](#콘텐츠-정규화-규칙)
- [의존성 그래프](#의존성-그래프)
- [라이선스](#라이선스)

## 프로젝트 목적

Claude Code와 OpenCode는 플러그인 디스커버리 방식이 다릅니다.

이 CLI는 그 차이를 연결하기 위해 다음을 수행합니다.

- marketplace 소스 해석(GitHub shorthand, Git URL, 로컬 경로)
- OpenCode 디스커버리 경로로 skills/commands/agents 설치
- 문서에서 실제로 참조하는 디렉토리만 선별 배치
- 설치 소유권 레지스트리 관리(재설치/삭제 안정성 확보)

## 요구 사항

- Node.js `>= 18.0.0`

## 설치

권장 방식(전역 설치):

```bash
npm install -g opencode-marketplace-bridge-cli
```

설치 후 `ombc` 명령을 바로 사용할 수 있습니다.

```bash
ombc --help
```

`npx` 실행도 가능하지만, 반복 사용 환경에서는 전역 설치를 권장합니다.

## 사용 방법

GitHub shorthand 설치:

```bash
ombc install owner/repo
```

특정 plugin만 설치:

```bash
ombc install owner/repo plugin-name
```

다른 marketplace 소유 파일 덮어쓰기(`--force`):

```bash
ombc install owner/repo --force
```

설치 제거:

```bash
ombc uninstall marketplace-name
```

설치 목록 조회:

```bash
ombc list
```

설치된 marketplace 일괄 업데이트:

```bash
ombc update
```

## 명령어 레퍼런스

```bash
ombc install <source> [plugin] [--force]
ombc uninstall <marketplace-name>
ombc list
ombc update [--force]
```

### `source` 지원 형식

| 입력 | 해석 방식 |
|---|---|
| `owner/repo` | `https://github.com/owner/repo.git`로 shallow clone |
| `https://...` | 해당 URL clone |
| `git@...` | 해당 URL clone |
| 로컬 경로 | clone 없이 직접 사용 |

## 동작 보장 사항

### 설치 경로

`ombc install <source>` 실행 시:

- skills -> `.opencode/skills/<skill>/`
- commands -> `.opencode/commands/<command>.md`
- agents -> `.opencode/agents/<agent>.md`
- 참조된 파일 -> `.opencode/<pluginName>/` 하위에 선별 복사
- 의존성 그래프(BFS)가 skills/commands/agents에서 시작하여 재귀적으로 참조를 추적하고, 실제로 참조된 파일만 복사합니다. 참조되지 않은 파일/디렉토리는 복사하지 않습니다.

### 소유권 모델

- skills/참조 파일(`.opencode/<pluginName>/`): `.ombc-managed` marker 기반
- commands/agents: 레지스트리 소유권 기반
- 설치 레지스트리: `.opencode/.ombc-registry.json`

### 충돌 정책

- 사용자 파일(소유권 정보 없음)은 덮어쓰지 않습니다.
- 다른 marketplace 소유 파일은 기본적으로 건너뜁니다.
- `--force`는 다른 marketplace 소유 파일만 덮어쓸 수 있습니다.
- `--force`를 사용해도 사용자 파일은 보호됩니다.

### 재설치/삭제 동작

- 재설치는 멱등(idempotent)하게 동작하며 기존 관리 산출물을 안전하게 교체합니다.
- 레거시 캐시 경로(`.opencode/plugins/cache/...`)가 있으면 자동 정리합니다.
- `ombc uninstall <name>`은 `<name>`이 소유한 항목만 제거하고 빈 상위 디렉토리를 정리합니다.
- 미설치 대상 uninstall은 경고 메시지 출력 후 종료 코드 0으로 종료합니다.

## 콘텐츠 정규화 규칙

frontmatter 필드를 정규화하고, 문서 본문의 파일 경로를 `.opencode/<pluginName>/` 기준으로 재작성합니다.

### 본문 경로 재작성

참조 파일이 `.opencode/<pluginName>/`에 복사되므로, 문서 본문의 경로도 일관되게 재작성합니다.

- `@plugins/<bundle>/rules/file.md` → `@.opencode/<pluginName>/rules/file.md`
- `rules/file.md` (상대 경로) → `.opencode/<pluginName>/rules/file.md`
- `/rules/file.md` (leading slash) → `.opencode/<pluginName>/rules/file.md`
- 이미 `.opencode/` 접두사가 있는 경로는 이중 변환하지 않습니다.

### `tools` 정규화

입력 예시:

- `tools: ["Read", "Grep"]`
- `tools: Read, Grep`

출력:

```yaml
tools:
  read: true
  grep: true
```

### `model` 정규화

- `model: sonnet` -> `anthropic/claude-sonnet-4-5`
- `model: opus` -> `anthropic/claude-opus-4-5`
- `model: haiku` -> `anthropic/claude-haiku-4-5`

`anthropic/...` 같은 provider/model 형식은 그대로 유지합니다.

### 참조 스캔 규칙

참조 스캔은 Markdown 파서 기반(AST/토큰)으로 문서 구조를 해석한 뒤, 허용된 텍스트 노드에서만 경로를 추출합니다.

스캔 대상:

- `skills/`
- `commands/`
- `agents/`

노이즈로 간주되어 제외되는 라인:

- fenced code block (backtick/tilde 코드 펜스 포함)
- tree diagram (`├──`, `└──` 등)
- markdown table row (GFM 테이블, leading `|` 없는 행 포함)
- heading (`# ...`, `## ...`, `### ...` 등 모든 레벨)
- comment (`// ...`)
- URL 포함 라인 (`https://...`, `http://...`)
- `~/` 포함 라인

## 의존성 그래프

`ombc install`은 BFS 기반 재귀 참조 추적으로 실제 필요한 파일만 선별 복사합니다.

### 동작 방식

1. **시드 수집**: `skills/`, `commands/`, `agents/` 디렉토리의 스캔 가능 파일을 큐에 추가
2. **BFS 탐색**: 큐에서 파일을 꺼내 참조 경로를 추출하고, 참조된 파일/디렉토리를 다시 큐에 추가
3. **선별 복사**: 탐색이 완료되면 도달 가능한(reachable) 파일만 `.opencode/<pluginName>/`에 복사

### 스캔 대상 확장자

재귀 스캔은 `SCANNABLE_EXTENSIONS`에 해당하는 파일만 수행합니다.

- `.md`
- `.txt`

해당 확장자가 아닌 파일은 참조되면 복사하지만, 그 내부를 스캔하지는 않습니다.

### 노이즈 필터링

참조 추출 전에 각 파일 내용에서 노이즈 라인을 제거합니다. 제거 대상은 [참조 스캔 규칙](#참조-스캔-규칙)을 참고하세요.

## 라이선스

MIT
