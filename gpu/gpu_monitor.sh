#!/bin/bash

# GPU monitoring script - separate from system monitoring
# Collects GPU load and frequency data independently

TEST_DURATION_MINUTES=${1:-60}
RESULTS_DIR=${2:-"results"}
TEST_INTERVAL=${3:-0.5}  # Sampling interval in seconds
CSV_FILE="${RESULTS_DIR}/gpu_data.csv"

# Calculate total samples based on interval
TOTAL_SAMPLES=$(echo "$TEST_DURATION_MINUTES * 60 / $TEST_INTERVAL" | bc)

echo "GPU monitoring test"
echo "Duration: ${TEST_DURATION_MINUTES} minutes"
echo "Interval: ${TEST_INTERVAL} seconds"
echo "Expected samples: ${TOTAL_SAMPLES}"
echo ""

# Check if GPU devfreq is available
if [ ! -f "/sys/class/devfreq/27800000.gpu/load" ]; then
    echo "Warning: GPU devfreq not found at /sys/class/devfreq/27800000.gpu/load"
    echo "GPU monitoring may not work properly"
fi

# Main collection loop
COUNT=0

# Create CSV header
echo "seconds,gpu_load,gpu_freq" > "$CSV_FILE"

while [ $COUNT -lt $TOTAL_SAMPLES ]; do
    # Get current time
    TIME_SECONDS=$(echo "$COUNT * $TEST_INTERVAL" | bc)
    
    # Get GPU metrics
    GPU_LINE=$(cat /sys/class/devfreq/27800000.gpu/load 2>/dev/null || echo "")
    
    # Parse GPU data: "15@300000000Hz" -> load=15, freq=300
    if [ -n "$GPU_LINE" ] && echo "$GPU_LINE" | grep -q '@'; then
        GPU_LOAD=$(echo "$GPU_LINE" | cut -d'@' -f1)
        GPU_FREQ_HZ=$(echo "$GPU_LINE" | cut -d'@' -f2 | sed 's/Hz//')
        # Convert Hz to MHz
        GPU_FREQ=$((GPU_FREQ_HZ / 1000000))
    else
        GPU_LOAD=""
        GPU_FREQ=""
    fi
    
    # Write to CSV
    echo "${TIME_SECONDS},${GPU_LOAD},${GPU_FREQ}" >> "$CSV_FILE"
    
    # Debug first sample only
    if [ $COUNT -eq 0 ]; then
        echo "First sample debug:"
        echo "  GPU raw: $GPU_LINE"
        echo "  GPU load: $GPU_LOAD%"
        echo "  GPU freq: $GPU_FREQ MHz"
    fi
    
    COUNT=$((COUNT + 1))
    
    # Simple progress indicator
    if [ $((COUNT % 40)) -eq 0 ]; then
        echo -n "."
    fi
    
    sleep $TEST_INTERVAL
done

echo ""
echo "Collected ${COUNT} samples"
echo "GPU CSV file: $CSV_FILE"