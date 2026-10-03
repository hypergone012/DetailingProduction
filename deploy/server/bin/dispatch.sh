#!/bin/sh
# dp-dispatch.service: asks the notify-dispatcher function to deliver due notifications (the
# hosted project does this with pg_cron + pg_net). The secret goes in a header read from stdin,
# so it never appears in the process list.
set -eu
printf 'x-dispatcher-secret: %s\ncontent-type: application/json\n' "$DISPATCHER_SECRET" |
  curl -fsS -m 50 -o /dev/null -X POST -H @- --data '{}' "http://127.0.0.1:${DP_GATEWAY_PORT:-54321}/functions/v1/notify-dispatcher"
