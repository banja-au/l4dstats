# Production monitoring and incident response

This runbook covers the private single-user Compose deployment. It does not
turn the research-only cheating score into moderation decision support.

## Signals and thresholds

Poll the authenticated public boundary every 30 seconds:

```bash
WITCHWATCH_WEB_USERNAME=operator \
WITCHWATCH_WEB_PASSWORD='replace-with-production-secret' \
pnpm health:production

WITCHWATCH_WEB_USERNAME=operator \
WITCHWATCH_WEB_PASSWORD='replace-with-production-secret' \
pnpm metrics:production
```

The probe must receive HTTP 200 and `{ "ok": true, "checks": {
"database": true } }`. Alert after three consecutive failures. Compose also
checks the API database query and the worker heartbeat. Treat any service that
is `unhealthy`, repeatedly restarting, or absent as an incident.

For this local deployment, inspect service state and bounded recent logs with:

```bash
docker compose -f compose.production.yaml ps
docker compose -f compose.production.yaml logs --since 15m --tail 500 api worker web
```

Never publish logs without reviewing them for player names, local paths and
source URLs. Do not log bearer tokens, Basic credentials or pseudonym keys.

Recommended initial alerts are:

| Signal                           | Warning                   | Critical                   |
| -------------------------------- | ------------------------- | -------------------------- |
| Public readiness                 | one failed probe          | three consecutive failures |
| API or worker container          | one restart in 15 minutes | restart loop or unhealthy  |
| Disk containing `workbench-data` | 75% used                  | 90% used                   |
| Oldest queued job                | 5 minutes                 | 15 minutes                 |
| Failed jobs                      | three in 15 minutes       | ten in 15 minutes          |
| Backup age                       | 25 hours                  | 48 hours                   |

The authenticated public `/metrics` route exports Prometheus text without job
IDs, demo hashes, player identities, filenames, paths or URLs. Scrape it only
over the private operator network. The API route is intentionally unauthenticated
inside the private Compose network so Prometheus can scrape it directly; API
port 8787 must never be published.

Recommended Prometheus alert rules are:

```promql
l4dstats_database_ready != 1
l4dstats_worker_heartbeat_available != 1
l4dstats_worker_heartbeat_age_seconds > 15
l4dstats_oldest_queued_job_age_seconds > 300
l4dstats_jobs{state="failed"} > 2
increase(l4dstats_auth_rejections_total[5m]) > 20
increase(l4dstats_mutation_rate_limited_total[5m]) > 10
sum(rate(l4dstats_http_requests_total{class="5xx"}[5m])) > 0
histogram_quantile(0.95, sum by (le) (rate(l4dstats_http_request_duration_seconds_bucket[5m]))) > 1
```

The durable job-state metric is a current gauge, so use a monitoring-system
recording rule or database-backed event telemetry for an exact failed-job rate.
Until that is added, alert directly when `l4dstats_jobs{state="failed"}` rises
and confirm the time window from bounded logs. Request-latency histograms and
outcome counts cover the API process. Public-edge latency and host disk/capacity
signals remain infrastructure responsibilities.

## Triage

1. Record UTC start time, affected URL, current Compose state and the last 500
   bounded log lines. Do not delete or mutate data during evidence collection.
2. Classify the failure as public boundary, API/database, worker/parser,
   capacity, security, or data-integrity.
3. If credentials may be exposed, rotate the web password, API token and
   pseudonym key. Changing the pseudonym key breaks cross-demo stable identity,
   so preserve the old key securely for forensic comparison and reanalyse data
   under the new key.
4. If a malicious demo or parser crash is suspected, stop the worker first.
   Preserve the demo hash and job ID, but do not redistribute the demo.
5. If SQLite or artifacts may be damaged, stop API and worker, take a backup,
   verify its checksum, then restore only from a known-good archive using the
   documented restore command.

## Recovery checks

After remediation:

1. Confirm all three services are healthy and stable for ten minutes.
2. Run `pnpm health:production` through the same network path users access.
3. Upload a non-sensitive known-good demo and confirm it reaches a dedicated
   analysis or grouped-game URL.
4. Confirm a failed authentication attempt is rejected, a valid request works,
   and API port 8787 is not published externally.
5. Check the most recent backup checksum and schedule a restore drill if the
   incident involved persistence.

## Communication and closure

Record impact, timestamps, affected job and game IDs, root cause, recovery,
data-loss assessment and follow-up owner. If a displayed statistic was wrong,
invalidate its derivation version and require reanalysis rather than silently
changing historical output. Never describe a cheating score as proof or take
automated action against a player.

Close the incident only after monitoring is stable, recovery checks pass and
the corrective change has regression coverage. Add the failure mode to the
threat model or demo-data contract when it changes a security or statistical
assumption.
