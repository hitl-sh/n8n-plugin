# n8n-nodes-human-in-the-loop

n8n community node for HITL (Human-in-the-Loop) Platform integration.

## Features

- **Create Decision Requests**: Send requests to human experts for decision making
- **Dynamic Loop Selection**: Automatically loads your HITL loops with metadata
- **Multiple Response Types**: Support for text, single/multi-select, rating, number, and boolean responses
- **Real-time Integration**: Seamless integration with your HITL platform
- **Bearer Token Authentication**: Secure API key authentication

## Prerequisites

**Important**: You must download and install the HITL Platform app to receive and respond to decision requests sent from n8n workflows.

- Download the HITL app from [https://hitl.sh](https://hitl.sh)
- Create an account and obtain your API key
- Set up your decision loops in the HITL platform

## Installation

1. Go to Settings > Community Nodes in your n8n instance
2. Select "Install" 
3. Enter `n8n-nodes-human-in-the-loop` in "Enter npm package name"
4. Click "Install"
