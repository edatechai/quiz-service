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

		// Round 5 (roundIndex = 4) is Sudden Death - only 1 question
		if (round === 4) {
			console.log(`[listByType] Fetching SUDDEN_DEATH question for Round 5`);

			let suddenDeathQuestions = await GameQuestion.find(
				{ questionType: "SUDDEN_DEATH" },
				{ prompt: 1, questionType: 1, options: 1, meta: 1, createdAt: 1 }
			)
				.lean({ virtuals: true });

			// Filter out already-used questions
			suddenDeathQuestions = filterExcluded(suddenDeathQuestions);
			console.log(`[listByType] Found ${suddenDeathQuestions.length} SUDDEN_DEATH questions (after exclusion)`);

			// Return just 1 question for Sudden Death
			if (suddenDeathQuestions.length > 0) {
				return [suddenDeathQuestions[0]];
			}

			// Fallback: if no SUDDEN_DEATH questions exist, return empty
			return [];
		}

		// Round 2 (roundIndex = 1) should only have "Inside the Box" questions
		if (round === 1) {
			console.log(`[listByType] Fetching INSIDE_THE_BOX questions for Round 2`);

			let insideTheBoxQuestions = await GameQuestion.find(
				{ questionType: "INSIDE_THE_BOX" },
				{ prompt: 1, questionType: 1, options: 1, meta: 1, createdAt: 1 }
			)
				.lean({ virtuals: true });

			// Filter out already-used questions
			insideTheBoxQuestions = filterExcluded(insideTheBoxQuestions);
			console.log(`[listByType] Found ${insideTheBoxQuestions.length} INSIDE_THE_BOX questions (after exclusion)`);

			// Shuffle and return up to limit
			const shuffleArray = (array) => {
				const shuffled = [...array];
				for (let i = shuffled.length - 1; i > 0; i--) {
					const j = Math.floor(Math.random() * (i + 1));
					[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
				}
				return shuffled;
			};

			const shuffled = shuffleArray(insideTheBoxQuestions);
			const result = shuffled.slice(0, limit);
			console.log(`[listByType] Returning ${result.length} questions for Round 2`);
			return result;
		}

		// For other rounds, use the mixed approach
		// Get all questions grouped by type
		// IMPORTANT: Exclude SUDDEN_DEATH questions - they should only appear in Round 5
		let allQuestions = await GameQuestion.find(
			{ questionType: { $ne: "SUDDEN_DEATH" } },
			{ prompt: 1, questionType: 1, options: 1, meta: 1, createdAt: 1 }
		)
			.lean({ virtuals: true });

		// Filter out already-used questions
		allQuestions = filterExcluded(allQuestions);
		console.log(`[listByType] Total available questions (after exclusion): ${allQuestions.length}`);

		// Group questions by type
		const questionsByType = new Map();
		allQuestions.forEach((question) => {
			const type = question.questionType || "";
			if (!questionsByType.has(type)) {
				questionsByType.set(type, []);
			}
			questionsByType.get(type).push(question);
		});

		// Shuffle questions within each type
		const shuffleArray = (array) => {
			const shuffled = [...array];
			for (let i = shuffled.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
			}
			return shuffled;
		};

		// Shuffle each type's questions
		for (const [type, questions] of questionsByType.entries()) {
			questionsByType.set(type, shuffleArray(questions));
		}

		const selectedQuestions = [];

		// If we have no questions, return empty array
		if (questionsByType.size === 0) {
			return [];
		}

		// PRIORITY: Always include at least one "Inside the Box" question if available
		const insideTheBoxQuestions = questionsByType.get("INSIDE_THE_BOX");
		if (insideTheBoxQuestions && insideTheBoxQuestions.length > 0) {
			selectedQuestions.push(insideTheBoxQuestions[0]);
			questionsByType.set("INSIDE_THE_BOX", insideTheBoxQuestions.slice(1));
		}

		// Get remaining types (excluding INSIDE_THE_BOX since we already handled it)
		const types = Array.from(questionsByType.keys()).filter(t => t !== "INSIDE_THE_BOX");

		// Fill remaining slots with questions from other types
		while (selectedQuestions.length < limit) {
			let found = false;

			// Try to get a question from any type
			for (const type of types) {
				const questions = questionsByType.get(type);
				if (questions && questions.length > 0) {
					selectedQuestions.push(questions[0]);
					questionsByType.set(type, questions.slice(1));
					found = true;
					break;
				}
			}

			// If no more questions from other types, try INSIDE_THE_BOX again
			if (!found) {
				const insideQuestions = questionsByType.get("INSIDE_THE_BOX");
				if (insideQuestions && insideQuestions.length > 0) {
					selectedQuestions.push(insideQuestions[0]);
					questionsByType.set("INSIDE_THE_BOX", insideQuestions.slice(1));
					found = true;
				}
			}

			// If no more questions available at all, break
			if (!found) {
				break;
			}
		}

		// Shuffle the final selection to mix types (but INSIDE_THE_BOX will always be included)
		return shuffleArray(selectedQuestions);
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

