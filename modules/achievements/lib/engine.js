/**
 * Leaderboard Scoring Engine
 * Adapted from DT leaderboard-engine.js
 * Each function returns a numeric score 0-100 or null if below minimum threshold.
 * Scores are weighted composites of multiple metrics.
 */

// Helper: clamp a count to 0-1 range against a target ceiling
function norm(count, target) {
  if (!target) return 0;
  return Math.min(count / target, 1);
}

// Helper: get YYYY-MM bounds for SQL date filtering
function monthBounds(month) {
  var start = month + '-01';
  var y = parseInt(month.slice(0, 4));
  var m = parseInt(month.slice(5, 7));
  if (m === 12) { y++; m = 1; } else { m++; }
  var end = y + '-' + String(m).padStart(2, '0') + '-01';
  return { start: start, end: end };
}

// ─────────────────────────────────────────────────
// BST Group Score (track: bst_group, entity_type: group)
// ─────────────────────────────────────────────────
// Active members: 35% | Sales: 35% | Shares with clicks: 20% | Retention: 10%
async function calculateBSTGroupScore(db, groupId, month) {
  var b = monthBounds(month);

  // Total members in the group
  var totalQ = await db.query(
    'SELECT COUNT(*)::integer AS cnt FROM group_members WHERE group_id = $1',
    [groupId]
  );
  var totalMembers = totalQ.rows[0].cnt || 0;
  if (totalMembers === 0) return 0;

  // Active members: posted a listing or made a purchase this month
  var activeQ = await db.query(
    "SELECT COUNT(DISTINCT gm.user_id)::integer AS cnt " +
    "FROM group_members gm " +
    "WHERE gm.group_id = $1 " +
    "AND ( " +
    "  EXISTS (SELECT 1 FROM listings l WHERE l.seller_id = gm.user_id AND l.created_at >= $2 AND l.created_at < $3) " +
    "  OR EXISTS (SELECT 1 FROM orders o WHERE o.buyer_id = gm.user_id AND o.status = 'paid' AND o.created_at >= $2 AND o.created_at < $3) " +
    ")",
    [groupId, b.start, b.end]
  );
  var activeMembers = activeQ.rows[0].cnt || 0;

  // Sales completed by group members
  var salesQ = await db.query(
    "SELECT COUNT(*)::integer AS cnt " +
    "FROM orders o " +
    "JOIN group_members gm ON gm.user_id = o.seller_id OR gm.user_id = o.buyer_id " +
    "WHERE gm.group_id = $1 AND o.status = 'paid' " +
    "AND o.created_at >= $2 AND o.created_at < $3",
    [groupId, b.start, b.end]
  );
  var sales = salesQ.rows[0].cnt || 0;

  // Shares from group members that drove click-throughs
  var sharesQ = await db.query(
    "SELECT COUNT(*)::integer AS cnt " +
    "FROM leaderboard_shares ls " +
    "JOIN group_members gm ON gm.user_id = ls.user_id " +
    "WHERE gm.group_id = $1 AND ls.clicked = true " +
    "AND ls.created_at >= $2 AND ls.created_at < $3",
    [groupId, b.start, b.end]
  );
  var clickedShares = sharesQ.rows[0].cnt || 0;

  // Retention: active / total
  var retention = totalMembers > 0 ? activeMembers / totalMembers : 0;

  var score =
    norm(activeMembers, 30) * 100 * 0.35 +
    norm(sales, 20) * 100 * 0.35 +
    norm(clickedShares, 15) * 100 * 0.20 +
    retention * 100 * 0.10;

  return Math.round(score * 100) / 100;
}

// ─────────────────────────────────────────────────
// Rides Score (track: rides, entity_type: driver)
// ─────────────────────────────────────────────────
// Rides completed: 35% | Avg rating: 35% | on_time tag %: 20% | professional tag %: 10%
// Min 5 rides to qualify
async function calculateRidesScore(db, providerId, month) {
  var b = monthBounds(month);

  // Completed rides this month
  var ridesQ = await db.query(
    "SELECT COUNT(*)::integer AS cnt " +
    "FROM gig_bookings gb " +
    "JOIN gig_providers gp ON gp.id = gb.provider_id " +
    "WHERE gb.provider_id = $1 AND gb.status = 'completed' " +
    "AND gp.category_slug = 'rides' " +
    "AND gb.completed_at >= $2 AND gb.completed_at < $3",
    [providerId, b.start, b.end]
  );
  var rideCount = ridesQ.rows[0].cnt || 0;
  if (rideCount < 5) return null;

  // Average star rating from reviews this month
  var ratingQ = await db.query(
    "SELECT AVG(gr.stars)::decimal(3,2) AS avg_stars, " +
    "COUNT(*)::integer AS review_count " +
    "FROM gig_reviews gr " +
    "JOIN gig_bookings gb ON gb.id = gr.booking_id " +
    "WHERE gb.provider_id = $1 " +
    "AND gr.created_at >= $2 AND gr.created_at < $3",
    [providerId, b.start, b.end]
  );
  var avgStars = parseFloat(ratingQ.rows[0].avg_stars) || 0;
  var reviewCount = ratingQ.rows[0].review_count || 0;

  // Tag percentages from reviews this month
  var onTimePercent = 0;
  var professionalPercent = 0;
  if (reviewCount > 0) {
    var tagsQ = await db.query(
      "SELECT " +
      "COUNT(*) FILTER (WHERE gr.tags::text LIKE '%on_time%' OR gr.tags::text LIKE '%on time%')::integer AS on_time, " +
      "COUNT(*) FILTER (WHERE gr.tags::text LIKE '%professional%')::integer AS professional, " +
      "COUNT(*)::integer AS total " +
      "FROM gig_reviews gr " +
      "JOIN gig_bookings gb ON gb.id = gr.booking_id " +
      "WHERE gb.provider_id = $1 " +
      "AND gr.created_at >= $2 AND gr.created_at < $3",
      [providerId, b.start, b.end]
    );
    var t = tagsQ.rows[0];
    onTimePercent = t.total > 0 ? (t.on_time / t.total) * 100 : 0;
    professionalPercent = t.total > 0 ? (t.professional / t.total) * 100 : 0;
  }

  var score =
    norm(rideCount, 20) * 100 * 0.35 +
    (avgStars / 5) * 100 * 0.35 +
    onTimePercent * 0.20 +
    professionalPercent * 0.10;

  return Math.round(score * 100) / 100;
}

// ─────────────────────────────────────────────────
// Gigs Score (track: gigs, entity_type: worker)
// ─────────────────────────────────────────────────
// Jobs completed: 35% | Avg rating: 30% | clean_work_area tag %: 20% | on_time tag %: 15%
// Min 5 jobs to qualify
async function calculateGigsScore(db, providerId, month) {
  var b = monthBounds(month);

  // Completed gig jobs this month (delivery + junk categories)
  var jobsQ = await db.query(
    "SELECT COUNT(*)::integer AS cnt " +
    "FROM gig_bookings gb " +
    "JOIN gig_providers gp ON gp.id = gb.provider_id " +
    "WHERE gb.provider_id = $1 AND gb.status = 'completed' " +
    "AND gp.category_slug IN ('delivery', 'junk') " +
    "AND gb.completed_at >= $2 AND gb.completed_at < $3",
    [providerId, b.start, b.end]
  );
  var jobCount = jobsQ.rows[0].cnt || 0;
  if (jobCount < 5) return null;

  // Average star rating
  var ratingQ = await db.query(
    "SELECT AVG(gr.stars)::decimal(3,2) AS avg_stars, " +
    "COUNT(*)::integer AS review_count " +
    "FROM gig_reviews gr " +
    "JOIN gig_bookings gb ON gb.id = gr.booking_id " +
    "WHERE gb.provider_id = $1 " +
    "AND gr.created_at >= $2 AND gr.created_at < $3",
    [providerId, b.start, b.end]
  );
  var avgStars = parseFloat(ratingQ.rows[0].avg_stars) || 0;
  var reviewCount = ratingQ.rows[0].review_count || 0;

  // Tag percentages
  var cleanPercent = 0;
  var onTimePercent = 0;
  if (reviewCount > 0) {
    var tagsQ = await db.query(
      "SELECT " +
      "COUNT(*) FILTER (WHERE gr.tags::text LIKE '%clean_work_area%' OR gr.tags::text LIKE '%clean work%')::integer AS clean, " +
      "COUNT(*) FILTER (WHERE gr.tags::text LIKE '%on_time%' OR gr.tags::text LIKE '%on time%')::integer AS on_time, " +
      "COUNT(*)::integer AS total " +
      "FROM gig_reviews gr " +
      "JOIN gig_bookings gb ON gb.id = gr.booking_id " +
      "WHERE gb.provider_id = $1 " +
      "AND gr.created_at >= $2 AND gr.created_at < $3",
      [providerId, b.start, b.end]
    );
    var t = tagsQ.rows[0];
    cleanPercent = t.total > 0 ? (t.clean / t.total) * 100 : 0;
    onTimePercent = t.total > 0 ? (t.on_time / t.total) * 100 : 0;
  }

  var score =
    norm(jobCount, 15) * 100 * 0.35 +
    (avgStars / 5) * 100 * 0.30 +
    cleanPercent * 0.20 +
    onTimePercent * 0.15;

  return Math.round(score * 100) / 100;
}

// ─────────────────────────────────────────────────
// Community Score (track: community, entity_type: member)
// ─────────────────────────────────────────────────
// Purchases: 30% | Quality reviews: 25% | Shares w/ clicks: 25% | Helpful votes: 20%
async function calculateCommunityScore(db, userId, month) {
  var b = monthBounds(month);

  // Purchases completed this month
  var purchasesQ = await db.query(
    "SELECT COUNT(*)::integer AS cnt " +
    "FROM orders " +
    "WHERE buyer_id = $1 AND status = 'paid' " +
    "AND created_at >= $2 AND created_at < $3",
    [userId, b.start, b.end]
  );
  var purchases = purchasesQ.rows[0].cnt || 0;

  // Quality reviews: verified purchase + body > 150 chars
  var reviewsQ = await db.query(
    "SELECT COUNT(*)::integer AS cnt " +
    "FROM gig_reviews gr " +
    "WHERE gr.customer_user_id = $1 " +
    "AND gr.body IS NOT NULL AND LENGTH(gr.body) > 150 " +
    "AND gr.created_at >= $2 AND gr.created_at < $3",
    [userId, b.start, b.end]
  );
  var qualityReviews = reviewsQ.rows[0].cnt || 0;

  // Shares that drove a click-through
  var sharesQ = await db.query(
    "SELECT COUNT(*)::integer AS cnt " +
    "FROM leaderboard_shares " +
    "WHERE user_id = $1 AND clicked = true " +
    "AND created_at >= $2 AND created_at < $3",
    [userId, b.start, b.end]
  );
  var clickedShares = sharesQ.rows[0].cnt || 0;

  // Helpful votes received on their reviews
  var helpfulQ = await db.query(
    "SELECT COALESCE(SUM(gr.helpful_count), 0)::integer AS total " +
    "FROM gig_reviews gr " +
    "WHERE gr.customer_user_id = $1 " +
    "AND gr.created_at >= $2 AND gr.created_at < $3",
    [userId, b.start, b.end]
  );
  var helpfulVotes = helpfulQ.rows[0].total || 0;

  var score =
    norm(purchases, 8) * 100 * 0.30 +
    norm(qualityReviews, 4) * 100 * 0.25 +
    norm(clickedShares, 8) * 100 * 0.25 +
    norm(helpfulVotes, 15) * 100 * 0.20;

  return Math.round(score * 100) / 100;
}

// ─────────────────────────────────────────────────
// Calculate all scores for a place/month
// ─────────────────────────────────────────────────
async function calculateForPlace(db, placeSlug, month) {
  var results = { bst_group: 0, rides: 0, gigs: 0, community: 0 };

  // BST Groups in this place
  try {
    var groupsR = await db.query(
      "SELECT id FROM groups WHERE place_slug = $1",
      [placeSlug]
    );
    for (var i = 0; i < groupsR.rows.length; i++) {
      var g = groupsR.rows[i];
      var score = await calculateBSTGroupScore(db, g.id, month);
      if (score !== null && score > 0) {
        await db.query(
          "INSERT INTO leaderboard_scores (place_slug, track, entity_id, entity_type, score, month) " +
          "VALUES ($1, 'bst_group', $2, 'group', $3, $4) " +
          "ON CONFLICT (place_slug, track, entity_id, month) DO UPDATE SET score = $3, updated_at = NOW()",
          [placeSlug, String(g.id), score, month]
        );
        results.bst_group++;
      }
    }
  } catch (err) { console.error("[achievements] BST group scoring error:", err.message); }

  // Rides providers in this place
  try {
    var ridesR = await db.query(
      "SELECT gp.id FROM gig_providers gp WHERE gp.place_slug = $1 AND gp.category_slug = 'rides'",
      [placeSlug]
    );
    for (var i = 0; i < ridesR.rows.length; i++) {
      var p = ridesR.rows[i];
      var score = await calculateRidesScore(db, p.id, month);
      if (score !== null) {
        await db.query(
          "INSERT INTO leaderboard_scores (place_slug, track, entity_id, entity_type, score, month) " +
          "VALUES ($1, 'rides', $2, 'driver', $3, $4) " +
          "ON CONFLICT (place_slug, track, entity_id, month) DO UPDATE SET score = $3, updated_at = NOW()",
          [placeSlug, String(p.id), score, month]
        );
        results.rides++;
      }
    }
  } catch (err) { console.error("[achievements] Rides scoring error:", err.message); }

  // Gigs providers in this place
  try {
    var gigsR = await db.query(
      "SELECT gp.id FROM gig_providers gp WHERE gp.place_slug = $1 AND gp.category_slug IN ('delivery', 'junk')",
      [placeSlug]
    );
    for (var i = 0; i < gigsR.rows.length; i++) {
      var p = gigsR.rows[i];
      var score = await calculateGigsScore(db, p.id, month);
      if (score !== null) {
        await db.query(
          "INSERT INTO leaderboard_scores (place_slug, track, entity_id, entity_type, score, month) " +
          "VALUES ($1, 'gigs', $2, 'worker', $3, $4) " +
          "ON CONFLICT (place_slug, track, entity_id, month) DO UPDATE SET score = $3, updated_at = NOW()",
          [placeSlug, String(p.id), score, month]
        );
        results.gigs++;
      }
    }
  } catch (err) { console.error("[achievements] Gigs scoring error:", err.message); }

  // Community members in this place
  try {
    var membersR = await db.query(
      "SELECT id FROM users WHERE community_slug = $1 AND suspended IS NOT true LIMIT 500",
      [placeSlug]
    );
    for (var i = 0; i < membersR.rows.length; i++) {
      var u = membersR.rows[i];
      var score = await calculateCommunityScore(db, u.id, month);
      if (score !== null && score > 0) {
        await db.query(
          "INSERT INTO leaderboard_scores (place_slug, track, entity_id, entity_type, score, month) " +
          "VALUES ($1, 'community', $2, 'member', $3, $4) " +
          "ON CONFLICT (place_slug, track, entity_id, month) DO UPDATE SET score = $3, updated_at = NOW()",
          [placeSlug, String(u.id), score, month]
        );
        results.community++;
      }
    }
  } catch (err) { console.error("[achievements] Community scoring error:", err.message); }

  // Assign ranks per track
  var tracks = ['bst_group', 'rides', 'gigs', 'community'];
  for (var t = 0; t < tracks.length; t++) {
    try {
      await db.query(
        "UPDATE leaderboard_scores ls SET rank = sub.rnk FROM (" +
        "  SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC) AS rnk " +
        "  FROM leaderboard_scores WHERE place_slug = $1 AND track = $2 AND month = $3" +
        ") sub WHERE ls.id = sub.id",
        [placeSlug, tracks[t], month]
      );
    } catch (err) { console.error("[achievements] Rank assignment error:", tracks[t], err.message); }
  }

  return results;
}

module.exports = {
  calculateBSTGroupScore: calculateBSTGroupScore,
  calculateRidesScore: calculateRidesScore,
  calculateGigsScore: calculateGigsScore,
  calculateCommunityScore: calculateCommunityScore,
  calculateForPlace: calculateForPlace,
  monthBounds: monthBounds
};
