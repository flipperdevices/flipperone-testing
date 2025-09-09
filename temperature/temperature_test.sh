#!/bin/bash

# Temperature monitoring test script - Minimal CPU usage version
# Collects raw sensor data during test, processes at the end

TEST_DURATION_MINUTES=${1:-60}
RESULTS_DIR=${2:-"results"}
TEST_INTERVAL=${3:-0.5}  # Sampling interval in seconds
CSV_FILE="${RESULTS_DIR}/temperature_data.csv"
RAW_FILE="${RESULTS_DIR}/temperature_raw.tmp"

# Calculate total samples based on interval
TOTAL_SAMPLES=$(echo "$TEST_DURATION_MINUTES * 60 / $TEST_INTERVAL" | bc)

echo "Temperature monitoring test (sensors method)"
echo "Duration: ${TEST_DURATION_MINUTES} minutes"
echo "Interval: ${TEST_INTERVAL} seconds"
echo "Expected samples: ${TOTAL_SAMPLES}"
echo ""

# Clear raw file
> "$RAW_FILE"

echo "Collecting data..."

# Main collection loop - collect stripped data
COUNT=0
while [ $COUNT -lt $TOTAL_SAMPLES ]; do
    # Parse sensors output and save as single line: npu=36.1,little=37.0,soc=33.3,...
    sensors 2>/dev/null | awk '
        /^[a-z].*-virtual-/ { 
            gsub(/-virtual-0/, "", $1)
            gsub(/_thermal/, "", $1)
            name=$1 
        }
        /^temp1:/ { 
            gsub(/[+°C]/, "", $2)
            if (output) output = output ","
            output = output name "=" $2
        }
        END { 
            if (output) print output
        }
    ' >> "$RAW_FILE"
    
    COUNT=$((COUNT + 1))
    
    # Simple progress indicator
    if [ $((COUNT % 40)) -eq 0 ]; then
        echo -n "."
    fi
    
    sleep $TEST_INTERVAL
done

echo ""
echo "Collected ${COUNT} samples"
echo "Processing data..."

# Now process all data at once after collection is done
python3 - << 'EOF' "$RAW_FILE" "$CSV_FILE" "$TEST_INTERVAL"
import sys

raw_file = sys.argv[1]
csv_file = sys.argv[2]
interval = float(sys.argv[3])

# Read all raw data
with open(raw_file, 'r') as f:
    lines = f.readlines()

# Parse each line (format: npu=36.1,little=37.0,soc=33.3,...)
results = []
sensor_names = []
first_sample = True

for line in lines:
    line = line.strip()
    if not line:
        continue
    
    # Parse the key=value pairs
    temps = {}
    for pair in line.split(','):
        if '=' in pair:
            name, value = pair.split('=', 1)
            try:
                temps[name] = float(value)
                if first_sample and name not in sensor_names:
                    sensor_names.append(name)
            except ValueError:
                pass
    
    if temps:
        results.append(temps)
        first_sample = False

# Write CSV
with open(csv_file, 'w') as f:
    # Header
    f.write('seconds,' + ','.join(sensor_names) + '\n')
    
    # Data rows - add time based on interval
    for i, temps in enumerate(results):
        time_seconds = i * interval
        values = [str(temps.get(name, '')) for name in sensor_names]
        f.write(f'{time_seconds},' + ','.join(values) + '\n')

print(f"Processed {len(results)} samples")
EOF

# Clean up
rm -f "$RAW_FILE"

echo "Data collection complete!"
echo "CSV file: $CSV_FILE"