# Local Digital Towns

## Run server
```bash
node server.js
```

## Smoke tests
```bash
bash scripts/smoke_test.sh
```

Optional:
```bash
source scripts/smoke_vars.sh
```

## Debug
- `/debug/routes` and `/debug/context` require admin or dev login.
- If a test fails: restart server, check `/debug/routes`, then verify auth cookies.
