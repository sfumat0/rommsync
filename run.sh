#!/bin/bash

echo "Starting RommSync..."
echo ""

if [ ! -d "venv" ]; then
    echo "ERROR: Virtual environment not found"
    echo "Please run ./install.sh first"
    exit 1
fi

if [ ! -f "config.yaml" ]; then
    echo "ERROR: config.yaml not found"
    echo "Please copy config.example.yaml to config.yaml and configure it"
    exit 1
fi

source venv/bin/activate
python app/main.py
