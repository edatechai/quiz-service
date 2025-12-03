import { Router } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { onlineUsers, ONLINE_THRESHOLD, AI_TEAM_ID, generateSessionId, hasActiveSession, forceLogout } from "../stores/onlineUsers.store.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

// Accepts JSON payload scanned from QR and issues a session cookie
router.post("/qr-login", async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ message: "Invalid QR payload" });
    }

    // Basic shape check
    const { type, schoolId, schoolName, coordinatorEmail, region, iat } = payload;
    if (type !== "school_login" || !schoolId || !schoolName || !coordinatorEmail) {
      return res.status(400).json({ message: "Malformed QR payload" });
    }

    // AUTH-06: Check for concurrent login
    // If the team is already logged in on another device, reject the login
    // Skip this check for admin users to allow multiple admin sessions
    const isAdmin = schoolId === "admin" || schoolName === "Admin";
    if (!isAdmin && hasActiveSession(schoolId)) {
      return res.status(409).json({
        message: "Team already logged in on another device",
        code: "CONCURRENT_LOGIN",
        details: "Please log out from the other device first, or wait for the session to expire."
      });
    }

    // Optionally: verify iat freshness (e.g., within 30 days)
    // const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    // if (!iat || Date.now() - Number(iat) > THIRTY_DAYS_MS) {
    //   return res.status(400).json({ message: "QR code expired" });
    // }

    // Generate a unique session ID for this device
    const sessionId = generateSessionId();

    // Build session claims (minimize PII)
    const claims = {
      sub: `school:${schoolId}`,
      sid: schoolId,
      sn: schoolName,
      em: coordinatorEmail,
      rg: region || null,
      typ: "school",
      ssid: sessionId, // Session ID for concurrent login tracking
    };

    const token = jwt.sign(claims, env.sessionSecret, { expiresIn: "7d" });

    // Register the user in onlineUsers with session ID
    // Clear forceLoggedOut flag to allow re-login after force logout
    const existingUser = onlineUsers.get(schoolId);
    onlineUsers.set(schoolId, {
      schoolId,
      schoolName,
      coordinatorEmail,
      region: region || null,
      lastActivity: Date.now(),
      currentScore: existingUser?.currentScore ?? 0,
      lastScore: existingUser?.lastScore ?? 0,
      totalScore: existingUser?.totalScore ?? 0,
      sessionId, // Track the session ID for concurrent login detection
      forceLoggedOut: false, // Clear force logout flag on new login
    });

    // HttpOnly cookie for session
    res.cookie("qsid", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    return res.status(200).json({ message: "Login successful", data: { token } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// AUTH-07: Force logout a team (for Quiz Master/Admin use)
router.post("/force-logout/:schoolId", requireAuth, (req, res) => {
  try {
    const { schoolId } = req.params;

    if (!schoolId) {
      return res.status(400).json({ message: "School ID is required" });
    }

    const success = forceLogout(schoolId);

    if (success) {
      return res.status(200).json({
        message: `Team ${schoolId} has been logged out`,
        data: { schoolId }
      });
    } else {
      return res.status(404).json({
        message: "Team not found or cannot be logged out",
        data: { schoolId }
      });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to force logout" });
  }
});

router.get("/me", requireAuth, (req, res) => {
  return res.json({ data: req.session });
});

// Get all currently online users
router.get("/online-users", requireAuth, (req, res) => {
  try {
    const now = Date.now();
    const activeUsers = [];

    // Filter out stale users and force-logged-out users
    for (const [schoolId, user] of onlineUsers.entries()) {
      // Skip force-logged-out users
      if (user.forceLoggedOut) {
        continue;
      }

      // Always include AI team, or include regular users if they're within threshold
      if (user.isAITeam || now - user.lastActivity <= ONLINE_THRESHOLD) {
        activeUsers.push({
          schoolId: user.schoolId,
          schoolName: user.schoolName,
          coordinatorEmail: user.coordinatorEmail,
          region: user.region,
          lastActivity: user.lastActivity,
          currentScore: user.currentScore ?? 0,
          lastScore: user.lastScore ?? 0,
          isOnline: true,
          isAITeam: user.isAITeam ?? false, // Include AI team flag
        });
      }
    }

    return res.status(200).json({
      message: "Online users retrieved successfully",
      data: {
        count: activeUsers.length,
        users: activeUsers,
        threshold: ONLINE_THRESHOLD,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

router.post("/logout", requireAuth, (req, res) => {
  try {
    if (req.session?.sid && req.session.sid !== AI_TEAM_ID) {
      // Never delete the AI team
      onlineUsers.delete(req.session.sid);
    }

    res.clearCookie("qsid", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });

    return res.status(200).json({ message: "Logout successful" });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ message: "Failed to logout" });
  }
});

// ============================================
// ADMIN ENDPOINTS (for Quiz Master Dashboard)
// These don't require user authentication
// ============================================

// Get all currently online users (Admin)
router.get("/admin/online-users", (req, res) => {
  try {
    const now = Date.now();
    const activeUsers = [];

    // Filter out stale users and force-logged-out users
    for (const [schoolId, user] of onlineUsers.entries()) {
      // Skip force-logged-out users
      if (user.forceLoggedOut) {
        continue;
      }

      // Always include AI team, or include regular users if they're within threshold
      if (user.isAITeam || now - user.lastActivity <= ONLINE_THRESHOLD) {
        activeUsers.push({
          schoolId: user.schoolId,
          schoolName: user.schoolName,
          coordinatorEmail: user.coordinatorEmail,
          region: user.region,
          lastActivity: user.lastActivity,
          currentScore: user.currentScore ?? 0,
          lastScore: user.lastScore ?? 0,
          isOnline: true,
          isAITeam: user.isAITeam ?? false,
        });
      }
    }

    return res.status(200).json({
      message: "Online users retrieved successfully",
      data: {
        count: activeUsers.length,
        users: activeUsers,
        threshold: ONLINE_THRESHOLD,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// AUTH-07: Force logout a team (Admin)
router.post("/admin/force-logout/:schoolId", (req, res) => {
  try {
    const { schoolId } = req.params;

    if (!schoolId) {
      return res.status(400).json({ message: "School ID is required" });
    }

    const success = forceLogout(schoolId);

    if (success) {
      return res.status(200).json({
        message: `Team ${schoolId} has been logged out`,
        data: { schoolId }
      });
    } else {
      return res.status(404).json({
        message: "Team not found or cannot be logged out",
        data: { schoolId }
      });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to force logout" });
  }
});

export default router;


