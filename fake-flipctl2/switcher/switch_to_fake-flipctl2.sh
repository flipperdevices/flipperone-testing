#!/bin/bash
set -e

sudo systemctl disable fake-flipctl-node-server.service
sudo systemctl stop fake-flipctl-node-server.service
sudo ln -s /flipperone-testing/fake-flipctl2/systemd/fake-flipctl2-node-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable fake-flipctl2-node-server.service
sudo systemctl start fake-flipctl2-node-server.service
sudo systemctl restart cog-seat1.service