#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config/town-config.json"
THEMES_DIR="$SCRIPT_DIR/public/themes"
FORCE="${FORCE:-false}"

# ── Dependency check ──────────────────────────────────────────
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required. Install with: brew install jq (macOS) or apt-get install jq (Linux)"; exit 1; }

# ── State abbreviation → full name map ────────────────────────
state_full_name() {
  case "$1" in
    AL) echo "Alabama";; AK) echo "Alaska";; AZ) echo "Arizona";; AR) echo "Arkansas";;
    CA) echo "California";; CO) echo "Colorado";; CT) echo "Connecticut";; DE) echo "Delaware";;
    FL) echo "Florida";; GA) echo "Georgia";; HI) echo "Hawaii";; ID) echo "Idaho";;
    IL) echo "Illinois";; IN) echo "Indiana";; IA) echo "Iowa";; KS) echo "Kansas";;
    KY) echo "Kentucky";; LA) echo "Louisiana";; ME) echo "Maine";; MD) echo "Maryland";;
    MA) echo "Massachusetts";; MI) echo "Michigan";; MN) echo "Minnesota";; MS) echo "Mississippi";;
    MO) echo "Missouri";; MT) echo "Montana";; NE) echo "Nebraska";; NV) echo "Nevada";;
    NH) echo "New Hampshire";; NJ) echo "New Jersey";; NM) echo "New Mexico";; NY) echo "New York";;
    NC) echo "North Carolina";; ND) echo "North Dakota";; OH) echo "Ohio";; OK) echo "Oklahoma";;
    OR) echo "Oregon";; PA) echo "Pennsylvania";; RI) echo "Rhode Island";; SC) echo "South Carolina";;
    SD) echo "South Dakota";; TN) echo "Tennessee";; TX) echo "Texas";; UT) echo "Utah";;
    VT) echo "Vermont";; VA) echo "Virginia";; WA) echo "Washington";; WV) echo "West Virginia";;
    WI) echo "Wisconsin";; WY) echo "Wyoming";; DC) echo "District of Columbia";;
    *) echo "$1";;
  esac
}

# ── Phase 1: Input collection ────────────────────────────────
echo "============================================================"
echo "  Setup New Town"
echo "============================================================"
echo ""

prompt() {
  local var_name="$1" label="$2" default="${3:-}"
  local current="${!var_name:-}"
  if [ -n "$current" ]; then
    echo "  $label: $current (from env)"
    return
  fi
  if [ -n "$default" ]; then
    read -rp "  $label [$default]: " val
    val="${val:-$default}"
  else
    read -rp "  $label: " val
  fi
  if [ -z "$val" ]; then
    echo "  ERROR: $label is required." >&2
    exit 1
  fi
  eval "$var_name=\"\$val\""
}

prompt TOWN_NAME "Town name (e.g. Vero Beach)"
DEFAULT_SLUG=$(echo "$TOWN_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/ /-/g' | sed 's/[^a-z0-9-]//g')
prompt TOWN_SLUG "Slug" "$DEFAULT_SLUG"
prompt TOWN_TAGLINE "Tagline" "Your Local Digital Town Square"
prompt TOWN_DOMAIN "Domain (e.g. digitalverobeach.com)"
prompt TOWN_LAT "Latitude (e.g. 27.6386)"
prompt TOWN_LNG "Longitude (e.g. -80.3973)"
prompt TOWN_RADIUS_KM "Geofence radius in km" "15"
prompt TOWN_ZIP "Primary zip code"
prompt TOWN_COUNTY "County (e.g. Indian River County)"
prompt TOWN_STATE "State (2-letter code, e.g. FL)"

TOWN_STATE_FULL=$(state_full_name "$TOWN_STATE")

echo ""
echo "  State full name: $TOWN_STATE_FULL"

# ── Compute derived values ────────────────────────────────────
TOWN_ID=$(jq '[.[].id] | max + 1' "$CONFIG_FILE")
TOWN_RADIUS_METERS=$(awk "BEGIN { printf \"%d\", $TOWN_RADIUS_KM * 1000 }")

# Bounding box: ~111 km per degree latitude, ~111*cos(lat) km per degree longitude
BB_MIN_LAT=$(awk "BEGIN { printf \"%.2f\", $TOWN_LAT - ($TOWN_RADIUS_KM / 111.0) }")
BB_MAX_LAT=$(awk "BEGIN { printf \"%.2f\", $TOWN_LAT + ($TOWN_RADIUS_KM / 111.0) }")
BB_MIN_LNG=$(awk "BEGIN { pi=3.14159265; cos_lat=cos($TOWN_LAT * pi / 180); printf \"%.2f\", $TOWN_LNG - ($TOWN_RADIUS_KM / (111.0 * cos_lat)) }")
BB_MAX_LNG=$(awk "BEGIN { pi=3.14159265; cos_lat=cos($TOWN_LAT * pi / 180); printf \"%.2f\", $TOWN_LNG + ($TOWN_RADIUS_KM / (111.0 * cos_lat)) }")

# County abbreviation: first letters of each word
COUNTY_SHORT=$(echo "$TOWN_COUNTY" | sed 's/ *County$//' | awk '{ for(i=1;i<=NF;i++) printf substr($i,1,1) }' | tr '[:lower:]' '[:upper:]')

FULL_NAME="Digital $TOWN_NAME"

echo "  Town ID: $TOWN_ID"
echo "  Radius: ${TOWN_RADIUS_METERS}m"
echo "  Bounding box: [$BB_MIN_LAT, $BB_MAX_LAT] x [$BB_MIN_LNG, $BB_MAX_LNG]"
echo ""

# ── Phase 2: Update town-config.json ─────────────────────────
if jq -e ".\"$TOWN_SLUG\"" "$CONFIG_FILE" >/dev/null 2>&1; then
  echo "Town '$TOWN_SLUG' already exists in config. Updating..."
else
  echo "Adding new town '$TOWN_SLUG' to config..."
fi

jq --arg slug "$TOWN_SLUG" \
   --arg name "$TOWN_NAME" \
   --arg fullName "$FULL_NAME" \
   --arg tagline "$TOWN_TAGLINE" \
   --arg state "$TOWN_STATE" \
   --arg stateFull "$TOWN_STATE_FULL" \
   --arg domain "$TOWN_DOMAIN" \
   --arg zip "$TOWN_ZIP" \
   --arg county "$TOWN_COUNTY" \
   --arg countyShort "$COUNTY_SHORT" \
   --argjson id "$TOWN_ID" \
   --argjson lat "$TOWN_LAT" \
   --argjson lng "$TOWN_LNG" \
   --argjson radiusMeters "$TOWN_RADIUS_METERS" \
   --argjson bbMinLat "$BB_MIN_LAT" \
   --argjson bbMaxLat "$BB_MAX_LAT" \
   --argjson bbMinLng "$BB_MIN_LNG" \
   --argjson bbMaxLng "$BB_MAX_LNG" \
   '. + { ($slug): {
      "id": $id,
      "slug": $slug,
      "name": $name,
      "fullName": $fullName,
      "tagline": $tagline,
      "state": $state,
      "stateFullName": $stateFull,
      "region": $county,
      "country": "US",
      "timezone": "America/New_York",

      "domains": [$domain, ($slug + ".digitaltowns.com"), "localhost"],
      "productionUrl": ("https://" + $domain),
      "localFallbackUrl": ("https://" + $slug + ".local"),

      "location": {
        "lat": $lat,
        "lng": $lng,
        "zoom": 13,
        "radiusMeters": $radiusMeters,
        "boundingBox": {
          "minLat": $bbMinLat,
          "maxLat": $bbMaxLat,
          "minLng": $bbMinLng,
          "maxLng": $bbMaxLng
        }
      },

      "address": {
        "city": $name,
        "state": $state,
        "zip": $zip,
        "county": $county,
        "countyShort": $countyShort,
        "placeholder": ("123 Main St, " + $name + ", " + $state),
        "streetPlaceholder": ("Street address (e.g. 1234 Main St)")
      },

      "branding": {
        "primaryColor": "#3b82f6",
        "secondaryColor": "#22d3ee",
        "logoUrl": "/images/logo.png",
        "faviconUrl": "/favicon.ico",
        "ogImage": "/images/og-image.png",
        "ogImageAbsolute": ("https://" + $domain + "/og-image.jpg"),
        "mapImage": ("/images/" + $slug + "-ui-map.png"),
        "heroImage": ("/images/" + $slug + "-main-map.png"),
        "themeFile": ($slug + ".json")
      },

      "theme": {
        "accent": "#00ffae",
        "bg": "#070b10",
        "panel": "#0f1722",
        "text": "#e8eef6",
        "muted": "#9fb0c3"
      },

      "contact": {
        "supportEmail": ("support@" + $domain),
        "supportEmailAlt": ("support@" + $domain),
        "noReplyEmail": ("noreply@" + $domain),
        "nonEmergencyPhone": "",
        "nonEmergencyPhoneTel": "",
        "nonEmergencyLabel": ($countyShort + " Sheriff\u0027s Office")
      },

      "legal": {
        "jurisdictionText": ("Any legal action shall be brought in the courts of " + $county + ", " + $stateFull),
        "governingLawText": ("These Terms are governed by the laws of the State of " + $stateFull),
        "contactAddress": ($name + ", " + $stateFull)
      },

      "features": {
        "marketplace": true,
        "auctions": true,
        "giveaways": true,
        "sweepstakes": true,
        "liveStreaming": true,
        "channels": true,
        "directMessages": true,
        "businessSubscriptions": true,
        "reviews": true
      },

      "payments": {
        "currency": "usd",
        "stripeEnabled": true,
        "userSubscriptionPriceCents": 0,
        "businessSubscriptionPriceCents": 1000,
        "trialDays": 30,
        "referralCommissionPercent": 25
      },

      "social": {
        "facebook": null,
        "instagram": null,
        "twitter": null
      },

      "content": {
        "welcomeMessage": ("Welcome to " + $fullName + "!"),
        "aboutUrl": "/about",
        "termsUrl": "/terms",
        "privacyUrl": "/privacy",
        "betaNotice": ("Thank you for being an early adopter! Contact support@" + $domain + " if you need assistance."),
        "comingSoonTitle": ($name + " Digital Town is in private beta."),
        "applyResidentLabel": ("Apply as a " + $name + " Resident"),
        "deleteAccountText": ("To request deletion of your " + $fullName + " account and all associated data, please email us at:")
      },

      "pageTitles": {
        "main": ($name + " Digital Town"),
        "login": ("Login - " + $fullName),
        "subscribe": ("Join " + $fullName),
        "subscribeSuccess": ("Welcome to " + $fullName + "!"),
        "subscription": ("Subscribe - " + $fullName),
        "mySubscription": ("My Subscription - " + $fullName),
        "businessSubscription": ("Business Subscription - " + $fullName),
        "store": ("Storefront \u2022 " + $name + " Digital Town"),
        "sellerOrders": ("Seller Orders \u2013 " + $name),
        "myOrders": ("My Orders \u2013 " + $name),
        "referrals": ("Referral Program - " + $fullName),
        "giveawayOffer": ("Submit Giveaway Offer - " + $fullName),
        "deliveryTracking": ("Delivery Tracking - " + $name + " Express"),
        "deleteAccount": ("Delete Account - " + $name + " " + $stateFull),
        "comingSoon": ($name + " Digital Town \u2014 Private Beta"),
        "admin": ("Admin Metrics \u2013 " + $name),
        "adminMedia": ("Admin Media \u2013 " + $name),
        "adminPulse": ("Daily Pulse Export \u2013 " + $name),
        "adminAnalytics": ("Platform Analytics \u2013 " + $name)
      },

      "meta": {
        "ogTitle": ($name + ", " + $stateFull + " \u2014 Local Community Platform"),
        "ogDescription": "Buy, sell, chat, enter giveaways, discover local businesses. Free to join.",
        "description": ($name + ", " + $stateFull + "\u0027s local community platform. Marketplace, giveaways, events, local business directory. Free to join.")
      },

      "channels": [
        { "name": ($name + " Neighbors & Friends"), "firstPost": "First post: Welcome neighbors! Introduce yourself and your street." },
        { "name": ($name + " Community Chat"), "firstPost": "First post: What\u0027s your favorite local spot this week?" },
        { "name": "Fun Activities & Events", "firstPost": "First post: Share upcoming events and weekend ideas." },
        { "name": ($name + " Lifestyle & Wellness"), "firstPost": "First post: Morning walks, yoga, and wellness tips here." },
        { "name": "Local Meetups & Walking Groups", "firstPost": "First post: Who wants to start a sunrise walk group?" },
        { "name": ($name + " Culture & Memories"), "firstPost": "First post: Post old photos or stories from " + $name + "\u0027s past." },
        { "name": "County Events & Happenings", "firstPost": "First post: County fairs, markets, and regional updates." },
        { "name": "Ladies Social Club", "firstPost": "First post: Ladies\u0027 night ideas and meetups." }
      ],

      "delivery": {
        "serviceName": ($name + " Express"),
        "defaultCity": $name,
        "defaultState": $state,
        "freeDeliveryText": ("Free delivery in " + $name + ".")
      },

      "emails": {
        "loginCodeSubject": ("Your " + $name + " Digital Town login code"),
        "approvalSubject": ("Your " + $name + " Digital Town Application is Approved!"),
        "approvalBody": ("Your {{applicationType}} application for " + $name + " Digital Town has been approved."),
        "deliveryFromName": ($name + " Express"),
        "deliverySubjectPrefix": ($name + " Express - "),
        "deliveryHtmlHeading": ("\ud83d\ude80 " + $name + " Express"),
        "testEmailSubject": ("[" + $name + " Beta] Test Email"),
        "adminDisplayName": $fullName
      },

      "shareText": {
        "purchase": ("Just bought {{itemName}} from {{storeName}} on " + $fullName + "! Support local businesses in " + $name + ", " + $state + "."),
        "giveawayWin": ("I won {{prizeName}} in the " + $name + " Giveaway! Join " + $fullName + " and enter to win amazing local prizes."),
        "sweepstakesWin": ("I won {{prizeName}} in the " + $name + " Sweepstakes! Join " + $fullName + " and enter to win amazing local prizes."),
        "reviewPositive": ("I loved {{storeName}} on " + $fullName + "! Highly recommend checking them out."),
        "reviewNeutral": ("I found {{storeName}} on " + $fullName + "! Support local businesses in " + $name + ", " + $state + "."),
        "newListing": ("Check out my new listing: {{title}} on " + $fullName + "!"),
        "newAuction": ("Check out my new auction: {{title}} on " + $fullName + "! Bidding starts now."),
        "storeShare": ("Check out {{storeName}} on " + $fullName + "! {{description}}"),
        "giveawayOffer": ("I\u0027m giving away \"{{title}}\" on " + $fullName + "! Check out local giveaways and support " + $name + " businesses."),
        "verification": ("I just got verified as a {{tierName}} on " + $fullName + "! Join our local community and support " + $name + " businesses."),
        "purchaseModal": ("Just made a purchase in " + $name + "! \ud83d\udecd\ufe0f"),
        "giveawayWinModal": ("\ud83c\udfc6 I just won in the " + $name + " Town Giveaway!"),
        "reviewModal": ("Just left a review on " + $name + " Digital Town!"),
        "verificationModal": ("You\u0027re officially a verified " + $name + " local! \ud83c\udfe0"),
        "storeListed": ("Get your store listed on " + $fullName)
      },

      "pulse": {
        "titleTemplate": ("Daily Pulse \u2014 " + $name + " \u2014 {{date}}"),
        "facebookIntro": ("\ud83c\udf34 Today in " + $name + ":"),
        "facebookHashtags": ("#" + $name + $state + " #SupportLocal #ShopLocal #" + $fullName)
      },

      "safety": {
        "headerLabel": ($name + ", " + $state + " \u2022 Community Safety"),
        "areaLabel": ($name + " Area \u2022 Last 30 Days"),
        "countyStatText": ($county + " community safety overview"),
        "incidentsLabel": ("View recent incidents in " + $county),
        "marineLabel": ($name + " \u2022 Marine")
      },

      "verification": {
        "locationVerifiedMessage": ("Location verified in " + $name + "."),
        "outsideBoxMessage": ("Not inside " + $name + " verification box."),
        "outsideZoneMessage": ("Not inside " + $name + " verification zone."),
        "locationRequiredMessage": ("Verify location in " + $name + " before submitting Tier 1."),
        "locationRequiredError": ("Location verified in " + $name + " required."),
        "residentLabel": ($name + " Resident+ required to submit prizes."),
        "defaultTierName": ($name + " local"),
        "confirmBusinessLabel": ("I confirm this business is physically located in " + $name + ", " + $state),
        "locatedInLabel": ("Located in " + $name + "?"),
        "yearsInLabel": ("How long in " + $name + "?"),
        "cityMatchValue": ($slug),
        "eligibleZip": $zip,
        "eligibleReason": ("Address matches " + $name + " pilot."),
        "waitlistReason": ("Outside " + $name + "/" + $zip + "; added to waitlist.")
      },

      "localBiz": {
        "directoryTitle": ("Local " + $name + " Businesses"),
        "directoryDescription": ("This is a curated directory of businesses physically located in " + $name + ". Apply below."),
        "serviceProvidersDescription": ("Find trusted service providers in " + $name + "."),
        "storeSetupLabel": ("Set up a new store in " + $name)
      },

      "mobileApp": {
        "appId": ("com." + $slug + ".app"),
        "appName": ($name + " " + $stateFull),
        "namespace": ("com." + $slug + ".app")
      },

      "storage": {
        "r2Bucket": ($slug + "-assets")
      },

      "trustDefaults": {
        "defaultLevel": "visitor"
      }
    }
  }' "$CONFIG_FILE" > "${CONFIG_FILE}.tmp" && mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"

echo "  Updated: $CONFIG_FILE"

# ── Phase 3: Create theme file ────────────────────────────────
THEME_FILE="$THEMES_DIR/${TOWN_SLUG}.json"

if [ -f "$THEME_FILE" ] && [ "$FORCE" != "true" ]; then
  echo "  Theme file already exists: $THEME_FILE (set FORCE=true to overwrite)"
else
  cat > "$THEME_FILE" << THEME_EOF
{
  "name": "$TOWN_NAME",
  "defaultMode": "light",
  "fonts": {
    "display": "Sora",
    "body": "Inter"
  },
  "ui": {
    "radius": {
      "sm": "6px",
      "md": "12px",
      "lg": "18px",
      "pill": "999px"
    },
    "shadow": {
      "sm": "0 2px 6px rgba(0,0,0,.08)",
      "md": "0 6px 18px rgba(0,0,0,.12)",
      "lg": "0 14px 40px rgba(0,0,0,.16)"
    },
    "borderWidth": "1px",
    "blurStrength": "6px"
  },
  "background": {
    "style": "gradient",
    "heroImageUrl": "/images/${TOWN_SLUG}-main-map.png"
  },
  "modes": {
    "dark": {
      "colors": {
        "bg": "#0e1620",
        "panel": "#141f2b",
        "panel2": "#0f1924",
        "text": "#e6eef6",
        "muted": "#9aa6b2",
        "accent": "#4db6c6",
        "accent2": "#7bd4b4",
        "highlight": "#f2a86d",
        "border": "rgba(255,255,255,.12)",
        "card": "rgba(20,31,43,.92)",
        "sidebar": "#101a24",
        "rail": "#0f1924"
      }
    },
    "light": {
      "colors": {
        "bg": "#f4f6f8",
        "panel": "#ffffff",
        "panel2": "#f0f3f6",
        "text": "#1f2933",
        "muted": "#6b7280",
        "accent": "#2fa4b9",
        "accent2": "#6cc4a1",
        "highlight": "#f5b97a",
        "border": "rgba(0,0,0,.08)",
        "card": "rgba(255,255,255,.94)",
        "sidebar": "#ffffff",
        "rail": "#f6f8fa"
      }
    }
  }
}
THEME_EOF
  echo "  Created: $THEME_FILE"
fi

# ── Phase 4: Print .env block ────────────────────────────────
echo ""
echo "============================================================"
echo "  .env block for ${TOWN_NAME} (${TOWN_SLUG})"
echo "============================================================"
cat << ENV_EOF
# Paste these into your .env or deployment environment:

TOWN_ID=${TOWN_ID}
TOWN_SLUG=${TOWN_SLUG}
TOWN_NAME=${TOWN_NAME}
PUBLIC_BASE_URL=https://${TOWN_DOMAIN}

# R2 storage bucket for this town
R2_BUCKET=${TOWN_SLUG}-assets

# Admin emails (comma-separated)
ADMIN_EMAILS=admin@${TOWN_DOMAIN}

# Email sender
EMAIL_FROM=noreply@${TOWN_DOMAIN}
ENV_EOF

# ── Phase 5: Deployment checklist ─────────────────────────────
echo ""
echo "============================================================"
echo "  Deployment Checklist for ${TOWN_NAME}"
echo "============================================================"
cat << CHECK_EOF
[ ] 1. Review config/town-config.json entry for '${TOWN_SLUG}'
[ ] 2. Customize public/themes/${TOWN_SLUG}.json colors
[ ] 3. Add hero image at public/images/${TOWN_SLUG}-main-map.png
[ ] 4. Add logo at public/images/${TOWN_SLUG}-logo.png
[ ] 5. Configure DNS for ${TOWN_DOMAIN}
[ ] 6. Set environment variables (see .env block above)
[ ] 7. Create Stripe products/prices for the new town
[ ] 8. Create R2 bucket: ${TOWN_SLUG}-assets
[ ] 9. Run database migrations: npm run db:migrate
[ ] 10. Test with: TOWN_SLUG=${TOWN_SLUG} npm run dev
[ ] 11. Deploy and verify health check
CHECK_EOF

echo ""
echo "Done! Town '${TOWN_NAME}' (${TOWN_SLUG}) has been set up."
