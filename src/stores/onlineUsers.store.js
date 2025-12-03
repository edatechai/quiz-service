// In-memory store for online users
// Key: schoolId, Value: { schoolId, schoolName, coordinatorEmail, region, lastActivity, currentScore (current round), lastScore (previous round), totalScore (cumulative total), sessionId (unique per device) }
export const onlineUsers = new Map();
export const ONLINE_THRESHOLD = 20 * 60 * 1000; // 20 minutes

// Generate a unique session ID
export function generateSessionId() {
	return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

// Check if a team has an active session on another device
export function hasActiveSession(schoolId, currentSessionId = null) {
	const user = onlineUsers.get(schoolId);
	if (!user) return false;
	
	// Check if the session is still active (within threshold)
	const isActive = Date.now() - user.lastActivity <= ONLINE_THRESHOLD;
	
	// If the same session ID, it's the same device (allow)
	if (currentSessionId && user.sessionId === currentSessionId) {
		return false;
	}
	
	// If there's an active session with a different session ID, block
	return isActive && user.sessionId;
}

// Force logout a team (for admin use)
// Instead of deleting, we mark the session as invalidated so the auth middleware can detect it
export function forceLogout(schoolId) {
	if (schoolId === AI_TEAM_ID) return false; // Never force logout AI team
	
	const user = onlineUsers.get(schoolId);
	if (user) {
		// Mark session as invalidated (sessionId = null) instead of deleting
		// This allows the auth middleware to detect force-logout and reject further requests
		onlineUsers.set(schoolId, {
			...user,
			sessionId: null, // Invalidated session marker
			forceLoggedOut: true, // Explicit flag for force logout
		});
		return true;
	}
	return false;
}

// AI Team identifier
export const AI_TEAM_ID = "edat-ai-team";

// Initialize AI Team as a persistent online user
const initializeAITeam = () => {
	const now = Date.now();
	onlineUsers.set(AI_TEAM_ID, {
		schoolId: AI_TEAM_ID,
		schoolName: "Edat AI Team",
		coordinatorEmail: "ai@edat.ai",
		region: "AI",
		lastActivity: now,
		currentScore: 0,
		lastScore: 0,
		totalScore: 0,
		isAITeam: true, // Flag to identify AI team
	});
};

// Initialize AI team on module load
initializeAITeam();

// Cleanup stale users every minute (but never remove AI team)
setInterval(() => {
	const now = Date.now();
	for (const [schoolId, user] of onlineUsers.entries()) {
		// Never delete the AI team
		if (schoolId === AI_TEAM_ID) {
			// Keep AI team activity updated
			onlineUsers.set(AI_TEAM_ID, {
				...user,
				lastActivity: now,
			});
			continue;
		}
		
		if (now - user.lastActivity > ONLINE_THRESHOLD) {
			onlineUsers.delete(schoolId);
		}
	}
}, 60 * 1000);

