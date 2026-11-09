# EDGE SYSTEMS: first local export

`export_jsonl.py` is a deliberately local-only adapter from the repository's existing
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

## Smoke test without hardware

```bash
python3 -m unittest discover -s tests -v
mkdir -p /tmp/neural-link-edge-demo
printf '# METADATA: {}\nseconds,temp_soc,load_cpu0,freq_cpu0\n0,31.5,12,1200\n' \
  > /tmp/neural-link-edge-demo/system_data.csv
python3 edge/export_jsonl.py /tmp/neural-link-edge-demo/system_data.csv \
  --output /tmp/neural-link-edge-demo/samples.jsonl --device-id demo-board
cat /tmp/neural-link-edge-demo/samples.jsonl
```

This is the transport-neutral edge boundary. Once NEURAL LINK defines its endpoint,
authentication and retention policy, a separate sender can consume these JSONL records;
those details are intentionally not guessed or embedded in this collector.
