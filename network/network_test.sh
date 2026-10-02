#!/bin/bash

# Network Monitoring Stress-Test Module for Flipper One (RK3576)
# Usage: ./network_test.sh [interval_seconds] [output_directory]

# Exit safely if the user terminates the script prematurely
trap "echo -e '\nStopping network monitoring...'; exit 0" SIGINT SIGTERM

# 1. Parse Input Arguments with Defaults
INTERVAL=${1:-1}                  # Default to 1-second intervals
RESULTS_DIR=${2:-"results/debug"} # Default output directory if run standalone

# Ensure the results directory exists
mkdir -p "$RESULTS_DIR"
OUTPUT_CSV="$RESULTS_DIR/network_data.csv"

# 2. Write CSV Headers (Ensuring contract compatibility with Pandas)
if [ ! -f "$OUTPUT_CSV" ]; then
    echo "seconds,Timestamp,Latency_ms,Interface_Status" > "$OUTPUT_CSV"
fi

# 3. Detect Active Network Interface
INTERFACE=$(ip -o link show up | awk -F': ' '{print $2}' | grep -v 'lo' | head -n 1)
if [ -z "$INTERFACE" ]; then
    INTERFACE="none"
fi

echo "Starting network telemetry loop on interface: $INTERFACE"
echo "Logging metrics to: $OUTPUT_CSV"

# 4. Telemetry Loop
SECONDS_COUNTER=0

while true; do
    TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

    # Run a defensive 1-packet ping with a strict 1-second timeout
    PING_OUT=$(ping -c 1 -W 1 8.8.8.8 2>/dev/null)
    EXIT_CODE=$?

    if [ $EXIT_CODE -eq 0 ]; then
        # Successfully connected! Extract raw millisecond value
        LATENCY=$(echo "$PING_OUT" | grep 'bytes from' | awk -F'time=' '{print $2}' | cut -d' ' -f1)
        
        # Fallback if text parsing fails unexpectedly
        if [ -z "$LATENCY" ]; then LATENCY="0.00"; fi
        STATUS="${INTERFACE}_online"
    else
        # Host unreachable or interface dropped offline
        LATENCY="0.00"
        STATUS="${INTERFACE}_offline"
    fi

    # 5. Append cleanly formatted row to CSV
    echo "$SECONDS_COUNTER,$TIMESTAMP,$LATENCY,$STATUS" >> "$OUTPUT_CSV"

    # Rest and increment time step
    sleep "$INTERVAL"
    ((SECONDS_COUNTER+=INTERVAL))
done

