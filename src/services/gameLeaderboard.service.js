import { GameLeaderboard } from "../models/gameLeaderboard.model.js";

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
	 */
	async recordScore(payload) {
		const { errors, value } = sanitizeScorePayload(payload);
		if (errors.length) {
			const err = new Error(errors.join(", "));
			err.status = 400;
			throw err;
		}

		const update = {
			schoolName: value.schoolName,
			teamName: value.teamName,
			totalScore: value.totalScore,
			roundsPlayed: value.roundsPlayed,
			meta: value.meta,
			lastSubmissionAt: new Date(),
		};

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

		// Use atomic $inc and $set operations
		// The $inc operator atomically increments the score
		// The $set on answers prevents duplicate submissions
		const result = await GameLeaderboard.findOneAndUpdate(
			{
				schoolId: schoolId.trim(),
				// Only update if this answer hasn't been submitted yet
				[answerKey]: { $exists: false }
			},
			{
				$inc: { totalScore: numericDelta },
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

		return GameLeaderboard.find()
			.sort({ totalScore: -1, lastSubmissionAt: 1 })
			.limit(size)
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

		// 3. Update scores for each team
		const updates = submissions.map(sub => {
			const answer = sub.answers[`round${round}_q${questionIndex}`];
			const optionId = answer.selectedOption;
			const count = optionCounts[optionId] || 0;
			const proportion = count / totalAnswers;

			// Formula: Score = Time Remaining * Proportion
			// answer.remainingTime is in seconds (e.g., 15)
			// proportion is 0.0 to 1.0
			const calculatedScore = Math.round(answer.remainingTime * proportion * 10) / 10;

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
		}

		return {
			processed: updates.length,
			totalAnswers,
			optionCounts
		};
	},
};

