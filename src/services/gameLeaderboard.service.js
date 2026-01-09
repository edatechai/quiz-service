import { GameLeaderboard } from "../models/gameLeaderboard.model.js";
import { onlineUsers, ONLINE_THRESHOLD } from "../stores/onlineUsers.store.js";
import { getCurrentQuizState } from "../stores/quizState.store.js";

const sanitizeScorePayload = (payload = {}) => {
	const errors = [];
	const {
		schoolId,
		schoolName,
		teamName = "",
		score = 0,
		roundsPlayed = 0,
		meta = {},
	} = payload;

	if (!schoolId || typeof schoolId !== "string") {
		errors.push("schoolId is required");
	}

	if (!schoolName || typeof schoolName !== "string") {
		errors.push("schoolName is required");
	}

	const numericScore = Number(score);
	const numericRounds = Number(roundsPlayed);

	return {
		errors,
		value: {
			schoolId: schoolId?.trim(),
			schoolName: schoolName?.trim(),
			teamName: (teamName || "").trim(),
			totalScore: Number.isFinite(numericScore) ? numericScore : 0,
			roundsPlayed: Number.isFinite(numericRounds) ? numericRounds : 0,
			meta: meta || {},
		},
	};
};

export const gameLeaderboardService = {
	/**
	 * GAME-08: Atomic Score Update
	 * Uses MongoDB's $inc operator for atomic score increments
	 * This ensures concurrent submissions don't cause data loss
	 * Also tracks per-round scores if roundIndex is provided in meta
	 */
	async recordScore(payload) {
		const { errors, value } = sanitizeScorePayload(payload);
		if (errors.length) {
			const err = new Error(errors.join(", "));
			err.status = 400;
			throw err;
		}

		// Extract roundIndex from meta for round-specific score tracking
		const roundIndex = value.meta?.roundIndex;
		const pointsEarned = value.meta?.pointsEarned || 0;

		const update = {
			schoolName: value.schoolName,
			teamName: value.teamName,
			totalScore: value.totalScore,
			roundsPlayed: value.roundsPlayed,
			meta: value.meta,
			lastSubmissionAt: new Date(),
		};

		// If roundIndex is provided, update the round-specific score
		if (roundIndex !== undefined && pointsEarned > 0) {
			update[`roundScores.${roundIndex}`] = await this.getRoundScore(value.schoolId, roundIndex) + pointsEarned;
		}

		const result = await GameLeaderboard.findOneAndUpdate(
			{ schoolId: value.schoolId },
			{ $set: update },
			{ upsert: true, new: true, setDefaultsOnInsert: true }
		)
			.lean({ virtuals: true })
			.exec();

		return result;
	},

	/**
	 * Helper: Get current round score for a team
	 */
	async getRoundScore(schoolId, roundIndex) {
		const team = await GameLeaderboard.findOne({ schoolId }).lean();
		if (!team || !team.roundScores) return 0;
		return team.roundScores[roundIndex.toString()] || 0;
	},

	/**
	 * Update round-specific score directly (for mobile app submissions)
	 * Sets the total score for a specific round
	 */
	async updateRoundScore(schoolId, roundIndex, roundScore) {
		const roundScoreKey = `roundScores.${roundIndex}`;

		const result = await GameLeaderboard.findOneAndUpdate(
			{ schoolId: schoolId },
			{
				$set: {
					[roundScoreKey]: roundScore,
					lastSubmissionAt: new Date()
				}
			},
			{ new: true }
		)
			.lean()
			.exec();

		return result;
	},

	/**
	 * GAME-08: Atomic Score Increment
	 * Atomically increments the score by a delta amount
	 * This ensures concurrent writes don't overwrite each other
	 * 
	 * @param {Object} payload - Score increment data
	 * @param {string} payload.schoolId - Unique school identifier
	 * @param {string} payload.schoolName - School name
	 * @param {number} payload.scoreDelta - Amount to add to the score (can be negative)
	 * @param {Object} payload.answerRecord - Record of this specific answer submission
	 */
	async incrementScore(payload) {
		const { schoolId, schoolName, teamName, scoreDelta, round, questionIndex, answerRecord } = payload;

		if (!schoolId || typeof schoolId !== "string") {
			const err = new Error("schoolId is required");
			err.status = 400;
			throw err;
		}

		const numericDelta = Number(scoreDelta);
		if (!Number.isFinite(numericDelta)) {
			const err = new Error("scoreDelta must be a valid number");
			err.status = 400;
			throw err;
		}

		// Create a unique answer key for this round/question combination
		const answerKey = `answers.round${round}_q${questionIndex}`;
		const roundScoreKey = `roundScores.${round}`;

		// Use atomic $inc and $set operations
		// The $inc operator atomically increments both totalScore and round-specific score
		// The $set on answers prevents duplicate submissions
		const result = await GameLeaderboard.findOneAndUpdate(
			{
				schoolId: schoolId.trim(),
				// Only update if this answer hasn't been submitted yet
				[answerKey]: { $exists: false }
			},
			{
				$inc: {
					totalScore: numericDelta,
					[roundScoreKey]: numericDelta  // Track per-round score
				},
				$set: {
					schoolName: schoolName?.trim() || "Unknown",
					teamName: (teamName || schoolName || "").trim(),
					lastSubmissionAt: new Date(),
					[answerKey]: {
						...answerRecord,
						submittedAt: new Date(),
					}
				},
				$setOnInsert: {
					createdAt: new Date(),
				}
			},
			{
				upsert: true,
				new: true,
				setDefaultsOnInsert: true
			}
		)
			.lean({ virtuals: true })
			.exec();

		// If result is null, the answer was already submitted (duplicate prevention)
		if (!result) {
			return {
				success: false,
				reason: "DUPLICATE_SUBMISSION",
				message: "Answer for this question has already been submitted"
			};
		}

		return {
			success: true,
			data: result
		};
	},

	/**
	 * Check if a team has already submitted an answer for a specific question
	 */
	async hasAnswered(schoolId, round, questionIndex) {
		const answerKey = `answers.round${round}_q${questionIndex}`;

		const existing = await GameLeaderboard.findOne({
			schoolId: schoolId.trim(),
			[answerKey]: { $exists: true }
		})
			.lean()
			.exec();

		return !!existing;
	},

	async list(limit = 100) {
		const size = Math.max(1, Math.min(Number(limit) || 100, 500));

		return GameLeaderboard.find({ schoolId: { $ne: 'admin' } })
			.sort({ totalScore: -1, lastSubmissionAt: 1 })
			.limit(size)
			.lean({ virtuals: true })
			.exec();
	},

	/**
	 * Get a leaderboard entry by school ID
	 * @param {string} schoolId - The school identifier
	 * @returns {Object|null} The leaderboard entry or null if not found
	 */
	async getBySchoolId(schoolId) {
		if (!schoolId) return null;
		return GameLeaderboard.findOne({ schoolId: schoolId.trim() })
			.lean({ virtuals: true })
			.exec();
	},

	async resetLeaderboard() {
		return GameLeaderboard.deleteMany({});
	},

	/**
	 * Process consensus scores for "Inside the Box" questions
	 * Score = Time Remaining * Proportion of Teams Selecting Chosen Option
	 */
	async processConsensusScores(round, questionIndex) {
		const answerKey = `answers.round${round}_q${questionIndex}`;

		// 1. Get all answers for this question
		const submissions = await GameLeaderboard.find({
			[answerKey]: { $exists: true }
		}).select(`schoolId ${answerKey}`).lean();

		if (!submissions.length) return { processed: 0 };

		// 2. Calculate consensus
		const totalAnswers = submissions.length;
		const optionCounts = {};

		submissions.forEach(sub => {
			const answer = sub.answers[`round${round}_q${questionIndex}`];
			const optionId = answer.selectedOption;
			optionCounts[optionId] = (optionCounts[optionId] || 0) + 1;
		});

		// 3. Calculate scores for each team and prepare updates
		const scoreUpdates = []; // Track scores to update in-memory store
		const updates = submissions.map(sub => {
			const answer = sub.answers[`round${round}_q${questionIndex}`];
			const optionId = answer.selectedOption;
			const count = optionCounts[optionId] || 0;
			const proportion = count / totalAnswers;

			// Formula: Score = Time Remaining * Proportion
			// answer.remainingTime is in seconds (e.g., 15)
			// proportion is 0.0 to 1.0
			const calculatedScore = Math.round(answer.remainingTime * proportion * 10) / 10;

			// Track for in-memory update
			scoreUpdates.push({ schoolId: sub.schoolId, calculatedScore });

			return {
				updateOne: {
					filter: { schoolId: sub.schoolId },
					update: {
						$inc: { totalScore: calculatedScore },
						$set: {
							[`${answerKey}.consensusProportion`]: proportion,
							[`${answerKey}.calculatedScore`]: calculatedScore,
							[`${answerKey}.processedAt`]: new Date()
						}
					}
				}
			};
		});

		if (updates.length > 0) {
			await GameLeaderboard.bulkWrite(updates);

			// 4. Update in-memory onlineUsers store so mobile app sees updated scores immediately
			for (const { schoolId, calculatedScore } of scoreUpdates) {
				const existingUser = onlineUsers.get(schoolId);
				if (existingUser) {
					onlineUsers.set(schoolId, {
						...existingUser,
						currentScore: (existingUser.currentScore || 0) + calculatedScore,
						totalScore: (existingUser.totalScore || 0) + calculatedScore,
						lastActivity: Date.now(),
					});
					console.log(`[Consensus] Updated in-memory score for ${schoolId}: +${calculatedScore} (total: ${existingUser.totalScore + calculatedScore})`);
				}
			}
		}

		return {
			processed: updates.length,
			totalAnswers,
			optionCounts
		};
	},
	/**
	 * Get summary for a specific round
	 * Returns rankings, MVP, and promotion/demotion candidates
	 */
	async getRoundSummary(roundIndex) {
		const roundKey = `answers.round${roundIndex}`;

		// 1. Fetch all teams that participated in this round
		// We verify participation by checking if they have any answers for this round
		// Since keys are dynamic (q0, q1...), we'll fetch all and filter in memory 
		// or aggregation could be used for better performance with large datasets

		// For now, fetching all leaderboard entries (assuming reasonable number of teams < 500)
		// Filter out admin user (schoolId: 'admin')
		const allTeams = await GameLeaderboard.find({ schoolId: { $ne: 'admin' } }).lean();

		const teamScores = [];

		for (const team of allTeams) {
			let roundScore = 0;
			let questionsAnswered = 0;
			let lastSubmissionTime = 0;

			// Calculate score specifically for this round
			if (team.answers) {
				// Debug: Log answer keys for this team
				const answerKeys = Object.keys(team.answers);
				if (answerKeys.length > 0) {
					console.log(`[Summary Debug] Team ${team.schoolId} has answer keys:`, answerKeys);
				}

				for (const [key, answer] of Object.entries(team.answers)) {
					// Check for both patterns: "round0_q0" and "round0_q0" format
					if (key.startsWith(`round${roundIndex}_q`)) {
						roundScore += (answer.calculatedScore || 0);
						questionsAnswered++;
						// Track last submission for tie-breaking
						if (answer.submittedAt) {
							const subTime = new Date(answer.submittedAt).getTime();
							if (subTime > lastSubmissionTime) {
								lastSubmissionTime = subTime;
							}
						}
					}
				}
			}

			// Only include teams that participated or have a total score > 0 (for accumulated leaderboard)
			// But for Round Summary, we might only want active participants of that round OR all active teams
			if (questionsAnswered > 0 || team.totalScore > 0) {
				// Priority 1: Use roundScores field if available (accurate per-round tracking)
				// Priority 2: Use calculated roundScore from answers
				// Priority 3: Fallback to totalScore approximation for legacy data
				let effectiveRoundScore = roundScore;
				const roundsPlayed = team.roundsPlayed || 0;

				// Check roundScores field first (new accurate tracking)
				if (team.roundScores && team.roundScores[roundIndex.toString()] !== undefined) {
					effectiveRoundScore = team.roundScores[roundIndex.toString()];
				} else if (questionsAnswered === 0) {
					// No answers stored and no roundScores - use fallback logic

					// Only show data for rounds that have actually been played
					// If roundIndex >= roundsPlayed, this round hasn't been completed yet
					if (roundIndex >= roundsPlayed && roundsPlayed > 0) {
						// This round hasn't been played by this team yet - skip
						continue;
					}

					if (team.totalScore > 0 && roundIndex < roundsPlayed) {
						// Fallback: Distribute totalScore across played rounds
						if (roundsPlayed === 1) {
							effectiveRoundScore = team.totalScore;
						} else {
							effectiveRoundScore = Math.round((team.totalScore / roundsPlayed) * 10) / 10;
						}
						console.log(`[Summary] Fallback for ${team.schoolId}: round ${roundIndex}, roundsPlayed ${roundsPlayed}, using ${effectiveRoundScore}`);
					}
				}

				teamScores.push({
					schoolId: team.schoolId,
					schoolName: team.schoolName,
					teamName: team.teamName,
					roundScore: Math.round(effectiveRoundScore * 10) / 10,
					totalScore: team.totalScore, // Cumulative score
					questionsAnswered,
					lastSubmissionTime
				});
			}
		}

		// MERGE with onlineUsers for real-time updates
		// This ensures that scores updated in memory (via mobile app) are reflected immediately
		// even if not yet fully persisted to DB
		for (const [schoolId, user] of onlineUsers.entries()) {
			// Skip admin
			if (schoolId === 'admin' || user.schoolId === 'admin') continue;

			// Check if this user has score for the CURRENT round
			// Note: onlineUsers.currentScore IS the score for the active round
			const currentQuizState = getCurrentQuizState();

			// Only merge if the requested round is the currently active round
			if (currentQuizState.currentRound === roundIndex) {
				const onlineRoundScore = user.currentScore || 0;
				const onlineTotalScore = user.totalScore || 0;

				// Find existing entry in teamScores
				const existingIndex = teamScores.findIndex(t => t.schoolId === schoolId);

				if (existingIndex !== -1) {
					// Update existing entry if online score is available
					// Trust online score for the current round as it's the most "live"
					if (onlineRoundScore > 0) {
						teamScores[existingIndex].roundScore = onlineRoundScore;
						teamScores[existingIndex].totalScore = onlineTotalScore || teamScores[existingIndex].totalScore;
						teamScores[existingIndex].lastSubmissionTime = Math.max(
							teamScores[existingIndex].lastSubmissionTime || 0,
							user.lastActivity || 0
						);
					}
				} else if (onlineRoundScore > 0 || onlineTotalScore > 0) {
					// Add new entry from onlineUsers (team not in DB yet or no answers stored)
					teamScores.push({
						schoolId: user.schoolId,
						schoolName: user.schoolName,
						teamName: user.teamName || user.schoolName,
						roundScore: onlineRoundScore,
						totalScore: onlineTotalScore,
						questionsAnswered: 0, // Unknown from memory store
						lastSubmissionTime: user.lastActivity || Date.now()
					});
				}
			}
		}

		// 2. Sort by Round Score (descending)
		// Tie-breaker: Total Score (descending), then Earliest Last Submission (ascending)
		teamScores.sort((a, b) => {
			if (b.roundScore !== a.roundScore) return b.roundScore - a.roundScore;
			if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
			return a.lastSubmissionTime - b.lastSubmissionTime;
		});

		// 3. Assign Ranks
		teamScores.forEach((team, index) => {
			team.rank = index + 1;
		});

		// 4. Identify MVP (Rank 1)
		const roundMVP = teamScores.length > 0 ? teamScores[0] : null;

		// 5. Identify Promotions/Demotions (Top 3 / Bottom 3)
		// Assuming "Promotions" = Improving teams or Top performers
		// Assuming "Demotions" = Bottom teams
		// LOGIC: Top 3 are "Promoted" (Highlighted green), Bottom 3 are "Relegated" (Highlighted red)
		const promotions = teamScores.slice(0, 3);
		const demotions = teamScores.length > 5 ? teamScores.slice(-3) : []; // Only show demotions if enough teams

		return {
			roundIndex,
			totalTeams: teamScores.length,
			rankings: teamScores,
			mvp: roundMVP,
			promotions,
			demotions
		};
	},

	/**
	 * SUMM-04: Apply tier updates based on round results
	 * Promoted teams get tier incremented (move up)
	 * Demoted teams get tier decremented (move down)
	 * Tier 1 = Top, Tier 2 = Middle, Tier 3 = Bottom (lower is better)
	 */
	async applyTierUpdates(roundIndex) {
		const summary = await this.getRoundSummary(roundIndex);
		const { promotions, demotions } = summary;

		const updates = {
			promoted: 0,
			demoted: 0,
			errors: []
		};

		// Promote top performers (decrease tier number = move up)
		for (const team of promotions) {
			try {
				const result = await GameLeaderboard.findOneAndUpdate(
					{ schoolId: team.schoolId },
					{
						$inc: { tier: -1 },
						$min: { tier: 1 } // Tier cannot go below 1
					},
					{ new: true }
				);
				// Ensure tier doesn't go below 1
				if (result && result.tier < 1) {
					await GameLeaderboard.updateOne(
						{ schoolId: team.schoolId },
						{ $set: { tier: 1 } }
					);
				}
				updates.promoted++;
			} catch (err) {
				updates.errors.push({ schoolId: team.schoolId, error: err.message });
			}
		}

		// Demote bottom performers (increase tier number = move down)
		for (const team of demotions) {
			try {
				await GameLeaderboard.findOneAndUpdate(
					{ schoolId: team.schoolId },
					{
						$inc: { tier: 1 },
						$max: { tier: 3 } // Tier cannot go above 3
					},
					{ new: true }
				);
				updates.demoted++;
			} catch (err) {
				updates.errors.push({ schoolId: team.schoolId, error: err.message });
			}
		}

		return {
			roundIndex,
			...updates,
			summary: {
				promotedTeams: promotions.map(t => t.schoolName),
				demotedTeams: demotions.map(t => t.schoolName)
			}
		};
	},

	/**
	 * SUMM-05: Get final standings for the entire competition
	 * Returns champion, runners-up, and full rankings
	 */
	async getFinalStandings() {
		// Fetch all teams sorted by totalScore (descending), excluding admin
		const allTeams = await GameLeaderboard.find({ schoolId: { $ne: 'admin' } })
			.sort({ totalScore: -1, lastSubmissionAt: 1 })
			.lean();

		if (allTeams.length === 0) {
			return {
				champion: null,
				runnersUp: [],
				fullRankings: [],
				totalTeams: 0
			};
		}

		// Assign ranks
		const rankedTeams = allTeams.map((team, index) => ({
			rank: index + 1,
			schoolId: team.schoolId,
			schoolName: team.schoolName,
			teamName: team.teamName,
			totalScore: team.totalScore || 0,
			roundsPlayed: team.roundsPlayed || 0,
			tier: team.tier || 2
		}));

		return {
			champion: rankedTeams[0] || null,
			runnersUp: rankedTeams.slice(1, 3), // 2nd and 3rd place
			fullRankings: rankedTeams,
			totalTeams: rankedTeams.length
		};
	},
};

