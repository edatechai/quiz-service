import { getAITeamAnswer, calculateScore } from "./aiTeam.service.js";
import { onlineUsers, AI_TEAM_ID } from "../stores/onlineUsers.store.js";
import { getCurrentQuizState } from "../stores/quizState.store.js";
import { gameLeaderboardService } from "./gameLeaderboard.service.js";

// Track which questions the AI team has already answered to avoid duplicates
const answeredQuestions = new Set();

/**
 * Generate a unique key for a question to track if it's been answered
 */
function getQuestionKey(roundIndex, questionIndex, questionId) {
	return `${roundIndex}-${questionIndex}-${questionId || "unknown"}`;
}

/**
 * Process AI team's answer for a question and update scores
 */
async function processAITeamAnswer(question, options, roundIndex, questionIndex) {
	const questionId = question.id?.toString() || question._id?.toString() || "";
	const questionKey = getQuestionKey(roundIndex, questionIndex, questionId);

	// Skip if already answered
	if (answeredQuestions.has(questionKey)) {
		console.log(`[AI Team] Question ${questionKey} already answered, skipping`);
		return;
	}

	const questionText = question.prompt || question.question || "";
	console.log(`[AI Team] Processing question: ${questionText.substring(0, 50)}...`);

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
			// Still mark as answered to avoid retrying
			answeredQuestions.add(questionKey);
			return;
		}

		// Calculate score based on correctness
		const pointsEarned = calculateScore(aiResult.selectedOption);
		const aiUser = onlineUsers.get(AI_TEAM_ID);

		if (!aiUser) {
			console.error(`[AI Team] AI user not found in onlineUsers`);
			return;
		}

		// Update AI team's current score for this round
		const currentRoundScore = (aiUser.currentScore || 0) + pointsEarned;
		const totalScore = (aiUser.totalScore || 0) + pointsEarned;

		// Update onlineUsers
		onlineUsers.set(AI_TEAM_ID, {
			...aiUser,
			currentScore: currentRoundScore,
			totalScore: totalScore,
			lastActivity: Date.now(),
		});

		// Submit to leaderboard (persist to database)
		await gameLeaderboardService.recordScore({
			schoolId: AI_TEAM_ID,
			schoolName: "Edat AI Team",
			teamName: "Edat AI Team",
			score: totalScore,
			roundsPlayed: roundIndex + 1,
			meta: {
				lastQuestion: questionText.substring(0, 100),
				lastAnswer: aiResult.rawResponse?.substring(0, 200) || "",
				pointsEarned,
				questionIndex,
				roundIndex,
			},
		});

		console.log(
			`[AI Team] Answered question. Points: ${pointsEarned}, Total: ${totalScore}, Selected: ${aiResult.selectedOption.label || aiResult.selectedOption.id}`
		);

		// Mark as answered
		answeredQuestions.add(questionKey);
	} catch (error) {
		console.error(`[AI Team] Error processing answer:`, error);
		// Mark as answered to avoid infinite retries
		answeredQuestions.add(questionKey);
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

		// Process AI team's answer
		await processAITeamAnswer(
			state.currentQuestion,
			options,
			state.currentRound,
			state.currentQuestionIndex
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
	console.log("[AI Team] Reset answered questions tracking");
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

	console.log(`[AI Team] Started polling every ${intervalMs}ms`);
}

/**
 * Stop polling for questions
 */
export function stopAITeamPolling() {
	if (pollingInterval) {
		clearInterval(pollingInterval);
		pollingInterval = null;
		console.log("[AI Team] Stopped polling");
	}
}

