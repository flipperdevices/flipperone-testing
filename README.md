# Flipper One testing scripts

Dirty vibe-coded tests scripts for Flipper One.
To be completely rewrited.

## Features

- **Temperature Monitoring**: Continuous temperature monitoring with interactive HTML reports
- **System Information Logging**: Board model, kernel version, thermal governors
- **Modular Design**: Separate modules for each test type
- **Interactive Reports**: Zoomable graphs using Plotly
- **Lightweight Tests**: Designed for minimal power consumption during testing

## Prerequisites

```bash
# Install required packages
sudo apt-get update
sudo apt-get install -y lm-sensors python3 python3-pip bc

# Install Python dependencies
pip3 install pandas plotly
```

## Usage

### Basic Usage

```bash
# Run all tests (default 60 minutes)
./start-tests.sh

# Run specific test
./start-tests.sh --temperature

# Set custom duration (in minutes)
./start-tests.sh --temperature --time 120

# View help
./start-tests.sh --help
```

### Available Options

- `--all` - Run all tests (default)
- `--temperature` - Run temperature monitoring test
- `--power` - Run power consumption test (placeholder)
- `--cpu` - Run CPU performance test (placeholder)
- `--gpu` - Run GPU performance test (placeholder)
- `--network` - Run network performance test (placeholder)
- `--disk` - Run disk I/O test (placeholder)
- `--time MIN` - Set test duration in minutes (default: 60)

## Test Modules

### Temperature Monitoring (Implemented)
- Collects temperature data every 0.5 seconds
- Supports both `sensors` command and direct thermal zone reading
- Generates interactive HTML report with:
  - Zoomable temperature graphs
  - Statistics (min, max, average, std deviation)
  - Time range selection
  - Multiple sensor support

### Other Modules (Placeholders)
- **Power**: Future power consumption monitoring
- **CPU**: Future CPU benchmark tests
- **GPU**: Future GPU performance tests
- **Network**: Future network throughput tests
- **Disk**: Future disk I/O benchmarks

## Output Structure

```
results/
└── test_run_YYYYMMDD_HHMMSS/
    ├── system_info.txt          # System information and configuration
    ├── temperature_data.csv      # Raw temperature data
    └── temperature_report.html   # Interactive temperature report
```

## System Information Logged

- Board model from `/proc/device-tree/model`
- Hostname and kernel version
- Linux distribution (via `lsb_release`)
- Thermal governor policies
- CPU information
- Memory information

## Temperature Report Features

The generated HTML report includes:
- Interactive graph with zoom and pan capabilities
- Time range selector (1m, 5m, 30m, 1h, All)
- Hover tooltips with precise values
- Temperature statistics table
- Professional styling with responsive design

## Development Status

✅ **Implemented:**
- Main test orchestration script
- Temperature monitoring module
- HTML report generation with Plotly
- System information logging

🚧 **Planned:**
- Power consumption monitoring
- CPU stress tests and benchmarks
- GPU performance tests
- Network throughput tests
- Disk I/O benchmarks
- NPU performance tests

## License

This test suite is provided as-is for testing RK3576-based boards.
