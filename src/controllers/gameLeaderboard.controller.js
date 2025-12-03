import { gameLeaderboardService } from "../services/gameLeaderboard.service.js";
import { onlineUsers, ONLINE_THRESHOLD, AI_TEAM_ID } from "../stores/onlineUsers.store.js";
import { getQuizStatus, startQuiz as startQuizTime, stopQuiz as stopQuizTime } from "../stores/quizTime.store.js";

export const getQuizTime = async (req, res, next) => {
	try {
		const status = getQuizStatus();
		res.json({
			data: {
				isActive: status.isActive,
				remainingTime: status.remainingTime,
				startTime: status.startTime,
				duration: status.duration,
			},
		});
	} catch (error) {
		next(error);
	}
};

export const startQuiz = async (req, res, next) => {
	try {
		const { durationMinutes = 25 } = req.body;
		startQuizTime(durationMinutes);
		res.json({
			message: "Quiz started successfully",
			data: getQuizStatus(),
		});
	} catch (error) {
		next(error);
	}
};

export const stopQuiz = async (req, res, next) => {
	try {
		stopQuizTime();
		res.json({
			message: "Quiz stopped successfully",
			data: getQuizStatus(),
		});
	} catch (error) {
		next(error);
	}
};

export const submitLeaderboardScore = async (req, res, next) => {
	try {
		const payload = {
			schoolId: req.body.schoolId,
			schoolName: req.body.schoolName,
			teamName: req.body.teamName,
			score: req.body.score,
			roundsPlayed: req.body.roundsPlayed,
			meta: req.body.meta,
		};

		const result = await gameLeaderboardService.recordScore(payload);

		// Update onlineUsers map with round scores and total score for real-time leaderboard
		if (payload.schoolId) {
			const existingUser = onlineUsers.get(payload.schoolId);
			const currentRoundScore = req.body.roundScore ?? 0; // Current round's score
			const previousRoundScore = req.body.previousRoundScore ?? 0; // Previous round's score
			
			if (existingUser) {
				// Update existing user with round scores and cumulative total
				// Preserve isAITeam flag if it exists
				onlineUsers.set(payload.schoolId, {
					...existingUser,
					currentScore: currentRoundScore, // Current round score
					lastScore: previousRoundScore, // Previous round score
					totalScore: payload.score, // Cumulative total score
					lastActivity: Date.now(),
				});
			} else {
				// Create new entry if user doesn't exist in onlineUsers
				onlineUsers.set(payload.schoolId, {
					schoolId: payload.schoolId,
					schoolName: payload.schoolName,
					coordinatorEmail: "", // Not available from score submission
					region: null,
					lastActivity: Date.now(),
					currentScore: currentRoundScore, // Current round score
					lastScore: previousRoundScore, // Previous round score
					totalScore: payload.score, // Cumulative total score
					isAITeam: false, // Regular user, not AI team
				});
			}
		}

		res
			.status(201)
			.json({ message: "Score recorded successfully", data: result });
	} catch (error) {
		next(error);
	}
};

// Real-time score update endpoint (doesn't persist to DB, just updates onlineUsers)
export const updateLiveScore = async (req, res, next) => {
	try {
		const { schoolId, schoolName, totalScore, roundScore, previousRoundScore } = req.body;

		if (!schoolId) {
			return res.status(400).json({ message: "schoolId is required" });
		}

		// Update onlineUsers map with real-time scores
		const existingUser = onlineUsers.get(schoolId);
		
		if (existingUser) {
			// Update existing user with cumulative total score and round scores
			// Preserve isAITeam flag if it exists
			onlineUsers.set(schoolId, {
				...existingUser,
				currentScore: roundScore ?? existingUser.currentScore ?? 0, // Current round score
				lastScore: previousRoundScore ?? existingUser.lastScore ?? 0, // Previous round score
				totalScore: totalScore ?? existingUser.totalScore ?? 0, // Cumulative total score
				lastActivity: Date.now(),
			});
		} else {
			// Create new entry if user doesn't exist in onlineUsers
			onlineUsers.set(schoolId, {
				schoolId,
				schoolName: schoolName || "Unknown School",
				coordinatorEmail: "",
				region: null,
				lastActivity: Date.now(),
				currentScore: roundScore ?? 0,
				lastScore: previousRoundScore ?? 0,
				totalScore: totalScore ?? 0,
				isAITeam: false, // Regular user, not AI team
			});
		}

		res.status(200).json({ message: "Score updated successfully" });
	} catch (error) {
		next(error);
	}
};

export const listLeaderboardScores = async (req, res, next) => {
	try {
		const limit = req.query.limit ? Number(req.query.limit) : undefined;
		const dbResults = await gameLeaderboardService.list(limit);

		// Merge database scores with real-time onlineUsers scores
		const now = Date.now();
		const scoreMap = new Map();

		// Add database scores
		dbResults.forEach((entry) => {
			scoreMap.set(entry.schoolId, {
				schoolId: entry.schoolId,
				schoolName: entry.schoolName,
				teamName: entry.teamName || entry.schoolName,
				totalScore: entry.totalScore || 0,
				roundsPlayed: entry.roundsPlayed || 0,
				lastSubmissionAt: entry.lastSubmissionAt,
				isOnline: false,
			});
		});

		// Update with real-time onlineUsers scores (if higher or more recent)
		for (const [schoolId, user] of onlineUsers.entries()) {
			// Always include AI team, or include regular users if they're within threshold
			if (user.isAITeam || now - user.lastActivity <= ONLINE_THRESHOLD) {
				const existing = scoreMap.get(schoolId);
				// Use totalScore from onlineUsers if available, otherwise use currentScore
				const onlineTotalScore = user.totalScore ?? user.currentScore ?? 0;
				
				// Use online score if it's higher or if there's no database entry
				if (!existing || onlineTotalScore > (existing.totalScore || 0)) {
					scoreMap.set(schoolId, {
						schoolId: user.schoolId,
						schoolName: user.schoolName,
						teamName: user.schoolName, // Use schoolName as teamName fallback
						totalScore: onlineTotalScore,
						roundsPlayed: existing?.roundsPlayed || 0,
						lastSubmissionAt: existing?.lastSubmissionAt || new Date(),
						isOnline: true,
						isAITeam: user.isAITeam ?? false, // Include AI team flag
					});
				} else if (existing) {
					// Mark as online if user is active
					existing.isOnline = true;
					existing.isAITeam = user.isAITeam ?? false;
				}
			}
		}

		// Convert to array and sort by score (descending)
		const mergedResults = Array.from(scoreMap.values()).sort(
			(a, b) => (b.totalScore || 0) - (a.totalScore || 0)
		);

		res.json({
			data: {
				count: mergedResults.length,
				entries: mergedResults,
			},
		});
	} catch (error) {
		next(error);
	}
};

