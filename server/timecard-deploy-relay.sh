#!/usr/bin/env bash
set -euo pipefail
if test -f /timecard/deploy/.ryzen-enabled; then
  touch /timecard/deploy/ryzen-deploy.request
  printf 'Timecard deployment queued for Ryzen.\n'
  exit 0
fi
export DEPLOY_DIR=/timecard
export DB_VOLUME=/home/natuki/services/discord-bots/timecard-discord-bot/db
git config --global --add safe.directory /timecard 2>/dev/null || true
exec bash /timecard/scripts/deploy.sh
