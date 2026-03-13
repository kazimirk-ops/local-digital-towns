/**
 * Seed genesis map from all 3 production DBs — TC, PP, Sebastian.
 * Extracts all location data into staging location_signals + zip_clusters.
 *
 * Usage: node scripts/seed-genesis-from-all-dbs.js
 */

var { Pool } = require("pg");

var TC_DB = "postgresql://treasurecoast_db_user:vmVk1CAwP3s7lyx75xJIntAwvLZArYdP@dpg-d6ci47rh46gs73ci149g-a.oregon-postgres.render.com/treasurecoast_db";
var PP_DB = "postgresql://database_rytasplantpurges:9pFKWpIKTTs7iEO9hfXDUOKkZw2P4O2O@dpg-d6htr094tr6s73c1ecdg-a.oregon-postgres.render.com/plantpurges_db_a7ss";
var SB_DB = "postgresql://sebastian_prod_db_user:iw0LJM7QzOuUbTTXp5kpg8qIalatKPZD@dpg-d5n9tcfgi27c73fio2kg-a.oregon-postgres.render.com/sebastian_prod_db";
var STAGING_DB = "postgresql://sebastian_staging_db_user:nFCj74h74KboJvsWGxArPpVifpc530Yy@dpg-d5n9sa75r7bs73dkv97g-a.oregon-postgres.render.com/sebastian_staging_db";

var stats = { tc: 0, pp: 0, sb: 0 };

async function main() {
  var tc = new Pool({ connectionString: TC_DB, ssl: { rejectUnauthorized: false } });
  var pp = new Pool({ connectionString: PP_DB, ssl: { rejectUnauthorized: false } });
  var sb = new Pool({ connectionString: SB_DB, ssl: { rejectUnauthorized: false } });
  var staging = new Pool({ connectionString: STAGING_DB, ssl: { rejectUnauthorized: false } });

  console.log("Connecting to all databases...");

  // ── Collect signals from all sources ──
  var signals = [];

  // ── TC: users with location ──
  console.log("\n── Extracting from TC ──");
  try {
    var tcUsers = await tc.query(
      "SELECT id, email, location_city, location_state, location_zip " +
      "FROM users WHERE location_zip IS NOT NULL AND location_zip != '' LIMIT 5000"
    );
    console.log("  TC users with location: " + tcUsers.rows.length);
    for (var r of tcUsers.rows) {
      signals.push({
        zip: (r.location_zip || "").trim(),
        city: (r.location_city || "").trim(),
        state: (r.location_state || "").trim(),
        platform_slug: "treasurecoast",
        buyer_email: r.email || null
      });
    }
  } catch (e) { console.error("  TC users error:", e.message); }

  // ── TC: BST groups (city only, no zip) ──
  try {
    var tcGroups = await tc.query(
      "SELECT DISTINCT city FROM bst_groups WHERE city IS NOT NULL AND city != ''"
    );
    console.log("  TC BST group cities: " + tcGroups.rows.length);
    for (var r of tcGroups.rows) {
      signals.push({
        zip: "",
        city: (r.city || "").trim(),
        state: "FL",
        platform_slug: "treasurecoast",
        buyer_email: null
      });
    }
  } catch (e) { console.error("  TC bst_groups error:", e.message); }

  // ── TC: orders with shipping_address (JSONB) ──
  try {
    var tcOrders = await tc.query(
      "SELECT DISTINCT shipping_address, buyer_email FROM orders " +
      "WHERE shipping_address IS NOT NULL AND shipping_address::text != '{}' AND shipping_address::text != '' LIMIT 5000"
    );
    console.log("  TC orders with shipping: " + tcOrders.rows.length);
    for (var r of tcOrders.rows) {
      var addr = r.shipping_address;
      if (typeof addr === "string") { try { addr = JSON.parse(addr); } catch(e) { continue; } }
      if (!addr || typeof addr !== "object") continue;
      var zip = (addr.zip || addr.postal_code || addr.zipCode || "").toString().trim();
      if (!zip) continue;
      signals.push({
        zip: zip,
        city: (addr.city || "").toString().trim(),
        state: (addr.state || "").toString().trim(),
        platform_slug: "treasurecoast",
        buyer_email: r.buyer_email || null
      });
    }
  } catch (e) { console.error("  TC orders error:", e.message); }

  stats.tc = signals.length;
  console.log("  TC total signals: " + stats.tc);

  // ── PP: buyer_profiles ──
  console.log("\n── Extracting from PP ──");
  var ppStart = signals.length;
  try {
    var ppBuyers = await pp.query(
      "SELECT DISTINCT default_shipping_city AS city, default_shipping_state AS state, " +
      "default_shipping_zip AS zip, email " +
      "FROM buyer_profiles WHERE default_shipping_zip IS NOT NULL AND default_shipping_zip != ''"
    );
    console.log("  PP buyer_profiles with shipping: " + ppBuyers.rows.length);
    for (var r of ppBuyers.rows) {
      signals.push({
        zip: (r.zip || "").trim(),
        city: (r.city || "").trim(),
        state: (r.state || "").trim(),
        platform_slug: "plant-purge",
        buyer_email: r.email || null
      });
    }
  } catch (e) { console.error("  PP buyer_profiles error:", e.message); }

  // ── PP: invoices ──
  try {
    var ppInvoices = await pp.query(
      "SELECT DISTINCT ship_to_city AS city, ship_to_state AS state, " +
      "ship_to_zip AS zip, buyer_email " +
      "FROM invoices WHERE ship_to_zip IS NOT NULL AND ship_to_zip != ''"
    );
    console.log("  PP invoices with shipping: " + ppInvoices.rows.length);
    for (var r of ppInvoices.rows) {
      signals.push({
        zip: (r.zip || "").trim(),
        city: (r.city || "").trim(),
        state: (r.state || "").trim(),
        platform_slug: "plant-purge",
        buyer_email: r.buyer_email || null
      });
    }
  } catch (e) { console.error("  PP invoices error:", e.message); }

  // ── PP: users with location ──
  try {
    var ppUsers = await pp.query(
      "SELECT email, location_city, location_state, ship_from_city, ship_from_state, ship_from_zip " +
      "FROM users WHERE (ship_from_zip IS NOT NULL AND ship_from_zip != '') " +
      "OR (location_city IS NOT NULL AND location_city != '')"
    );
    console.log("  PP users with location: " + ppUsers.rows.length);
    for (var r of ppUsers.rows) {
      var zip = (r.ship_from_zip || "").trim();
      var city = (r.ship_from_city || r.location_city || "").trim();
      var state = (r.ship_from_state || r.location_state || "").trim();
      if (zip || city) {
        signals.push({
          zip: zip,
          city: city,
          state: state,
          platform_slug: "plant-purge",
          buyer_email: r.email || null
        });
      }
    }
  } catch (e) { console.error("  PP users error:", e.message); }

  stats.pp = signals.length - ppStart;
  console.log("  PP total signals: " + stats.pp);

  // ── SB: users with location ──
  console.log("\n── Extracting from SB ──");
  var sbStart = signals.length;
  try {
    var sbUsers = await sb.query(
      "SELECT email, ship_from_city, ship_from_state, ship_from_zip " +
      "FROM users WHERE ship_from_zip IS NOT NULL AND ship_from_zip != ''"
    );
    console.log("  SB users with ship_from: " + sbUsers.rows.length);
    for (var r of sbUsers.rows) {
      signals.push({
        zip: (r.ship_from_zip || "").trim(),
        city: (r.ship_from_city || "").trim(),
        state: (r.ship_from_state || "").trim(),
        platform_slug: "sebastian",
        buyer_email: r.email || null
      });
    }
  } catch (e) { console.error("  SB users error:", e.message); }

  // ── SB: resident_verification_requests ──
  try {
    var sbResident = await sb.query(
      "SELECT DISTINCT city, state, zip FROM resident_verification_requests " +
      "WHERE zip IS NOT NULL AND zip != ''"
    );
    console.log("  SB resident verifications: " + sbResident.rows.length);
    for (var r of sbResident.rows) {
      signals.push({
        zip: (r.zip || "").trim(),
        city: (r.city || "").trim(),
        state: (r.state || "").trim(),
        platform_slug: "sebastian",
        buyer_email: null
      });
    }
  } catch (e) { console.error("  SB resident_verification error:", e.message); }

  stats.sb = signals.length - sbStart;
  console.log("  SB total signals: " + stats.sb);

  // ── Close source DBs ──
  await tc.end();
  await pp.end();
  await sb.end();

  console.log("\n══════════════════════════════════════");
  console.log("Total raw signals collected: " + signals.length);
  console.log("  TC: " + stats.tc + "  PP: " + stats.pp + "  SB: " + stats.sb);
  console.log("══════════════════════════════════════");

  // ── Filter: skip signals without a valid zip ──
  var withZip = signals.filter(function(s) { return s.zip && s.zip.length >= 3; });
  console.log("Signals with valid ZIP: " + withZip.length);

  // ── Insert into staging location_signals ──
  console.log("\nInserting location_signals into staging...");
  var inserted = 0;
  var batchSize = 100;
  for (var i = 0; i < withZip.length; i += batchSize) {
    var batch = withZip.slice(i, i + batchSize);
    var values = [];
    var params = [];
    var idx = 1;
    for (var s of batch) {
      values.push("($" + idx++ + ",$" + idx++ + ",$" + idx++ + ",$" + idx++ + ",$" + idx++ + ",NOW())");
      params.push(s.zip, s.city, s.state, s.platform_slug, s.buyer_email);
    }
    try {
      await staging.query(
        "INSERT INTO location_signals (zip, city, state, platform_slug, buyer_email, created_at) VALUES " +
        values.join(","),
        params
      );
      inserted += batch.length;
    } catch (e) {
      console.error("  Insert batch error at row " + i + ":", e.message);
    }
  }
  console.log("  Inserted: " + inserted + " location_signals");

  // ── Upsert zip_clusters ──
  console.log("\nUpserting zip_clusters...");
  // Aggregate signals by zip
  var zipMap = {};
  for (var s of withZip) {
    if (!zipMap[s.zip]) {
      zipMap[s.zip] = { zip: s.zip, city: s.city, state: s.state, count: 0, emails: new Set() };
    }
    zipMap[s.zip].count++;
    if (s.buyer_email) zipMap[s.zip].emails.add(s.buyer_email.toLowerCase());
    // Use the most common city/state (prefer non-empty)
    if (!zipMap[s.zip].city && s.city) zipMap[s.zip].city = s.city;
    if (!zipMap[s.zip].state && s.state) zipMap[s.zip].state = s.state;
  }

  var zips = Object.values(zipMap);
  var upserted = 0;
  for (var z of zips) {
    try {
      await staging.query(
        "INSERT INTO zip_clusters (zip, city, state, signal_count, unique_buyers, last_signal_at, updated_at) " +
        "VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) " +
        "ON CONFLICT (zip) DO UPDATE SET " +
        "signal_count = zip_clusters.signal_count + $4, " +
        "unique_buyers = zip_clusters.unique_buyers + $5, " +
        "city = COALESCE(NULLIF(zip_clusters.city, ''), $2), " +
        "state = COALESCE(NULLIF(zip_clusters.state, ''), $3), " +
        "last_signal_at = NOW(), updated_at = NOW()",
        [z.zip, z.city, z.state, z.count, z.emails.size]
      );
      upserted++;
    } catch (e) {
      console.error("  Upsert zip_clusters error for " + z.zip + ":", e.message);
    }
  }
  console.log("  Upserted: " + upserted + " zip_clusters");

  // ── Geocode ZIP clusters (known US ZIP centroids) ──
  console.log("\nGeocoding zip_clusters...");
  var ZIP_COORDS = {
    "32958": [27.8164, -80.4706], "67220": [37.7625, -97.2545], "19149": [40.0504, -75.0254],
    "27609": [35.8127, -78.6323], "28677": [35.7826, -80.8873], "32738": [28.9005, -81.2137],
    "35759": [34.8603, -86.5672], "39563": [30.4116, -88.5345], "44107": [41.4842, -81.7982],
    "60803": [41.6689, -87.7384], "70706": [30.4866, -90.9568], "11433": [40.6981, -73.7868],
    "13145": [43.6481, -76.0782], "78602": [30.1105, -97.3150], "97352": [44.7182, -123.0040],
    "19015": [39.8684, -75.3840], "29720": [34.7204, -80.7712], "01535": [42.2159, -72.0828],
    "60088": [42.3253, -87.8412], "72715": [36.4806, -94.2713], "93230": [36.3275, -119.6457],
    "76182": [32.8340, -97.2289], "98626": [46.1468, -122.9084], "03054": [42.8584, -71.4934],
    // Major US cities fallback
    "100": [40.7128, -74.0060], "191": [39.9526, -75.1652], "900": [34.0522, -118.2437],
    "606": [41.8781, -87.6298], "770": [29.7604, -95.3698], "852": [33.4484, -112.0740],
    "782": [29.4241, -98.4936], "922": [32.7157, -117.1611], "752": [32.7767, -96.7970],
    "951": [33.9425, -117.2297]
  };
  var geocoded = 0;
  var needGeocode = await staging.query("SELECT zip FROM zip_clusters WHERE lat IS NULL");
  for (var row of needGeocode.rows) {
    var z = row.zip;
    var coords = ZIP_COORDS[z] || ZIP_COORDS[z.replace(/[^0-9]/g, "").slice(0, 5)] || ZIP_COORDS[z.slice(0, 3)];
    if (coords) {
      await staging.query("UPDATE zip_clusters SET lat=$1, lng=$2 WHERE zip=$3", [coords[0], coords[1], z]);
      geocoded++;
    }
  }
  console.log("  Geocoded: " + geocoded + " zip_clusters");

  // ── Match known ZIPs to places ──
  console.log("\nMatching ZIPs to existing places...");
  try {
    var matchResult = await staging.query(
      "UPDATE zip_clusters zc SET place_id = p.id " +
      "FROM places p WHERE zc.zip = ANY(p.zip_codes) AND zc.place_id IS NULL"
    );
    console.log("  Matched " + matchResult.rowCount + " zip_clusters to places");
  } catch (e) { console.error("  Place matching error:", e.message); }

  // ── Mark genesis-eligible clusters (threshold: 3 signals, no existing place) ──
  console.log("\nMarking genesis-eligible clusters...");
  try {
    var eligibleResult = await staging.query(
      "UPDATE zip_clusters SET genesis_eligible = true " +
      "WHERE signal_count >= 3 AND place_id IS NULL"
    );
    console.log("  Genesis-eligible clusters: " + eligibleResult.rowCount);
  } catch (e) { console.error("  Genesis eligible error:", e.message); }

  // ── Create genesis candidates ──
  console.log("Creating genesis candidates...");
  try {
    var candidateResult = await staging.query(
      "INSERT INTO genesis_candidates (name, zip, city, state, lat, lng, signal_count, threshold, progress_pct, status, created_at, updated_at) " +
      "SELECT city || ', ' || state, zip, city, state, lat, lng, signal_count, 50, " +
      "LEAST(100, (signal_count * 100 / 50)), 'forming', NOW(), NOW() " +
      "FROM zip_clusters " +
      "WHERE genesis_eligible = true " +
      "AND zip NOT IN (SELECT zip FROM genesis_candidates)"
    );
    console.log("  Genesis candidates created: " + candidateResult.rowCount);
  } catch (e) { console.error("  Genesis candidates error:", e.message); }

  // ── Propagate lat/lng to genesis candidates missing coordinates ──
  try {
    await staging.query(
      "UPDATE genesis_candidates gc SET lat = zc.lat, lng = zc.lng " +
      "FROM zip_clusters zc WHERE gc.zip = zc.zip AND gc.lat IS NULL AND zc.lat IS NOT NULL"
    );
  } catch (e) {}

  // ══════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════
  console.log("\n══════════════════════════════════════");
  console.log("           FINAL SUMMARY");
  console.log("══════════════════════════════════════");

  console.log("\nSignals inserted per platform:");
  console.log("  TC (Treasure Coast): " + stats.tc);
  console.log("  PP (Plant Purge):    " + stats.pp);
  console.log("  SB (Sebastian):      " + stats.sb);
  console.log("  Total:               " + (stats.tc + stats.pp + stats.sb));

  // Unique ZIPs
  try {
    var zipCount = await staging.query("SELECT COUNT(*)::integer AS c FROM zip_clusters");
    console.log("\nUnique ZIPs in zip_clusters: " + zipCount.rows[0].c);
  } catch (e) {}

  // Top 10 ZIPs
  try {
    var topZips = await staging.query(
      "SELECT zip, city, state, signal_count, unique_buyers FROM zip_clusters ORDER BY signal_count DESC LIMIT 10"
    );
    console.log("\nTop 10 ZIPs by signal count:");
    for (var r of topZips.rows) {
      console.log("  " + r.zip + "  " + (r.city || "?") + ", " + (r.state || "?") + "  — " + r.signal_count + " signals, " + r.unique_buyers + " buyers");
    }
  } catch (e) {}

  // States represented
  try {
    var states = await staging.query(
      "SELECT DISTINCT state FROM zip_clusters WHERE state IS NOT NULL AND state != '' ORDER BY state"
    );
    console.log("\nStates represented: " + states.rows.length);
    console.log("  " + states.rows.map(function(r) { return r.state; }).join(", "));
  } catch (e) {}

  // Place matches
  try {
    var placeMatches = await staging.query(
      "SELECT COUNT(*)::integer AS c FROM zip_clusters WHERE place_id IS NOT NULL"
    );
    console.log("\nZIP clusters matched to existing places: " + placeMatches.rows[0].c);
  } catch (e) {}

  // Genesis summary
  try {
    var genCount = await staging.query("SELECT COUNT(*)::integer AS c FROM genesis_candidates WHERE status = 'forming'");
    console.log("\nGenesis candidates (forming): " + genCount.rows[0].c);

    var topGen = await staging.query(
      "SELECT name, zip, signal_count, progress_pct FROM genesis_candidates ORDER BY signal_count DESC LIMIT 5"
    );
    if (topGen.rows.length) {
      console.log("\nTop 5 genesis candidates by progress:");
      for (var r of topGen.rows) {
        console.log("  " + r.name + " (" + r.zip + ") — " + r.signal_count + " signals, " + r.progress_pct + "% progress");
      }
    }
  } catch (e) {}

  console.log("\n══════════════════════════════════════");
  console.log("Done.");
  await staging.end();
}

main().catch(function(err) {
  console.error("FATAL:", err.message);
  process.exit(1);
});
