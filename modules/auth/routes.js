// Auth module routes
// Extracted from: email OTP (Digital Towns), Google OAuth (Sebastian), Facebook OAuth (Plant Purge)
// Session management: cookie-based (Sebastian pattern)

const crypto = require("crypto");
const path = require("path");
const trust = require("./lib/trust");

module.exports = function mountAuth(app, db) {

  // Serve login page from modules/auth/public/
  app.get("/login.html", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
  });

  // --- Helper functions (from Sebastian server.js) ---

  function parseCookies(req) {
    const header = req.headers.cookie || "";
    const parts = header.split(";").map(p => p.trim()).filter(Boolean);
    const out = {};
    for (const p of parts) {
      const i = p.indexOf("=");
      if (i > -1) out[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1));
    }
    return out;
  }

  function isHttpsRequest(req) {
    const proto = (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim().toLowerCase();
    return req.secure || proto === "https";
  }

  function setCookie(res, n, v, o = {}) {
    const p = [`${n}=${encodeURIComponent(v)}`, "Path=/", "SameSite=Lax"];
    if (o.httpOnly) p.push("HttpOnly");
    if (o.secure) p.push("Secure");
    if (o.maxAge != null) p.push(`Max-Age=${o.maxAge}`);
    const existing = res.getHeader("Set-Cookie") || [];
    const arr = Array.isArray(existing) ? existing : (existing ? [existing] : []);
    arr.push(p.join("; "));
    res.setHeader("Set-Cookie", arr);
  }

  function normalizeEmail(e) {
    return (e || "").toString().trim().toLowerCase();
  }

  function generateSixDigitCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function randToken(bytes) {
    return crypto.randomBytes(bytes || 24).toString("hex");
  }

  // --- DB helpers ---

  async function upsertUserByEmail(email) {
    const e = normalizeEmail(email);
    if (!e) return null;
    const existing = await db.one("SELECT * FROM users WHERE email = $1", [e]);
    if (existing) return existing;
    const result = await db.query(
      "INSERT INTO users (email, display_name, trust_tier, trust_tier_num, created_at) VALUES ($1, $2, 'individual', 1, now()) RETURNING id",
      [e, e.split("@")[0]]
    );
    return db.one("SELECT * FROM users WHERE id = $1", [result.rows[0].id]);
  }

  async function createSession(userId) {
    const sid = randToken(24);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await db.query(
      "INSERT INTO sessions (sid, user_id, expires_at, created_at) VALUES ($1, $2, $3, now())",
      [sid, Number(userId), expiresAt]
    );
    return { sid, expiresAt };
  }

  async function deleteSession(sid) {
    await db.query("DELETE FROM sessions WHERE sid = $1", [sid]);
  }

  async function getUserBySession(sid) {
    const sess = await db.one("SELECT * FROM sessions WHERE sid = $1", [sid]);
    if (!sess) return null;
    if (new Date(sess.expires_at).getTime() < Date.now()) {
      await deleteSession(sid);
      return null;
    }
    const user = await db.one("SELECT * FROM users WHERE id = $1", [sess.user_id]);
    return user || null;
  }

  // --- Session middleware ---

  async function getUserId(req) {
    const sid = parseCookies(req).sid;
    if (!sid) return null;
    const user = await getUserBySession(sid);
    return user?.id ?? null;
  }

  async function requireLogin(req, res) {
    const userId = await getUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Login required" });
      return null;
    }
    var susp = await db.query("SELECT suspended FROM users WHERE id=$1", [userId]);
    if (susp.rows.length && susp.rows[0].suspended) {
      res.status(403).json({ error: "Account suspended" });
      return null;
    }
    return userId;
  }

  // Expose helpers on app for use by other modules
  app._auth = { parseCookies, setCookie, isHttpsRequest, getUserId, requireLogin, getUserBySession, upsertUserByEmail, createSession, deleteSession, trust };

  // ============================================================
  // EMAIL OTP (extracted from Digital Towns routes/auth.js)
  // ============================================================

  // POST /api/auth/request-code — send 6-digit OTP
  app.post("/api/auth/request-code", async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      if (!email) return res.status(400).json({ error: "Email required" });

      // Rate limit: max 3 codes per email per 15 min
      const recent = await db.query(
        "SELECT COUNT(*) FROM auth_codes WHERE email = $1 AND created_at > NOW() - INTERVAL '15 minutes'",
        [email]
      );
      if (parseInt(recent.rows[0].count) >= 3) {
        return res.json({ ok: true, message: "If this email is valid, a code has been sent" });
      }

      const code = generateSixDigitCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

      await db.query(
        "INSERT INTO auth_codes (email, code, expires_at, created_at) VALUES ($1, $2, $3, now())",
        [email, code, expiresAt]
      );

      // Send email via Postmark or Resend (configured via env)
      try {
        await sendAuthCodeEmail(email, code);
      } catch (emailErr) {
        console.error("AUTH_EMAIL_SEND_ERROR", emailErr?.message);
      }

      const response = { ok: true, message: "Code sent to your email" };
      // In dev mode, return the code for testing
      if (process.env.SHOW_AUTH_CODE === "true") {
        response.code = code;
      }
      res.json(response);
    } catch (err) {
      console.error("AUTH_REQUEST_CODE_ERROR", err?.message);
      res.json({ ok: true, message: "If this email is valid, a code has been sent" });
    }
  });

  // POST /api/auth/verify-code — verify OTP and create session
  app.post("/api/auth/verify-code", async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const code = (req.body?.code || "").toString().trim();
      if (!email || !code) return res.status(400).json({ error: "Email and code required" });

      const result = await db.query(
        "SELECT * FROM auth_codes WHERE email = $1 AND code = $2 AND used = 0 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1",
        [email, code]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ error: "Invalid or expired code" });
      }

      // Mark as used
      await db.query("UPDATE auth_codes SET used = 1 WHERE id = $1", [result.rows[0].id]);

      // Find or create user
      const user = await upsertUserByEmail(email);
      if (!user) return res.status(500).json({ error: "Failed to create user" });

      // Create cookie session (Sebastian pattern — 30 day expiry)
      const s = await createSession(user.id);
      setCookie(res, "sid", s.sid, { httpOnly: true, maxAge: 60 * 60 * 24 * 30, secure: isHttpsRequest(req) });
      res.json({ ok: true, userId: user.id });
    } catch (err) {
      console.error("AUTH_VERIFY_CODE_ERROR", err?.message);
      res.status(500).json({ error: "Verification failed" });
    }
  });

  // ============================================================
  // GOOGLE OAUTH (extracted from Sebastian server.js — redirect flow)
  // ============================================================

  app.get("/api/auth/google", (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: "Google OAuth not configured" });
    // Store post-login redirect destination
    const redir = req.query.redirect || "/town";
    setCookie(res, "auth_redirect", redir, { httpOnly: true, maxAge: 600, secure: isHttpsRequest(req) });
    const baseUrl = process.env.BASE_URL || "https://digitaltowns.app";
    const redirectUri = encodeURIComponent(baseUrl + "/api/auth/google/callback");
    const scope = encodeURIComponent("openid email profile");
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&prompt=select_account`;
    res.redirect(url);
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    try {
      const code = req.query.code;
      if (!code) return res.redirect("/login.html?error=no_code");
      const baseUrl = process.env.BASE_URL || "https://digitaltowns.app";

      // Exchange code for token
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: baseUrl + "/api/auth/google/callback",
          grant_type: "authorization_code"
        })
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        console.error("GOOGLE_AUTH_TOKEN_ERROR", tokenData);
        return res.redirect("/login.html?error=token_failed");
      }

      // Fetch user profile
      const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const profile = await userRes.json();
      if (!profile.email) return res.redirect("/login.html?error=no_email");

      const email = profile.email.toLowerCase();
      const displayName = profile.name || email.split("@")[0];

      // Find or create user
      let userRow = await db.one("SELECT * FROM users WHERE google_id = $1 OR email = $2", [profile.id, email]);
      if (!userRow) {
        await db.query(
          "INSERT INTO users (email, display_name, google_id, avatar_url, trust_tier, trust_tier_num, created_at) VALUES ($1, $2, $3, $4, 'individual', 1, now())",
          [email, displayName, profile.id, profile.picture || ""]
        );
        userRow = await db.one("SELECT * FROM users WHERE email = $1", [email]);
        console.log("GOOGLE_AUTH_NEW_USER", { userId: userRow.id, email });
      } else {
        await db.query(
          "UPDATE users SET google_id = $1, avatar_url = COALESCE(NULLIF(avatar_url, ''), $2), display_name = COALESCE(NULLIF(display_name, ''), $3) WHERE id = $4",
          [profile.id, profile.picture || "", displayName, userRow.id]
        );
      }

      const s = await createSession(userRow.id);
      setCookie(res, "sid", s.sid, { httpOnly: true, maxAge: 60 * 60 * 24 * 30, secure: isHttpsRequest(req) });
      const redirectTo = parseCookies(req).auth_redirect || "/town";
      setCookie(res, "auth_redirect", "", { httpOnly: true, maxAge: 0, secure: isHttpsRequest(req) });
      res.redirect(redirectTo);
    } catch (err) {
      console.error("GOOGLE_AUTH_ERROR", err?.message);
      res.redirect("/login.html?error=auth_failed");
    }
  });

  // ============================================================
  // FACEBOOK OAUTH (extracted from Plant Purge server.js — redirect + CSRF)
  // ============================================================

  const fbSessions = new Map(); // CSRF state store (in-memory, cleared on restart)

  app.get("/api/auth/facebook/start", (req, res) => {
    const fbAppId = process.env.FACEBOOK_APP_ID;
    if (!fbAppId) return res.status(500).json({ error: "Facebook OAuth not configured" });
    // Store post-login redirect destination
    const redir = req.query.redirect || "/town";
    setCookie(res, "auth_redirect", redir, { httpOnly: true, maxAge: 600, secure: isHttpsRequest(req) });
    const baseUrl = process.env.BASE_URL || "https://digitaltowns.app";
    const redirectUri = baseUrl + "/api/auth/facebook/callback";

    const state = crypto.randomBytes(16).toString("hex");
    // Store CSRF state keyed by value (cleaned up on use)
    fbSessions.set(state, { created: Date.now() });

    // Store state in a cookie so we can verify on callback
    setCookie(res, "fb_oauth_state", state, { httpOnly: true, maxAge: 600, secure: isHttpsRequest(req) });

    const url = "https://www.facebook.com/v19.0/dialog/oauth"
      + "?client_id=" + fbAppId
      + "&redirect_uri=" + encodeURIComponent(redirectUri)
      + "&scope=public_profile,email"
      + "&response_type=code"
      + "&state=" + encodeURIComponent(state);
    res.redirect(url);
  });

  app.get("/api/auth/facebook/callback", async (req, res) => {
    try {
      const code = req.query.code;
      if (!code) return res.redirect("/login.html?error=fb_denied");

      // Verify CSRF state
      const returnedState = req.query.state;
      const expectedState = parseCookies(req).fb_oauth_state;
      // Clear CSRF cookie
      setCookie(res, "fb_oauth_state", "", { httpOnly: true, maxAge: 0, secure: isHttpsRequest(req) });
      fbSessions.delete(returnedState);

      if (!returnedState || !expectedState || returnedState !== expectedState) {
        console.error("FB_OAUTH_CSRF: state mismatch");
        return res.redirect("/login.html?error=fb_csrf_failed");
      }

      const fbAppId = process.env.FACEBOOK_APP_ID || "";
      const baseUrl = process.env.BASE_URL || "https://digitaltowns.app";
      const redirectUri = baseUrl + "/api/auth/facebook/callback";

      // Exchange code for access token
      const tokenUrl = "https://graph.facebook.com/v19.0/oauth/access_token"
        + "?client_id=" + fbAppId
        + "&redirect_uri=" + encodeURIComponent(redirectUri)
        + "&client_secret=" + encodeURIComponent(process.env.FACEBOOK_APP_SECRET || "")
        + "&code=" + encodeURIComponent(code);

      const tokenRes = await fetch(tokenUrl);
      if (!tokenRes.ok) {
        console.error("FB_TOKEN_ERROR", await tokenRes.text());
        return res.redirect("/login.html?error=fb_token_failed");
      }
      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;
      if (!accessToken) return res.redirect("/login.html?error=fb_no_token");

      // Fetch user profile
      const fbRes = await fetch(
        "https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=" + encodeURIComponent(accessToken)
      );
      if (!fbRes.ok) return res.redirect("/login.html?error=fb_profile_failed");
      const fbData = await fbRes.json();
      if (!fbData.id) return res.redirect("/login.html?error=fb_invalid");

      const fbId = fbData.id;
      const name = fbData.name || "";
      const email = fbData.email || "";
      const picture = (fbData.picture && fbData.picture.data) ? fbData.picture.data.url : "";

      // Find by fb_id first, then by email
      let userRow = await db.one("SELECT * FROM users WHERE fb_id = $1", [fbId]);
      if (!userRow && email) {
        userRow = await db.one("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
      }

      if (userRow) {
        await db.query(
          "UPDATE users SET fb_id = $1, avatar_url = COALESCE(NULLIF(avatar_url, ''), $2), display_name = COALESCE(NULLIF(display_name, ''), $3), facebook_verified = 1 WHERE id = $4",
          [fbId, picture, name, userRow.id]
        );
      } else {
        const userEmail = email ? email.toLowerCase() : (fbId + "@fb.placeholder");
        await db.query(
          "INSERT INTO users (email, fb_id, display_name, avatar_url, trust_tier, trust_tier_num, facebook_verified, created_at) VALUES ($1, $2, $3, $4, 'individual', 1, 1, now())",
          [userEmail, fbId, name, picture]
        );
        userRow = await db.one("SELECT * FROM users WHERE fb_id = $1", [fbId]);
        console.log("FB_AUTH_NEW_USER", { userId: userRow.id, email: userEmail });
      }

      const s = await createSession(userRow.id);
      setCookie(res, "sid", s.sid, { httpOnly: true, maxAge: 60 * 60 * 24 * 30, secure: isHttpsRequest(req) });
      const redirectTo = parseCookies(req).auth_redirect || "/town";
      setCookie(res, "auth_redirect", "", { httpOnly: true, maxAge: 0, secure: isHttpsRequest(req) });
      res.redirect(redirectTo);
    } catch (err) {
      console.error("FB_CALLBACK_ERROR", err?.message);
      res.redirect("/login.html?error=fb_server_error");
    }
  });

  // ============================================================
  // SESSION ENDPOINTS
  // ============================================================

  // GET /api/auth/me — return current user from session cookie
  app.get("/api/auth/me", async (req, res) => {
    try {
      const sid = parseCookies(req).sid;
      if (!sid) return res.status(401).json({ error: "Not logged in" });

      const user = await getUserBySession(sid);
      if (!user) return res.status(401).json({ error: "Session expired" });

      const tier = trust.resolveTier(user);
      res.json({
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        trust_tier: user.trust_tier,
        trust_tier_num: user.trust_tier_num,
        trust_tier_label: trust.getLevelLabel(tier),
        is_admin: user.is_admin,
        google_id: user.google_id ? true : false,
        fb_id: user.fb_id ? true : false,
        created_at: user.created_at,
        permissions: trust.permissionsForTier(tier)
      });
    } catch (err) {
      console.error("AUTH_ME_ERROR", err?.message);
      res.status(500).json({ error: "Auth check failed" });
    }
  });

  // POST /auth/logout — clear session cookie
  app.post("/auth/logout", async (req, res) => {
    const sid = parseCookies(req).sid;
    if (sid) await deleteSession(sid);
    setCookie(res, "sid", "", { httpOnly: true, maxAge: 0, secure: isHttpsRequest(req) });
    res.json({ ok: true });
  });

  // GET /auth/logout — clear session and redirect
  app.get("/auth/logout", async (req, res) => {
    const sid = parseCookies(req).sid;
    if (sid) await deleteSession(sid);
    setCookie(res, "sid", "", { httpOnly: true, maxAge: 0, secure: isHttpsRequest(req) });
    res.redirect("/");
  });

  // ============================================================
  // EMAIL SENDER (Postmark or Resend based on env)
  // ============================================================

  async function sendAuthCodeEmail(toEmail, code) {
    const postmarkKey = (process.env.POSTMARK_API_KEY || "").trim();
    const resendKey = (process.env.RESEND_API_KEY || "").trim();
    const from = (process.env.EMAIL_FROM || "").trim() || "noreply@digitaltowns.app";

    const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:#333;">Your Login Code</h2>
      <p>Login code for <strong>${toEmail}</strong>:</p>
      <div style="background:#f5f5f5;padding:20px;text-align:center;margin:20px 0;border-radius:8px;">
        <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#333;">${code}</span>
      </div>
      <p style="color:#666;">This code expires in 10 minutes.</p>
    </body></html>`;

    if (postmarkKey) {
      // Postmark (Sebastian pattern)
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": postmarkKey
        },
        body: JSON.stringify({
          From: from,
          To: toEmail,
          Subject: "Your login code",
          HtmlBody: html
        })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Postmark error ${res.status}: ${text}`);
      }
      return { ok: true, provider: "postmark" };
    }

    if (resendKey) {
      // Resend (Digital Towns / Plant Purge pattern)
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: from,
          to: [toEmail],
          subject: "Your login code",
          html: html
        })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Resend error ${res.status}: ${text}`);
      }
      return { ok: true, provider: "resend" };
    }

    console.warn("AUTH_EMAIL: No email provider configured (set POSTMARK_API_KEY or RESEND_API_KEY)");
    return { ok: false, skipped: true };
  }

  // ============================================================
  // CLEANUP CRON (expired codes)
  // ============================================================

  async function cleanupExpiredAuthCodes() {
    try {
      await db.query("DELETE FROM auth_codes WHERE created_at < NOW() - INTERVAL '24 hours'");
    } catch (err) {
      console.error("AUTH_CLEANUP_ERROR", err?.message);
    }
  }

  // Run cleanup every hour
  setInterval(cleanupExpiredAuthCodes, 60 * 60 * 1000);

  console.log("Auth module: routes mounted (email-otp, google-oauth, facebook-oauth, sessions)");
};
