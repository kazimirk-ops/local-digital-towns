# Terminal Cheatsheet

## Git Essentials
```bash
git status
git checkout -b feature/<short-name>
git add -A
git commit -m "feat: <short summary>"
git push origin feature/<short-name>
```

## Deploy Essentials
```bash
# Staging
git pull origin main
npm install
BASE_URL=https://staging.<domain> bash scripts/smoke.sh

# Production
git pull origin main
npm install
BASE_URL=https://<domain> bash scripts/smoke.sh
```

## Debug Essentials
```bash
# Health + routes
curl -i http://localhost:3000/health
curl -i http://localhost:3000/debug/routes

# Example API calls
curl -s http://localhost:3000/api/me | jq
curl -s -X POST http://localhost:3000/api/auth/request-code \
  -H 'Content-Type: application/json' \
  -d '{"channel":"email","destination":"test@example.com","intent":"login"}'
```

## Best Practices (Commit → Push → Deploy)
- Commit small, coherent changes with clear messages.
- Run local smoke tests before pushing.
- Use PRs and require review + green CI.
- Deploy staging first, validate smoke suite, then deploy production.
- Monitor logs and error rates after production deploy.
