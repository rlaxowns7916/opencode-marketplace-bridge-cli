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

## 명령어 레퍼런스

```bash
ombc install <source> [plugin] [--force]
ombc uninstall <marketplace-name>
ombc list
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
- 일반 참조 디렉토리 -> plugin source 기준 상대 경로 그대로
- `.opencode/plugins/<bundle>/<dir>/...` 참조 -> `.opencode/plugins/<bundle>/<dir>/`

### 소유권 모델

- skills/참조 디렉토리: `.ombc-managed` marker 기반
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

문서 본문 경로는 리라이트하지 않고 frontmatter만 정규화합니다.

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

스캔 대상:

- `skills/`
- `commands/`
- `agents/`

노이즈로 간주되어 제외되는 라인:

- fenced code block
- tree diagram
- markdown table row
- comment line (`# ...`, `// ...`)
- URL 포함 라인
- `~/` 포함 라인

## 라이선스

MIT
