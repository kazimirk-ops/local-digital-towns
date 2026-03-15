// lib/identity-bridge.js
// Links a platform user to a canonical DT user by email.
// Creates a DT user silently if one doesn't exist yet.

async function linkPlatformUser(db, opts) {
  if (!opts.email || !opts.platformSlug) return null;

  var normalizedEmail = opts.email.toLowerCase().trim();

  // 1. Find or create DT user by email
  var user = await db.query(
    "SELECT id, email, display_name, avatar_url FROM users WHERE email = $1",
    [normalizedEmail]
  );

  var dtUserId;
  if (user.rows.length > 0) {
    dtUserId = user.rows[0].id;
    // Update avatar/name if DT user has none
    if (!user.rows[0].display_name && opts.platformDisplayName) {
      await db.query(
        "UPDATE users SET display_name = $1 WHERE id = $2",
        [opts.platformDisplayName, dtUserId]
      );
    }
    if (!user.rows[0].avatar_url && opts.platformAvatarUrl) {
      await db.query(
        "UPDATE users SET avatar_url = $1 WHERE id = $2",
        [opts.platformAvatarUrl, dtUserId]
      );
    }
  } else {
    // Create new DT user silently
    var newUser = await db.query(
      "INSERT INTO users (email, display_name, avatar_url, trust_tier, created_at) " +
      "VALUES ($1, $2, $3, 0, NOW()) " +
      "ON CONFLICT (email) DO UPDATE SET last_active_at = NOW() " +
      "RETURNING id",
      [normalizedEmail, opts.platformDisplayName || null, opts.platformAvatarUrl || null]
    );
    dtUserId = newUser.rows[0].id;
  }

  // 2. Upsert platform_users record
  await db.query(
    "INSERT INTO platform_users " +
    "(dt_user_id, email, platform_slug, platform_user_id, " +
    "platform_user_type, platform_display_name, platform_avatar_url, " +
    "platform_stripe_connected, last_seen_at, metadata) " +
    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9) " +
    "ON CONFLICT (email, platform_slug) DO UPDATE SET " +
    "dt_user_id = EXCLUDED.dt_user_id, " +
    "platform_user_id = EXCLUDED.platform_user_id, " +
    "platform_user_type = EXCLUDED.platform_user_type, " +
    "platform_display_name = EXCLUDED.platform_display_name, " +
    "platform_avatar_url = EXCLUDED.platform_avatar_url, " +
    "platform_stripe_connected = EXCLUDED.platform_stripe_connected, " +
    "last_seen_at = NOW(), " +
    "metadata = EXCLUDED.metadata",
    [
      dtUserId,
      normalizedEmail,
      opts.platformSlug,
      opts.platformUserId || null,
      opts.platformUserType || null,
      opts.platformDisplayName || null,
      opts.platformAvatarUrl || null,
      opts.platformStripeConnected || false,
      JSON.stringify(opts.metadata || {})
    ]
  );

  return dtUserId;
}

module.exports = { linkPlatformUser };
