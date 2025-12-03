import { gameQuestionService } from "../services/gameQuestion.service.js";
import { setCurrentQuestion, getCurrentQuizState as getQuizState, startRound as startRoundInStore, resetQuizState, advanceToNextQuestion, getQuestionTimingInfo } from "../stores/quizState.store.js";
import { checkAndAnswerQuestion, resetAITeamAnswers } from "../services/aiTeamQuiz.service.js";
import { getAIHint } from "../services/aiAssistant.service.js";

const formatOptionsForClient = (options = []) => {
	const labels = ["A", "B", "C", "D", "E", "F"];
	return options.map((option, index) => ({
		id: `${labels[index] || `Option-${index + 1}`}`,
		label: labels[index] || `Option ${index + 1}`,
		text: option.text,
		correctness: option.correctness ?? 0,
	}));
};

export const listGameQuestions = async (req, res, next) => {
	try {
		const { limit, random } = req.query;
		const questionsPerRound = limit ? Number(limit) : 5;

		// Use the new listByType method to get one question from each type
		const questions = await gameQuestionService.listByType({
			limit: questionsPerRound,
		});

		const payload = questions.map((q) => ({
			id: q.id?.toString?.() || q._id?.toString?.(),
			question: q.prompt,
			questionType: q.questionType || "",
			options: formatOptionsForClient(q.options || []),
		}));

		res.json({
			data: {
				count: payload.length,
				questions: payload,
			},
		});
	} catch (error) {
		next(error);
	}
};

// Get current quiz state (current question and round)
export const getCurrentQuizState = async (req, res, next) => {
	try {
		const state = getQuizState();

		// Format question for client if exists
		let formattedQuestion = null;
		if (state.currentQuestion) {
			formattedQuestion = {
				id: state.currentQuestion.id?.toString?.() || state.currentQuestion._id?.toString?.(),
				question: state.currentQuestion.prompt,
				questionType: state.currentQuestion.questionType || "",
				options: formatOptionsForClient(state.currentQuestion.options || []),
			};
		}

		res.json({
			data: {
				currentRound: state.currentRound,
				currentQuestionIndex: state.currentQuestionIndex,
				currentQuestion: formattedQuestion,
				totalQuestionsInRound: state.totalQuestionsInRound || state.roundQuestions?.length || 0,
				isActive: state.isActive,
				roundStarted: state.roundStarted,
				questionTimeRemaining: state.questionTimeRemaining,
				roundComplete: state.roundComplete || false,
			},
		});
	} catch (error) {
		next(error);
	}
};

// Start a round (admin only)
export const startRound = async (req, res, next) => {
	try {
		const { roundIndex } = req.body;

		if (roundIndex === undefined || roundIndex < 0) {
			return res.status(400).json({ message: "roundIndex is required and must be >= 0" });
		}

		// Get current state to check if we can start this round
		const currentState = getQuizState();

		// Enforce sequential round starts - Round N can only start after Round N-1 is COMPLETED
		// A round is completed when all questions have been answered (on or past last question)
		if (roundIndex === 0) {
			// Round 1 can only be started if no round is active
			if (currentState.currentRound !== -1 && currentState.roundStarted) {
				return res.status(400).json({
					message: `Cannot start Round 1. Round ${currentState.currentRound + 1} is currently active. Please wait for it to complete.`
				});
			}
		} else {
			// Round N can only be started if Round N-1 is completed
			const previousRoundIndex = roundIndex - 1;

			// Check if previous round is the current round and if it's completed
			const isPreviousRoundActive = currentState.currentRound === previousRoundIndex && currentState.roundStarted;
			const isPreviousRoundCompleted = isPreviousRoundActive &&
				currentState.roundQuestions.length > 0 &&
				currentState.currentQuestionIndex >= currentState.roundQuestions.length - 1;

			if (!isPreviousRoundCompleted) {
				if (currentState.currentRound < previousRoundIndex) {
					return res.status(400).json({
						message: `Cannot start Round ${roundIndex + 1}. Round ${previousRoundIndex + 1} must be started and completed first.`
					});
				} else if (currentState.currentRound === previousRoundIndex) {
					const questionsCompleted = currentState.currentQuestionIndex + 1;
					const totalQuestions = currentState.roundQuestions.length || 5;
					return res.status(400).json({
						message: `Cannot start Round ${roundIndex + 1}. Round ${previousRoundIndex + 1} is still in progress (Question ${questionsCompleted}/${totalQuestions}). Please wait for all questions to be completed.`
					});
				} else {
					return res.status(400).json({
						message: `Cannot start Round ${roundIndex + 1}. Round ${currentState.currentRound + 1} is currently active.`
					});
				}
			}
		}

		startRoundInStore(roundIndex);

		// Reset AI team answers when starting a new round
		if (roundIndex === 0) {
			resetAITeamAnswers();
		}

		res.json({
			message: `Round ${roundIndex + 1} started successfully`,
			data: getQuizState(),
		});
	} catch (error) {
		next(error);
	}
};

// Update current quiz state (called by mobile app)
export const updateCurrentQuizState = async (req, res, next) => {
	try {
		const { roundIndex, questionIndex, questionId, questions } = req.body;

		if (roundIndex === undefined || questionIndex === undefined) {
			return res.status(400).json({ message: "roundIndex and questionIndex are required" });
		}

		// Get current state to check if we already have questions for this round
		const currentState = getQuizState();

		// Check if we are moving to a new question and if the previous one was "Inside the Box"
		if (currentState.currentQuestion && currentState.currentQuestion.questionType === "INSIDE_THE_BOX") {
			// Trigger consensus scoring for the previous question
			// This is done asynchronously to not block the state update
			gameLeaderboardService.processConsensusScores(currentState.currentRound, currentState.currentQuestionIndex)
				.then(result => {
					console.log(`[Consensus Scoring] Processed ${result.processed} answers for Round ${currentState.currentRound} Question ${currentState.currentQuestionIndex}`);
				})
				.catch(err => {
					console.error("[Consensus Scoring] Error:", err);
				});
		}

		// If questions array is provided, use it
		if (questions && Array.isArray(questions) && questions.length > 0) {
			const question = questions[questionIndex] || null;
			const success = setCurrentQuestion(roundIndex, questionIndex, question, questions);

			if (!success) {
				return res.status(400).json({
					message: `Round ${roundIndex + 1} has not been started yet. Please wait for admin to start the round.`
				});
			}

			// Trigger AI team to answer the question (async, don't wait)
			if (question) {
				checkAndAnswerQuestion().catch((error) => {
					console.error("[AI Team] Error answering question:", error);
				});
			}
		} else if (questionId) {
			// Check if we already have questions stored for this round
			// If so, use the existing questions instead of refetching (which would shuffle again)
			let questionsToUse = currentState.roundQuestions;

			// Only fetch new questions if we don't have any stored OR if this is initialization
			if (!questionsToUse || questionsToUse.length === 0 || questionId === 'init') {
				console.log(`[Question Fetch] Fetching questions for Round ${roundIndex + 1} (roundIndex: ${roundIndex})`);
				questionsToUse = await gameQuestionService.listByType({
					limit: 5,
					round: roundIndex // Pass the round to get round-specific questions
				});
				console.log(`[Question Fetch] Got ${questionsToUse.length} questions:`, questionsToUse.map(q => `${q.questionType}: ${q.prompt.substring(0, 30)}...`));
			}

			const question = questionsToUse[questionIndex] || null;
			if (question) {
				console.log(`[Question Display] Round ${roundIndex + 1}, Question ${questionIndex + 1}: Type="${question.questionType}", Prompt="${question.prompt.substring(0, 50)}..."`);
			}

			const success = setCurrentQuestion(roundIndex, questionIndex, question, questionsToUse);

			if (!success) {
				return res.status(400).json({
					message: `Round ${roundIndex + 1} has not been started yet. Please wait for admin to start the round.`
				});
			}

			// Trigger AI team to answer the question (async, don't wait)
			if (question) {
				checkAndAnswerQuestion().catch((error) => {
					console.error("[AI Team] Error answering question:", error);
				});
			}
		} else {
			// Just update indices without question data
			// Use existing questions if available
			let questionsToUse = currentState.roundQuestions || [];
			const question = questionsToUse[questionIndex] || null;

			const success = setCurrentQuestion(roundIndex, questionIndex, question, questionsToUse);

			if (!success) {
				return res.status(400).json({
					message: `Round ${roundIndex + 1} has not been started yet. Please wait for admin to start the round.`
				});
			}
		}

		res.json({
			message: "Quiz state updated successfully",
			data: getQuizState(),
		});
	} catch (error) {
		next(error);
	}
};

// Reset quiz state (admin only)
import { gameLeaderboardService } from "../services/gameLeaderboard.service.js";
import { onlineUsers } from "../stores/onlineUsers.store.js";

// ... existing imports ...

// Reset quiz state (admin only)
export const resetQuiz = async (req, res, next) => {
	try {
		// 1. Reset quiz flow state
		resetQuizState();

		// 2. Reset AI team answers tracking
		resetAITeamAnswers();

		// 3. Clear all leaderboard data from database
		await gameLeaderboardService.resetLeaderboard();

		// 4. Reset scores for online users (keep them online)
		for (const [schoolId, user] of onlineUsers.entries()) {
			onlineUsers.set(schoolId, {
				...user,
				currentScore: 0,
				lastScore: 0,
				totalScore: 0,
				// Keep lastActivity to maintain online status
			});
		}

		res.json({
			message: "Quiz state and leaderboard reset successfully",
			data: getQuizState(),
		});
	} catch (error) {
		next(error);
	}
};

// Get AI hint for current question
export const getQuestionHint = async (req, res, next) => {
	try {
		const state = getQuizState();

		if (!state.currentQuestion) {
			return res.status(400).json({
				message: "No active question available"
			});
		}

		// Format question and options
		const questionText = state.currentQuestion.prompt || state.currentQuestion.question || "";
		const labels = ["A", "B", "C", "D", "E", "F"];
		const options = (state.currentQuestion.options || []).map((option, index) => {
			if (typeof option === "string") {
				return {
					id: `${labels[index] || `Option-${index + 1}`}`,
					label: labels[index] || `Option ${index + 1}`,
					text: option,
				};
			}
			return {
				id: option.id || `${labels[index] || `Option-${index + 1}`}`,
				label: option.label || labels[index] || `Option ${index + 1}`,
				text: option.text || option,
			};
		});

		// Get hint from AI assistant
		const result = await getAIHint(
			questionText,
			options,
			state.currentQuestion.meta?.image || null,
			state.currentQuestion.meta?.audio || null
		);

		if (!result.success) {
			return res.status(500).json({
				message: result.error || "Failed to get hint",
			});
		}

		res.json({
			message: "Hint retrieved successfully",
			data: {
				hint: result.hint,
			},
		});
	} catch (error) {
		next(error);
	}
};

/**
 * Submit answer for the current question
 * Academic/Partial Score Calculation:
 * Score = correctness_score × remaining_time
 * 
 * GAME-08: Uses atomic database operations for score updates
 * This ensures concurrent submissions from different teams don't cause data loss
 * 
 * Example: If correctness = 1.0 and 15 seconds remaining out of 30:
 * Score = 1.0 × 15 = 15 points
 */
export const submitAnswer = async (req, res, next) => {
	try {
		const { schoolId, schoolName, selectedOptionId } = req.body;

		if (!schoolId || !selectedOptionId) {
			return res.status(400).json({
				message: "schoolId and selectedOptionId are required"
			});
		}

		const state = getQuizState();
		const timingInfo = getQuestionTimingInfo();

		if (!state.currentQuestion) {
			return res.status(400).json({
				message: "No active question to answer"
			});
		}

		// GAME-07: Check if already answered (Answer Lock After Submission)
		const alreadyAnswered = await gameLeaderboardService.hasAnswered(
			schoolId,
			state.currentRound,
			state.currentQuestionIndex
		);

		if (alreadyAnswered) {
			return res.status(409).json({
				message: "You have already submitted an answer for this question",
				code: "DUPLICATE_SUBMISSION"
			});
		}

		// Find the selected option
		const options = state.currentQuestion.options || [];
		const selectedOption = options.find((opt, index) => {
			const labels = ["A", "B", "C", "D", "E", "F"];
			const optionId = labels[index] || `Option-${index + 1}`;
			return optionId === selectedOptionId || opt.id === selectedOptionId;
		});

		if (!selectedOption) {
			return res.status(400).json({
				message: `Invalid option selected: ${selectedOptionId}`
			});
		}

		// Get correctness score (normalized to 0-1 scale)
		// If correctness is stored as points (e.g., 3 for full points), normalize it
		// Assuming max correctness value is 3 (based on existing data)
		const maxCorrectness = 3;
		const rawCorrectness = Number(selectedOption.correctness ?? 0);
		const correctnessScore = rawCorrectness / maxCorrectness; // Normalize to 0-1

		// Calculate time-based score
		// Score = correctness_score × remaining_time
		const allocatedTime = timingInfo.allocatedSeconds;
		const remainingTime = timingInfo.remainingSeconds;
		const timeTaken = allocatedTime - remainingTime;

		let calculatedScore = 0;
		let isDeferred = false;

		if (state.currentQuestion.questionType === "INSIDE_THE_BOX") {
			// Deferred scoring for Inside the Box
			// Score will be calculated when the question ends
			calculatedScore = 0;
			isDeferred = true;
		} else {
			// Academic scoring formula: correctness × remaining_time
			calculatedScore = Math.round(correctnessScore * remainingTime * 10) / 10; // Round to 1 decimal
		}

		// GAME-08: Use atomic increment for database update
		// This ensures concurrent submissions don't overwrite each other
		const dbResult = await gameLeaderboardService.incrementScore({
			schoolId,
			schoolName: schoolName || "Unknown",
			teamName: schoolName || "Unknown",
			scoreDelta: calculatedScore,
			round: state.currentRound,
			questionIndex: state.currentQuestionIndex,
			answerRecord: {
				questionId: state.currentQuestion._id?.toString() || state.currentQuestion.id,
				questionPrompt: state.currentQuestion.prompt?.substring(0, 100) || "",
				selectedOption: selectedOptionId,
				correctnessScore,
				remainingTime,
				timeTaken,
				calculatedScore,
				isDeferred,
			}
		});

		// Handle duplicate submission (caught by atomic operation)
		if (!dbResult.success && dbResult.reason === "DUPLICATE_SUBMISSION") {
			return res.status(409).json({
				message: dbResult.message,
				code: "DUPLICATE_SUBMISSION"
			});
		}

		// Update in-memory onlineUsers (for real-time leaderboard display)
		const existingUser = onlineUsers.get(schoolId);
		const currentRoundScore = (existingUser?.currentScore || 0) + calculatedScore;
		const totalScore = dbResult.data?.totalScore || (existingUser?.totalScore || 0) + calculatedScore;

		onlineUsers.set(schoolId, {
			...(existingUser || {}),
			schoolId,
			schoolName: schoolName || existingUser?.schoolName || "Unknown",
			currentScore: currentRoundScore,
			totalScore: totalScore,
			lastActivity: Date.now(),
		});

		res.json({
			message: "Answer submitted successfully",
			data: {
				selectedOption: selectedOptionId,
				correctnessScore,
				allocatedTime,
				timeTaken,
				remainingTime,
				calculatedScore,
				formula: `${correctnessScore.toFixed(2)} × ${remainingTime} = ${calculatedScore}`,
				roundScore: currentRoundScore,
				totalScore,
				isCorrect: rawCorrectness === maxCorrectness,
			},
		});
	} catch (error) {
		next(error);
	}
};
