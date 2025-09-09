#!/bin/bash

# System monitoring test script - Ultra-lightweight version
# Collects raw data with minimal processing, parses at the end

TEST_DURATION_MINUTES=${1:-60}
RESULTS_DIR=${2:-"results"}
TEST_INTERVAL=${3:-0.5}  # Sampling interval in seconds
CSV_FILE="${RESULTS_DIR}/system_data.csv"
RAW_FILE="${RESULTS_DIR}/system_raw.tmp"

# Calculate total samples based on interval
TOTAL_SAMPLES=$(echo "$TEST_DURATION_MINUTES * 60 / $TEST_INTERVAL" | bc)

echo "System monitoring test (ultra-lightweight)"
echo "Duration: ${TEST_DURATION_MINUTES} minutes"
echo "Interval: ${TEST_INTERVAL} seconds"
echo "Expected samples: ${TOTAL_SAMPLES}"
echo "Monitoring: Temperature, CPU Load, CPU Frequency"
echo ""

# Clear raw file
> "$RAW_FILE"

# Check what's available on first run
echo "Checking available metrics..."

# Check CPU frequency access
FREQ_READABLE=false
if [ -r "/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq" ]; then
    echo "  CPU frequency: Using scaling_cur_freq (OK)"
    FREQ_READABLE=true
elif [ -r "/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_cur_freq" ]; then
    echo "  CPU frequency: Using cpuinfo_cur_freq (OK)"
    FREQ_READABLE=true
else
    echo "  CPU frequency: May need root access"
fi

echo "Collecting data..."

# Test what we can collect on first iteration
if [ ! -f "/tmp/system_test_done" ]; then
    echo "Testing data collection:"
    TEST_FREQ=$(cat /sys/devices/system/cpu/cpu[0-7]/cpufreq/scaling_cur_freq 2>/dev/null | tr '\n' ',')
    if [ -n "$TEST_FREQ" ]; then
        echo "  Frequencies found: $(echo "$TEST_FREQ" | grep -o ',' | wc -l) cores"
    else
        echo "  Frequencies: Unable to read (may need root)"
    fi
    
    TEST_STAT=$(grep "^cpu[0-9]" /proc/stat | wc -l)
    echo "  CPU stats found: $TEST_STAT cores"
    
    touch /tmp/system_test_done
fi

# Main collection loop - just collect raw data, minimal processing
COUNT=0

# Store previous CPU stats for load calculation
PREV_STATS=""

while [ $COUNT -lt $TOTAL_SAMPLES ]; do
    # Collect all data in one go, pipe-separated for easy parsing
    
    # 1. Temperature (using sensors, one line output)
    TEMP_LINE=$(sensors 2>/dev/null | awk '
        /^[a-z].*-virtual-/ { gsub(/-virtual-0/, "", $1); name=$1 }
        /^temp1:/ { gsub(/[+°C]/, "", $2); temps[name] = $2 }
        END { 
            for (t in temps) printf "%s=%s,", t, temps[t]
        }
    ')
    
    # 2. CPU stats from /proc/stat (for load calculation later)
    # Use a single line with | separator for easier parsing
    CPU_STATS=$(grep "^cpu[0-9]" /proc/stat | head -8 | tr '\n' '|')
    
    # 3. CPU frequencies (single cat for all files)
    # Try scaling_cur_freq first (usually readable without root)
    FREQ_LINE=$(cat /sys/devices/system/cpu/cpu[0-7]/cpufreq/scaling_cur_freq 2>/dev/null | tr '\n' ',')
    
    # If that failed, try cpuinfo_cur_freq (might need root)
    if [ -z "$FREQ_LINE" ]; then
        FREQ_LINE=$(cat /sys/devices/system/cpu/cpu[0-7]/cpufreq/cpuinfo_cur_freq 2>/dev/null | tr '\n' ',')
    fi
    
    # Write raw data (3 lines per sample for easy parsing)
    echo "===SAMPLE===" >> "$RAW_FILE"
    echo "$TEMP_LINE" >> "$RAW_FILE"
    echo "$CPU_STATS" >> "$RAW_FILE"
    echo "$FREQ_LINE" >> "$RAW_FILE"
    
    # Debug first sample only
    if [ $COUNT -eq 0 ]; then
        echo "First sample debug:"
        echo "  Temp data: $(echo "$TEMP_LINE" | cut -c1-50)..."
        echo "  CPU stats: $(echo "$CPU_STATS" | wc -c) bytes, $(echo "$CPU_STATS" | grep -o '|' | wc -l) CPUs"
        echo "  Freq data: $(echo "$FREQ_LINE" | cut -c1-50)..."
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
echo "Processing data..."

# Process all data at once after collection is done
python3 - << 'EOF' "$RAW_FILE" "$CSV_FILE" "$TEST_INTERVAL"
import sys
import json

raw_file = sys.argv[1]
csv_file = sys.argv[2]
interval = float(sys.argv[3])

# Read all raw data
with open(raw_file, 'r') as f:
    lines = f.readlines()

# Parse samples
all_data = []
prev_cpu_stats = {}

i = 0
while i < len(lines):
    if lines[i].strip() == '===SAMPLE===':
        sample = {}
        
        # Parse temperature line
        if i + 1 < len(lines):
            temp_line = lines[i + 1].strip()
            if temp_line:
                for pair in temp_line.split(','):
                    if '=' in pair:
                        key, val = pair.split('=', 1)
                        try:
                            sample[f'temp_{key}'] = float(val)
                        except:
                            pass
        
        # Parse CPU stats for load calculation
        if i + 2 < len(lines):
            cpu_lines = lines[i + 2].strip()
            if cpu_lines:
                # Split by | to get individual CPU lines
                for cpu_line in cpu_lines.split('|'):
                    if not cpu_line:
                        continue
                    parts = cpu_line.split()
                    if len(parts) >= 5 and parts[0].startswith('cpu'):
                        cpu_num = parts[0][3:] if len(parts[0]) > 3 else ''
                        if cpu_num.isdigit():
                            # Calculate CPU load from stats
                            try:
                                user = int(parts[1])
                                nice = int(parts[2])
                                system = int(parts[3])
                                idle = int(parts[4])
                                iowait = int(parts[5]) if len(parts) > 5 else 0
                                
                                total = user + nice + system + idle + iowait
                                busy = total - idle - iowait
                                
                                cpu_key = f'cpu{cpu_num}'
                                if cpu_key in prev_cpu_stats:
                                    prev_total, prev_busy = prev_cpu_stats[cpu_key]
                                    delta_total = total - prev_total
                                    delta_busy = busy - prev_busy
                                    
                                    if delta_total > 0:
                                        load = int((delta_busy * 100) / delta_total)
                                        sample[f'load_cpu{cpu_num}'] = min(100, max(0, load))
                                    else:
                                        sample[f'load_cpu{cpu_num}'] = 0
                                else:
                                    sample[f'load_cpu{cpu_num}'] = 0
                                
                                prev_cpu_stats[cpu_key] = (total, busy)
                            except (ValueError, IndexError):
                                pass
        
        # Parse frequency line
        if i + 3 < len(lines):
            freq_line = lines[i + 3].strip()
            if freq_line:
                freqs = freq_line.split(',')
                for cpu_idx, freq in enumerate(freqs[:8]):
                    if freq and freq.isdigit():
                        # Convert kHz to MHz
                        sample[f'freq_cpu{cpu_idx}'] = int(freq) // 1000
        
        if sample:
            all_data.append(sample)
        
        i += 4
    else:
        i += 1

# Get all unique keys
all_keys = set()
for sample in all_data:
    all_keys.update(sample.keys())

# Sort keys by category and number
def sort_key(k):
    parts = k.split('_')
    category = parts[0] if parts else ''
    import re
    match = re.search(r'(\d+)$', k)
    num = int(match.group(1)) if match else 0
    return (category, num)

sorted_keys = sorted(all_keys, key=sort_key)

# Create metadata
metadata = {
    'temperature_sensors': [k for k in sorted_keys if k.startswith('temp_')],
    'cpu_load_cores': [k for k in sorted_keys if k.startswith('load_')],
    'cpu_freq_cores': [k for k in sorted_keys if k.startswith('freq_')]
}

# Write CSV
with open(csv_file, 'w') as f:
    # Write metadata as JSON comment
    f.write(f'# METADATA: {json.dumps(metadata)}\n')
    
    # Header
    f.write('seconds,' + ','.join(sorted_keys) + '\n')
    
    # Data rows
    for i, sample in enumerate(all_data):
        time_seconds = i * interval
        values = [str(sample.get(key, '')) for key in sorted_keys]
        f.write(f'{time_seconds},' + ','.join(values) + '\n')

print(f"Processed {len(all_data)} samples")
print(f"Found metrics:")
if metadata['temperature_sensors']:
    print(f"  Temperature: {len(metadata['temperature_sensors'])} sensors")
if metadata['cpu_load_cores']:
    print(f"  CPU Load: {len(metadata['cpu_load_cores'])} cores")
if metadata['cpu_freq_cores']:
    print(f"  CPU Frequency: {len(metadata['cpu_freq_cores'])} cores")
else:
    print(f"  CPU Frequency: NONE (may need root access)")
EOF

# Clean up
rm -f "$RAW_FILE"
rm -f /tmp/system_monitor_checked
rm -f /tmp/system_test_done

echo "Data collection complete!"
echo "CSV file: $CSV_FILE"