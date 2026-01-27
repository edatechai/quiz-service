import { GameQuestion } from "../models/gameQuestion.model.js";

const DEFAULT_LIMIT = 10;

export const gameQuestionService = {
	async list({ limit, random } = {}) {
		const finalLimit =
			Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : DEFAULT_LIMIT;

		if (random) {
			const pipeline = [
				{ $sample: { size: finalLimit } },
				{ $project: { prompt: 1, questionType: 1, options: 1, createdAt: 1 } },
			];
			return GameQuestion.aggregate(pipeline);
		}

		return GameQuestion.find({}, { prompt: 1, questionType: 1, options: 1 })
			.sort({ createdAt: -1 })
			.limit(finalLimit)
			.lean({ virtuals: true });
	},

	async listByType({ limit = 5, round = null, excludeIds = [] } = {}) {
		console.log(`[listByType] Called with limit=${limit}, round=${round}, excludeIds count=${excludeIds.length}`);

		// Helper to filter out excluded questions
		const filterExcluded = (questions) => {
			if (!excludeIds || excludeIds.length === 0) return questions;
			const excludeSet = new Set(excludeIds.map(id => id.toString()));
			return questions.filter(q => {
				const qId = q._id?.toString() || q.id?.toString();
				return !excludeSet.has(qId);
			});
		};

		// Shuffle helper
		const shuffleArray = (array) => {
			const shuffled = [...array];
			for (let i = shuffled.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
			}
			return shuffled;
		};

		// Map round index to question type
		// Round 1 (0): ACADEMIC
		// Round 2 (1): OUTSIDE_THE_BOX
		// Round 3 (2): CURRENT_AFFAIRS
		// Round 4 (3): INSIDE_THE_BOX
		// Round 5 (4): SUDDEN_DEATH
		const roundTypeMap = {
			0: "ACADEMIC",
			1: "OUTSIDE_THE_BOX",
			2: "CURRENT_AFFAIRS",
			3: "INSIDE_THE_BOX",
			4: "SUDDEN_DEATH"
		};

		const questionType = roundTypeMap[round] || "ACADEMIC";
		const questionsLimit = round === 4 ? 1 : limit; // Sudden Death only has 1 question

		console.log(`[listByType] Round ${round !== null ? round + 1 : 'N/A'}: Fetching ${questionType} questions (limit: ${questionsLimit})`);

		let questions = await GameQuestion.find(
			{ questionType: questionType },
			{ prompt: 1, questionType: 1, options: 1, meta: 1, createdAt: 1 }
		)
			.lean({ virtuals: true });

		// Filter out already-used questions
		questions = filterExcluded(questions);
		console.log(`[listByType] Found ${questions.length} ${questionType} questions (after exclusion)`);

		// Shuffle and return up to limit
		const shuffled = shuffleArray(questions);
		const result = shuffled.slice(0, questionsLimit);
		console.log(`[listByType] Returning ${result.length} questions for Round ${round !== null ? round + 1 : 'N/A'}`);

		return result;
	},

	async bulkUpsert(questions = []) {
		if (!Array.isArray(questions) || questions.length === 0) {
			return { acknowledged: true, insertedCount: 0 };
		}

		const operations = questions.map((question) => {
			const { prompt } = question;
			return {
				updateOne: {
					filter: { prompt },
					update: {
						$set: {
							questionType: question.questionType || "",
							options: question.options || [],
							meta: question.meta || {},
						},
					},
					upsert: true,
				},
			};
		});

		const result = await GameQuestion.bulkWrite(operations, {
			ordered: false,
		});

		return {
			acknowledged: result.result?.ok === 1,
			insertedCount: result.upsertedCount ?? 0,
			modifiedCount: result.modifiedCount ?? 0,
		};
	},
};

