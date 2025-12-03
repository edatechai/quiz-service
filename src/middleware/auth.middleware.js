import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { onlineUsers, hasActiveSession } from "../stores/onlineUsers.store.js";

// Middleware to read session
export function requireAuth(req, res, next) {
	try {
		const cookie = req.cookies?.qsid;
		const header = req.headers.authorization?.replace(/^Bearer\s+/i, "");
		const token = cookie || header;
		if (!token) return res.status(401).json({ message: "Unauthorized" });
		const claims = jwt.verify(token, env.sessionSecret);
		req.session = claims;

		// Check for session validity
		if (claims.sid) {
			const existingUser = onlineUsers.get(claims.sid);
			
			// AUTH-07: Check if user was force-logged-out by Quiz Master
			// If sessionId is null, the user was force logged out
			if (existingUser && existingUser.forceLoggedOut) {
				console.log(`🚫 SESSION_INVALIDATED: User ${claims.sid} was force-logged-out`);
				return res.status(401).json({ 
					message: "Session terminated by Quiz Master",
					code: "SESSION_INVALIDATED"
				});
			}
			
			// AUTH-06: Check if this session is still valid (not superseded by another device)
			// If there's an existing user with a different session ID, this session is invalid
			if (existingUser && existingUser.sessionId && existingUser.sessionId !== claims.ssid) {
				return res.status(401).json({ 
					message: "Session invalidated - logged in on another device",
					code: "SESSION_INVALIDATED"
				});
			}
		}

		// Track user activity - but ONLY if the session is valid
		// Don't re-add force-logged-out users
		if (claims.sid) {
			const existingUser = onlineUsers.get(claims.sid);
			// Only update if user is not force-logged-out
			if (!existingUser?.forceLoggedOut) {
				onlineUsers.set(claims.sid, {
					schoolId: claims.sid,
					schoolName: claims.sn,
					coordinatorEmail: claims.em,
					region: claims.rg,
					lastActivity: Date.now(),
					currentScore: existingUser?.currentScore ?? 0,
					lastScore: existingUser?.lastScore ?? 0,
					totalScore: existingUser?.totalScore ?? 0,
					sessionId: claims.ssid || existingUser?.sessionId, // Preserve session ID
				});
			}
		}

		return next();
	} catch (err) {
		return res.status(401).json({ message: "Unauthorized" });
	}
}

