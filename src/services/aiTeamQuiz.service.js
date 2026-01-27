import { getAITeamAnswer, calculateScore } from "./aiTeam.service.js";
import { onlineUsers, AI_TEAM_ID } from "../stores/onlineUsers.store.js";
import { getCurrentQuizState, getRoundQuestions } from "../stores/quizState.store.js";
import { gameLeaderboardService } from "./gameLeaderboard.service.js";
import { recordRoundSubmission } from "../stores/quizState.store.js";

// Track which questions the AI team has already answered to avoid duplicates
const answeredQuestions = new Set();

// Buffer to store answers for batch submission at round end
let roundAnswersBuffer = [];
let currentBufferedRound = -1;

/**
 * Generate a unique key for a question to track if it's been answered
 */
function getQuestionKey(roundIndex, questionIndex, questionId) {
	return `${roundIndex}-${questionIndex}-${questionId || "unknown"}`;
}

/**
 * Submit buffered answers for a round (batch submission)
 */
async function submitRoundAnswers(roundIndex) {
	if (roundAnswersBuffer.length === 0) {
		// console.log(`[AI Team] No answers to submit for round ${roundIndex + 1}`);
		return;
	}

	const aiUser = onlineUsers.get(AI_TEAM_ID);
	if (!aiUser) {
		console.error(`[AI Team] AI user not found in onlineUsers`);
		return;
	}

	// Calculate total round score
	const roundTotalScore = roundAnswersBuffer.reduce((sum, a) => sum + a.localScore, 0);
	const newTotalScore = (aiUser.totalScore || 0) + roundTotalScore;

	// Update onlineUsers
	onlineUsers.set(AI_TEAM_ID, {
		...aiUser,
		currentScore: roundTotalScore,
		totalScore: newTotalScore,
		lastActivity: Date.now(),
	});

	// Record the batch submission
	recordRoundSubmission(AI_TEAM_ID, roundAnswersBuffer);

	// Submit to leaderboard (persist to database)
	await gameLeaderboardService.recordScore({
		schoolId: AI_TEAM_ID,
		schoolName: "Edat AI Team",
		score: roundTotalScore,
		meta: {
			roundIndex,
			batchSubmission: true,
			answerCount: roundAnswersBuffer.length,
			submittedAt: new Date().toISOString(),
		},
	});

	// CRITICAL: For Inside the Box (Round 4, roundIndex=3), store answers for consensus scoring
	// This ensures AI Team's choices are included in the proportion calculation
	if (roundIndex === 3) {
		try {
			const { GameLeaderboard } = await import("../models/gameLeaderboard.model.js");

			const answerUpdates = {};
			for (const answer of roundAnswersBuffer) {
				const answerKey = `answers.round${roundIndex}_q${answer.questionIndex}`;
				answerUpdates[answerKey] = {
					selectedOption: answer.selectedOptionId,
					remainingTime: answer.remainingTime,
					optionScore: 10, // Default base score for consensus calculation
					submittedAt: new Date(),
				};
			}

			await GameLeaderboard.findOneAndUpdate(
				{ schoolId: AI_TEAM_ID },
				{ $set: answerUpdates },
				{ upsert: true }
			);
			console.log(`[AI Team] Stored ${Object.keys(answerUpdates).length} Inside the Box answers for consensus scoring`);
		} catch (err) {
			console.error(`[AI Team] Error storing Inside the Box answers:`, err.message);
		}
	}

	// console.log(
	// 	`[AI Team Batch] Submitted round ${roundIndex + 1}: ${roundAnswersBuffer.length} answers, score: ${roundTotalScore}, total: ${newTotalScore}`
	// );

	// Clear buffer for next round
	roundAnswersBuffer = [];
	currentBufferedRound = -1;
}


/**
 * Process AI team's answer for a question and store in buffer
 */
async function processAITeamAnswer(question, options, roundIndex, questionIndex, totalQuestionsInRound) {
	const questionId = question.id?.toString() || question._id?.toString() || "";
	const questionKey = getQuestionKey(roundIndex, questionIndex, questionId);

	// Skip if already answered (no log to reduce noise)
	if (answeredQuestions.has(questionKey)) {
		return;
	}

	// If this is a new round, clear the buffer
	if (currentBufferedRound !== roundIndex) {
		roundAnswersBuffer = [];
		currentBufferedRound = roundIndex;
	}

	const questionText = question.prompt || question.question || "";
	// console.log(`[AI Team] Processing question: ${questionText.substring(0, 50)}...`);

	// Mark as answered IMMEDIATELY to prevent race conditions from parallel polling
	answeredQuestions.add(questionKey);

	try {
		// Add a small delay to make AI response more realistic (1-3 seconds)
		const thinkTime = 1000 + Math.random() * 2000;
		await new Promise((resolve) => setTimeout(resolve, thinkTime));

		// Get AI team's answer
		const aiResult = await getAITeamAnswer(
			questionText,
			options,
			question.meta?.image || null,
			question.meta?.audio || null
		);

		if (!aiResult.success || !aiResult.selectedOption) {
			if (aiResult.error === "DEEPSEEK_API_KEY is not configured") {
				console.warn(`[AI Team] API key not configured. Skipping question.`);
			} else {
				console.error(`[AI Team] Failed to get answer:`, aiResult.error);
			}
			// Already marked as answered at start
			return;
		}

		// Use llm_response_time and llm_score from question data for AI scoring
		// User request: Use pre-calculated llm_score directly, do not multiply by time
		const llmResponseTime = question.meta?.llm_response_time ?? question.llm_response_time ?? 5;
		const llmScore = question.meta?.llm_score ?? question.llm_score ?? aiResult.selectedOption?.score ?? aiResult.selectedOption?.correctness ?? 0;
		// const localScore = Math.round(llmScore * llmResponseTime * 10) / 10;
		const localScore = Number(llmScore); // Use pre-calculated score directly
		const remainingTime = llmResponseTime;

		// Store answer in buffer (not submitting yet)
		roundAnswersBuffer.push({
			questionIndex,
			selectedOptionId: aiResult.selectedOption.label || aiResult.selectedOption.id,
			remainingTime,
			localScore,
		});

		console.log(
			`[AI Team] Q${questionIndex + 1}: llm_score=${llmScore} (pre-calculated) = ${localScore} pts (${roundAnswersBuffer.length}/${totalQuestionsInRound} stored)`
		);

		// Check if this was the last question in the round - submit batch
		if (questionIndex >= totalQuestionsInRound - 1) {
			// console.log(`[AI Team] Last question answered, submitting batch for round ${roundIndex + 1}`);
			await submitRoundAnswers(roundIndex);
		}
	} catch (error) {
		console.error(`[AI Team] Error processing answer:`, error);
		// Already marked as answered at start, no need to re-add
	}
}

/**
 * Check current quiz state and answer question if needed
 * This should be called periodically or when quiz state changes
 */
export async function checkAndAnswerQuestion() {
	try {
		const state = getCurrentQuizState();

		// Only process if there's an active question
		if (
			!state.isActive ||
			!state.roundStarted ||
			!state.currentQuestion ||
			state.currentRound < 0
		) {
			return;
		}

		// Format options for AI service
		// Handle both raw database format and formatted client format
		const labels = ["A", "B", "C", "D", "E", "F"];
		const rawOptions = state.currentQuestion.options || [];
		const options = rawOptions.map((option, index) => {
			// Option might already be formatted (from client) or raw (from database)
			if (typeof option === "string") {
				return {
					id: `${labels[index] || `Option-${index + 1}`}`,
					label: labels[index] || `Option ${index + 1}`,
					text: option,
					correctness: 0,
				};
			}
			return {
				id: option.id || `${labels[index] || `Option-${index + 1}`}`,
				label: option.label || labels[index] || `Option ${index + 1}`,
				text: option.text || option,
				correctness: option.correctness ?? 0,
			};
		});

		// Process AI team's answer (stores in buffer)
		await processAITeamAnswer(
			state.currentQuestion,
			options,
			state.currentRound,
			state.currentQuestionIndex,
			state.totalQuestionsInRound
		);
	} catch (error) {
		console.error(`[AI Team] Error in checkAndAnswerQuestion:`, error);
	}
}

/**
 * Reset answered questions (useful when starting a new quiz)
 */
export function resetAITeamAnswers() {
	answeredQuestions.clear();
	roundAnswersBuffer = [];
	currentBufferedRound = -1;
	// console.log("[AI Team] Reset answered questions tracking");
}

/**
 * Start polling for questions (call this when quiz starts)
 */
let pollingInterval = null;

export function startAITeamPolling(intervalMs = 3000) {
	// Stop existing polling if any
	if (pollingInterval) {
		clearInterval(pollingInterval);
	}

	// Start polling for new questions
	pollingInterval = setInterval(() => {
		checkAndAnswerQuestion().catch((error) => {
			console.error("[AI Team] Polling error:", error);
		});
	}, intervalMs);

	// console.log(`[AI Team] Started polling every ${intervalMs}ms`);
}

/**
 * Stop polling for questions
 */
export function stopAITeamPolling() {
	if (pollingInterval) {
		clearInterval(pollingInterval);
		pollingInterval = null;
		// console.log("[AI Team] Stopped polling");
	}
}

