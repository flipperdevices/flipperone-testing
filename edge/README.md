# EDGE SYSTEMS: local export and configurable transport

`export_jsonl.py` is a local-only adapter from the repository's existing
`temperature/system_monitor.sh` output (`system_data.csv`) to newline-delimited JSON.
It uses only Python's standard library. It does not open a network connection or upload
anything.

## Run on a board

```bash
./start-tests.sh --temperature --time 1 --interval 1
python3 edge/export_jsonl.py results/test_run_<timestamp>/system_data.csv \
  --output results/test_run_<timestamp>/neural_link.jsonl \
  --device-id tar001-edge-001
```

Or set `NEURAL_LINK_DEVICE_ID` instead of passing `--device-id`. Use a stable, opaque
identifier rather than a personal hostname. Each JSONL row is one sample and contains
`schema`, `device_id`, `source`, `sequence`, `elapsed_s`, and `metrics`; recognized
metrics are temperature (`Cel`), CPU load (`%`), and frequency (`MHz`). `elapsed_s` is
time relative to the beginning of collection, not a wall-clock timestamp.

## Configurable HTTPS transport

`send_jsonl.py` is a separate transport adapter. It validates every sample against
`neural-link.edge.sample.v1` and sends the JSONL batch only when all records are valid.
It requires an absolute HTTPS endpoint and a bearer token supplied through an environment
variable. No endpoint, credential, or server is hard-coded.

```bash
export NEURAL_LINK_ENDPOINT="https://your-receiver.example/v1/edge/samples"
export NEURAL_LINK_TOKEN="your-issued-token"
python3 edge/send_jsonl.py results/test_run_<timestamp>/neural_link.jsonl
```

The sender sets `Content-Type: application/x-ndjson`, uses a SHA-256
`Idempotency-Key` for the exact batch body, applies a configurable timeout, and does not
retry automatically. The token is never printed. Empty files cause no network request.
The receiving service must implement the matching endpoint, validate the bearer token,
and honor the idempotency key if duplicate suppression is required.

Do not use a real endpoint until its owner has supplied the URL, authentication policy,
retention policy, and accepted response contract. This repository does not yet include
or deploy a central receiver.

## Smoke tests without hardware

```bash
python3 -m unittest discover -s tests -v
mkdir -p /tmp/neural-link-edge-demo
printf '# METADATA: {}\\nseconds,temp_soc,load_cpu0,freq_cpu0\\n0,31.5,12,1200\\n' \
  > /tmp/neural-link-edge-demo/system_data.csv
python3 edge/export_jsonl.py /tmp/neural-link-edge-demo/system_data.csv \
  --output /tmp/neural-link-edge-demo/samples.jsonl --device-id demo-board
cat /tmp/neural-link-edge-demo/samples.jsonl
```

The collector and sender use only Python's standard library. The transport adapter is
opt-in and separate from collection, so local-only operation remains the default.
