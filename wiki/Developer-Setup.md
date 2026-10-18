# Developer Setup & Contribution Guide

This guide details instructions for local setup and contributing to **Inbox Bubble Map** (`Bosaj/inbox-bubble-map`).

## Prerequisites

- Node.js 20+ (recommended: Node.js 22 LTS)
- npm 10+
- Modern browser with canvas and SVG animation performance support

## Local Development Setup

```bash
# 1. Clone repository
git clone https://github.com/Bosaj/inbox-bubble-map.git
cd inbox-bubble-map

# 2. Install dependencies
npm install

# 3. Start local development server
npm run dev

# 4. Run tests
npm test

# 5. Build for production
npm run build
```

## Continuous Integration & Quality Checks

- **Linting:** ESLint standard configuration.
- **D3 Force Simulation:** Verified deterministic clustering and simulation decay.
- **Privacy Enforcement:** Zero data transmission outside client memory.
