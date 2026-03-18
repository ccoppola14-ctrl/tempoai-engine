# TempoAi Engine

Backend AI engine for restaurant revenue optimization. Connects to POS systems, ingests weather/time signals, and uses pattern analysis to generate actionable recommendations.

## Quick Start

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Create the database and run migrations
npx prisma migrate dev --name init

# Seed with 90 days of demo data (2 locations, 50+ menu items)
npx prisma db seed

# Start the server
npm run dev
```

The server runs on `http://localhost:3001` by default.

## Demo Mode

Set `DEMO_MODE=true` in `.env` (default) to use seed data without requiring a real Square connection. The AI engine runs real analysis on the seeded data.

After seeding, trigger AI analysis:

```bash
curl -X POST http://localhost:3001/api/analyze
```

Then view recommendations:

```bash
curl http://localhost:3001/api/recommendations
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/auth/square/connect` | Initiate Square OAuth |
| GET | `/api/auth/square/callback` | Square OAuth callback |
| GET | `/api/locations` | List all locations |
| GET | `/api/locations/:id` | Location detail + current weather |
| GET | `/api/locations/:id/orders` | Recent orders (paginated) |
| GET | `/api/locations/:id/menu` | Menu items with AI patterns |
| GET | `/api/locations/:id/weather` | Current + recent weather |
| GET | `/api/recommendations` | All active recommendations |
| GET | `/api/recommendations/:locationId` | Recommendations for a location |
| POST | `/api/recommendations/:id/apply` | Mark recommendation as applied |
| GET | `/api/insights` | All discovered patterns |
| GET | `/api/analytics/revenue` | Revenue data with daily breakdown |
| GET | `/api/analytics/items` | Item performance analytics |
| POST | `/api/sync/trigger` | Manually trigger POS data sync |
| POST | `/api/analyze` | Trigger AI pattern analysis |

## Architecture

```
src/
├── index.ts              # Express server entry
├── api/
│   ├── routes.ts         # All API routes
│   └── middleware.ts      # Logging, error handling, auth
├── integrations/
│   ├── square/           # Square POS integration (OAuth, catalog, orders)
│   └── weather/          # Open-Meteo weather integration
├── ai/
│   ├── engine.ts         # Main analysis orchestrator
│   ├── patterns.ts       # Pattern detection algorithms
│   ├── recommendations.ts # Recommendation generation
│   └── types.ts          # Shared AI types
├── db/
│   └── client.ts         # Prisma client
└── utils/
    ├── dayparts.ts       # Time-of-day helpers
    └── logger.ts         # Structured logging
```

## AI Pattern Detection

The engine detects these pattern types:

- **Temperature correlation**: Sales changes when temp crosses thresholds
- **Weather conditions**: Impact of rain, snow, thunderstorms on item sales
- **Daypart patterns**: Breakfast/lunch/dinner sales spikes
- **Day-of-week**: Weekly sales cycles
- **Trend detection**: Items gaining or losing popularity over 30 days
- **Combo patterns**: Items frequently ordered together

## Environment Variables

See `.env.example` for all configuration options.
