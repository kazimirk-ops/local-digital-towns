#!/bin/bash

export R2_ACCOUNT_ID=d29d33f25f64afdd001df04920eaf237
export R2_ACCESS_KEY_ID=672156aded15afb375f98d97af1d0276
export R2_SECRET_ACCESS_KEY=bf5907c0b2b52a45d72acedc0eb1323502d3158356b36718b7f7a043ba79b098
# R2_BUCKET value should match storage.r2Bucket in config/town-config.json
export R2_BUCKET="sebastian-assets"
export R2_PUBLIC_BASE_URL=https://pub-303c7bb64756430cb1d3395ea28e0e92.r2.dev

if [ -f .env.local ]; then
  set -a
  . .env.local
  set +a
fi

if [ -f .env ]; then
  set -a
  . .env
  set +a
fi

node server.js
