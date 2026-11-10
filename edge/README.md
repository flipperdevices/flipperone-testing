# NEURAL LINK EDGE

This directory contains a local collector, an opt-in sender, and an authenticated
SQLite receiver for development and controlled pilot testing. All components use
the Python standard library.

## 1. Collect locally

```bash
./start-tests.sh --temperature --time 1 --interval 1
python3 edge/export_jsonl.py results/test_run_<timestamp>/system_data.csv \
  --output results/test_run_<timestamp>/neural_link.jsonl \
  --device-id tar001-edge-001
```

The exporter writes versioned `neural-link.edge.sample.v1` JSONL records. Device IDs
should be stable opaque identifiers, not personal hostnames.

## 2. Start the receiver (development)

Create a strong receiver token and keep it out of source control:

```bash
export NEURAL_LINK_RECEIVER_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
export NEURAL_LINK_RECEIVER_DB="./neural_link.sqlite3"
python3 edge/receive_jsonl.py --host 127.0.0.1 --port 8080
```

The receiver listens at `/v1/edge/samples`. It requires bearer authentication,
`application/x-ndjson`, a matching SHA-256 `Idempotency-Key`, and a body no larger
than 1 MiB. It validates the entire batch before inserting anything. A batch must
contain samples from exactly one device and must use the documented source and metric
name/unit pairs (`temp_*=Cel`, `load_*= %`, `freq_*=MHz`). Samples and idempotency
keys are stored in SQLite in a transaction. Replayed batches are acknowledged as
duplicates and are not inserted again.

The default bind address is loopback (`127.0.0.1`). The built-in server uses HTTP and
is for local development only. For a remote pilot, deploy behind a TLS reverse proxy,
restrict network access, provision unique credentials, define device authorization,
retention/deletion policy, backups, monitoring, and operational ownership. Do not expose
the development server directly to the public internet.

## 3. Send a batch

For local end-to-end testing, explicitly enable plain HTTP only for loopback:

```bash
export NEURAL_LINK_ENDPOINT="http://127.0.0.1:8080/v1/edge/samples"
export NEURAL_LINK_TOKEN="$NEURAL_LINK_RECEIVER_TOKEN"
python3 edge/send_jsonl.py results/test_run_<timestamp>/neural_link.jsonl \
  --allow-insecure-loopback
```

The sender rejects plain HTTP by default and rejects non-loopback HTTP even when the
development flag is supplied. Remote endpoints must use HTTPS. Before opening a
connection, the sender validates the complete sample schema, enforces the same
single-device and metric-unit rules as the receiver, and rejects payloads larger than
1 MiB. It uses bearer authentication, a content hash as idempotency key, and a timeout;
automatic retries are intentionally disabled. Credentials are read from environment
variables and are never printed.

## 4. Tests

```bash
python3 -m unittest discover -s tests -v
```

Tests cover export, sender/receiver schema validation, metric units, batch consistency,
authentication, media type, payload bounds, idempotency, and receiver persistence.
Run the complete repository test suite and hardware checks before using this on a board.

## Deployment boundary

This repository contains a receiver implementation, but it is not deployed or hosted.
No production endpoint, device credential issuance, access-control registry, or retention
policy has been configured. The initial receiver uses one shared bearer token; a real
multi-device deployment must move to per-device credentials and explicit authorization
before onboarding external devices.
