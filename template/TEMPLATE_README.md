# Local Digital Towns - Template

A white-label local community platform with marketplace, giveaways, events, business directory, channels, and more. Clone this template and configure it for any town or city.

## What's Included

- **Marketplace** - Buy/sell with Stripe payments, delivery tracking
- **Giveaways & Sweepstakes** - Community engagement with prize management
- **Business Directory** - Local business listings with verification
- **Channels** - Community chat rooms (Neighbors, Events, Lifestyle, etc.)
- **Direct Messages** - User-to-user messaging
- **Business Subscriptions** - Recurring revenue from local businesses
- **Reviews** - Business and product reviews
- **Trust & Verification** - Location-based, resident, and business verification tiers
- **Admin Dashboard** - User management, analytics, application review
- **Live Streaming** - Optional Cloudflare Calls integration

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | 18+ | Runtime |
| **PostgreSQL** | 14+ | Primary database |
| **Redis** | 6+ | Caching and sessions |
| **Stripe Account** | - | Payments (free to create test account) |
| **SMTP Provider** | - | Email delivery (e.g. Resend, SendGrid, AWS SES) |
| **jq** | 1.6+ | Used by setup script (`brew install jq`) |

**Optional:**
- Cloudflare R2 account (file/image storage)
- Facebook/Google OAuth apps (social login)
- Cloudflare Calls (live streaming)
- Backblaze B2 (automated backups)
- Sentry account (error monitoring)

## Quick Start

### 1. Clone and Install

```bash
git clone <this-repo> my-town
cd my-town
npm install
```

### 2. Configure Your Town

The easiest way is to use the interactive setup script:

```bash
./setup-new-town.sh
```

This will prompt you for:
- **Town name** - e.g. "Vero Beach"
- **Slug** - URL-safe identifier, auto-generated (e.g. "vero-beach")
- **Tagline** - e.g. "Your Local Digital Town Square"
- **Domain** - e.g. "digitalverobeach.com"
- **Coordinates** - Latitude and longitude of town center
- **Radius** - Geofence radius in km
- **ZIP code** - Primary zip code
- **County** - e.g. "Indian River County"
- **State** - Two-letter code (e.g. "FL")

The script will:
- Update `config/town-config.json` with your town's entry
- Create a theme file at `public/themes/<slug>.json`
- Print a sample `.env` block
- Print a deployment checklist

**Non-interactive mode** (for CI/scripting):

```bash
TOWN_NAME="Vero Beach" \
TOWN_SLUG="vero-beach" \
TOWN_TAGLINE="Your Local Digital Town Square" \
TOWN_DOMAIN="digitalverobeach.com" \
TOWN_LAT="27.6386" \
TOWN_LNG="-80.3973" \
TOWN_RADIUS_KM="15" \
TOWN_ZIP="32960" \
TOWN_COUNTY="Indian River County" \
TOWN_STATE="FL" \
./setup-new-town.sh
```

### 3. Set Up Environment Variables

```bash
cp .env.template .env
```

Edit `.env` and fill in your values. At minimum you need:
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Generate with `openssl rand -hex 32`
- `JWT_SECRET` - Generate with `openssl rand -hex 32`
- `TOWN_SLUG` - Must match your key in `town-config.json`
- `STRIPE_SECRET_KEY` - From Stripe Dashboard (use test keys for dev)
- `SMTP_HOST/USER/PASS` - For sending login codes

See `.env.template` for the full list with descriptions.

### 4. Create the Database

```bash
createdb digitaltowns   # or your preferred database name
```

### 5. Run Migrations

```bash
npm run db:migrate
```

This creates all tables, indexes, and seed data.

### 6. Start the Server

```bash
# Development
npm run dev

# Production
npm start
```

Visit `http://localhost:3000` to see your town!

### 7. Create Admin User

1. Sign up at `/signup` with the email address listed in your `ADMIN_EMAILS` env var
2. You'll automatically get admin access
3. Visit `/admin` to access the admin dashboard

## Customization

### Branding & Theme

Edit `public/themes/<your-slug>.json` to customize colors:

```json
{
  "modes": {
    "dark": {
      "colors": {
        "bg": "#0e1620",
        "accent": "#4db6c6",
        "accent2": "#7bd4b4"
      }
    },
    "light": {
      "colors": {
        "bg": "#f4f6f8",
        "accent": "#2fa4b9",
        "accent2": "#6cc4a1"
      }
    }
  }
}
```

Key color properties:
- `bg` - Page background
- `panel` - Card/panel background
- `accent` - Primary accent color (buttons, links)
- `accent2` - Secondary accent (highlights)
- `text` - Primary text color
- `muted` - Secondary/subtle text

### Images

Replace these files with your town's assets:
- `public/images/logo.png` - Site logo
- `public/favicon.ico` - Browser tab icon
- `public/images/og-image.png` - Social media preview image
- `public/images/<slug>-main-map.png` - Hero map image
- `public/images/<slug>-ui-map.png` - UI map thumbnail

### Town Configuration

All town-specific text, labels, and settings live in `config/town-config.json`. Key sections:

| Section | What it controls |
|---|---|
| `location` | Map center, geofence radius, bounding box |
| `address` | Default city/state/zip for forms |
| `branding` | Logo URLs, colors, theme file |
| `contact` | Support emails, emergency phone |
| `features` | Toggle marketplace, auctions, giveaways, etc. |
| `payments` | Stripe config, subscription pricing |
| `channels` | Default community channels |
| `verification` | Trust tier labels and messages |
| `pageTitles` | Every page's `<title>` tag |
| `shareText` | Social sharing templates (use `{{itemName}}`, `{{storeName}}` etc.) |
| `emails` | Email subjects and display names |
| `legal` | Jurisdiction and governing law text |

### Disabling Features

Toggle features in `town-config.json`:

```json
"features": {
  "marketplace": true,
  "auctions": false,
  "giveaways": true,
  "sweepstakes": false,
  "liveStreaming": false,
  "channels": true,
  "directMessages": true,
  "businessSubscriptions": true,
  "reviews": true
}
```

## Adding the First Business

1. As admin, go to `/admin`
2. Or have a business owner visit `/apply-business` to submit an application
3. Review applications at `/admin-applications`
4. Approved businesses can set up their storefront at `/store-profile`

## Project Structure

```
config/
  town-config.json    # All town-specific configuration
  towns.js            # Config loader (reads town-config.json)
db/
  migrations/         # PostgreSQL migrations (run in order)
lib/
  trust.js            # Trust tier / permission system
public/
  themes/             # Per-town color themes (JSON)
  *.html              # Frontend pages
  *.js                # Frontend JavaScript
scripts/
  migrate.js          # Migration runner
  smoke.sh            # Smoke test script
server.js             # Express API server
data.js               # Database access layer
setup-new-town.sh     # Town provisioning script
```

## Deployment

### Render (Recommended)

The included `render.yaml` defines a Render Blueprint. To deploy:

1. Push to GitHub
2. Connect repo in Render Dashboard
3. Set environment variables in Render
4. Render will auto-detect `render.yaml` and create services

### Manual / VPS

```bash
NODE_ENV=production npm start
```

Use a process manager like PM2:

```bash
pm2 start server.js --name my-town
```

### Checklist

- [ ] PostgreSQL database created and accessible
- [ ] All required env vars set (see `.env.template`)
- [ ] Migrations run (`npm run db:migrate`)
- [ ] DNS configured for your domain
- [ ] SSL/TLS certificate (Render handles this, or use Let's Encrypt)
- [ ] Stripe webhook endpoint configured (`https://yourdomain.com/api/stripe/webhook`)
- [ ] R2 bucket created for file uploads
- [ ] Admin email(s) set in `ADMIN_EMAILS`
- [ ] Smoke test passed (`./scripts/smoke.sh`)

## Adding More Towns

Run `./setup-new-town.sh` again for each additional town. Each town gets its own entry in `town-config.json` and its own theme file. The server reads `TOWN_SLUG` from the environment to determine which town config to use.

## License

See LICENSE file for details.
