# Releasing

This project publishes a public npm package: `opencode-marketplace-bridge-cli`.

## Prerequisites

- Node.js 18+
- npm account with publish permission
- Authenticated local npm session (`npm login`)
- Clean working tree

## Local verification

```bash
npm test
npm run pack:check
```

## Version bump

Choose one:

```bash
npm version patch
npm version minor
npm version major
```

## Publish

```bash
npm publish --access public
```

## Tag and release notes

After publish, push version commit + tag and create GitHub release notes.

## Troubleshooting

- `ENEEDAUTH`: run `npm login`.
- `E403` on publish: package name permission issue or 2FA/auth settings.
- If package contains unexpected files, verify `package.json` `files` field and rerun `npm run pack:check`.
