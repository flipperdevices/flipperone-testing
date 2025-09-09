#!/bin/bash

# Script to regenerate HTML report from existing test data
# Usage: ./regenerate_report.sh [test_folder]

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the test folder path
if [ -z "$1" ]; then
    # If no argument provided, find the most recent test folder
    echo -e "${YELLOW}No test folder specified. Looking for most recent test...${NC}"
    TEST_DIR=$(ls -dt results/test_run_* 2>/dev/null | head -1)
    
    if [ -z "$TEST_DIR" ]; then
        echo -e "${RED}Error: No test folders found in results/ directory${NC}"
        echo "Usage: $0 [test_folder_path]"
        echo "Example: $0 results/test_run_20250907_124446"
        exit 1
    fi
    echo -e "${GREEN}Using most recent test: $TEST_DIR${NC}"
else
    TEST_DIR="$1"
fi

# Check if the directory exists
if [ ! -d "$TEST_DIR" ]; then
    echo -e "${RED}Error: Directory '$TEST_DIR' does not exist${NC}"
    exit 1
fi

# Check if system_info.txt exists (required for report generation)
if [ ! -f "$TEST_DIR/system_info.txt" ]; then
    echo -e "${RED}Error: system_info.txt not found in '$TEST_DIR'${NC}"
    echo "This doesn't appear to be a valid test results directory"
    exit 1
fi

echo -e "${YELLOW}Regenerating report for: $TEST_DIR${NC}"

# Run the report generator
python3 common/generate_combined_report.py "$TEST_DIR"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Report regenerated successfully!${NC}"
    echo -e "${GREEN}Report location: $TEST_DIR/report.html${NC}"
    
    # Optionally open the report in browser if xdg-open is available
    if command -v xdg-open &> /dev/null; then
        echo -e "${YELLOW}Opening report in browser...${NC}"
        xdg-open "$TEST_DIR/report.html" 2>/dev/null &
    fi
else
    echo -e "${RED}✗ Failed to regenerate report${NC}"
    exit 1
fi