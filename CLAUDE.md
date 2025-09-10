# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an n8n community node package for HITL (Human-in-the-Loop) Platform integration. It allows n8n workflows to send decision requests to human experts and receive responses through webhook callbacks or polling.

**Package**: `n8n-nodes-human-in-the-loop`  
**Platform**: HITL Platform (https://hitl.sh)  
**Documentation**: https://docs.hitl.sh/api

## Core Architecture

The project consists of two main components:

### 1. Credentials (`credentials/HitlCredentialsApi.credentials.ts`)
- Handles HITL API authentication using Bearer tokens
- Configurable base URL (defaults to ngrok tunnel for development)
- Includes credential testing endpoint at `/v1/test`

### 2. Node Implementation (`nodes/HitlNode/HitlNode.node.ts`)
- **Two operation modes**:
  - `send`: Create request and return immediately
  - `sendAndWait`: Create request and wait for human response via webhook
- **Response types supported**: text, single_select, multi_select, rating, number, boolean
- **Processing types**: deferred (standard) or time-sensitive (with timeout)
- **Content types**: text/markdown or image (with URL)
- **Priority levels**: low, medium, high, critical

### Key Implementation Details

#### Webhook Pattern
- Uses n8n's built-in webhook system with `putExecutionToWait()` 
- Webhook endpoint: `/webhook-waiting/{executionId}`
- Hardcoded webhook base URL in code: `https://833ae1ffe9df.ngrok-free.app`
- Execution resumes when webhook receives response

#### Response Configuration
- Dynamic response options loaded from HITL platform via `/v1/api/loops` endpoint
- Complex response validation and formatting for different types
- Default response handling with fallback logic
- Single/multi-select options converted to `{value, label}` format

#### Error Handling
- Enhanced error reporting with API response details
- Graceful degradation with `continueOnFail()` support
- Comprehensive input validation for all response types

## Development Commands

```bash
# Build the project (TypeScript compilation + copy icons)
npm run build

# Development mode with watch
npm run dev

# Linting
npm run lint
npm run lintfix

# Code formatting
npm run format

# Pre-publish checks
npm run prepublishOnly
```

## Build System

- **TypeScript**: Compiles to `dist/` directory
- **Gulp**: Copies SVG/PNG icons from `nodes/` and `credentials/` to `dist/`
- **ESLint**: Uses n8n-nodes-base plugin for validation
- **Target**: ES2019 with CommonJS modules

## File Structure

```
credentials/
  HitlCredentialsApi.credentials.ts    # API authentication
nodes/
  HitlNode/
    HitlNode.node.ts                   # Main node implementation  
    Hitl.node.json                     # Node metadata
    hitl.svg                           # Node icon
dist/                                  # Compiled output
```

## Important Development Notes

### Hardcoded URLs
The codebase contains development ngrok URLs that need to be updated for production:
- Webhook base URL: `nodes/HitlNode/HitlNode.node.ts:503`
- Default API base URL: `credentials/HitlCredentialsApi.credentials.ts:28`

### Response Type Handling
When working with response types, note the complex validation logic in `HitlNode.node.ts:320-483`. Each response type has specific formatting requirements and the code handles conversion between user input and API format.

### N8N Integration
- Uses n8n workflow v1 API (`n8nNodesApiVersion: 1`)
- Implements `ILoadOptionsFunctions` for dynamic loop loading
- Uses `IWebhookFunctions` for response handling
- Follows n8n community node standards with eslint-plugin-n8n-nodes-base