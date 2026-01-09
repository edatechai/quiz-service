import { gameQuestionService } from "../services/gameQuestion.service.js";
import { GameQuestion } from "../models/gameQuestion.model.js";
import { setCurrentQuestion, getCurrentQuizState as getQuizState, startRound as startRoundInStore, resetQuizState, advanceToNextQuestion, getQuestionTimingInfo, setQuestionDuration, setGlobalTimeLimitOverride, quizStateStore, getRoundQuestions, getUsedQuestionIds } from "../stores/quizState.store.js";
import { checkAndAnswerQuestion, resetAITeamAnswers } from "../services/aiTeamQuiz.service.js";
import { getAIHint } from "../services/aiAssistant.service.js";
import { publishAnnouncement, getActiveAnnouncements, clearAnnouncementById, clearAllAnnouncements } from "../stores/announcement.store.js";
import { getQuizSettings, updateQuizSettings } from "../models/quizSettings.model.js";
import { emitQuizEvent, QUIZ_EVENTS } from "../services/socket.service.js";


const formatOptionsForClient = (options = []) => {
	const labels = ["A", "B", "C", "D", "E", "F"];
	return options.map((option, index) => ({
		id: `${labels[index] || `Option-${index + 1}`}`,
		label: labels[index] || `Option ${index + 1}`,
		text: option.text,
		correctness: option.correctness ?? 0,
		score: option.score ?? option.correctness ?? 0, // Original score for 50/50 elimination
	}));
};

// DEBUG: Check question types in database
export const debugQuestionTypes = async (req, res, next) => {
	try {
		const types = await GameQuestion.distinct('questionType');
		const counts = {};
		for (const type of types) {
			counts[type] = await GameQuestion.countDocuments({ questionType: type });
		}
		
		// Check specifically for SUDDEN_DEATH
		const suddenDeath = await GameQuestion.find({ questionType: 'SUDDEN_DEATH' }).lean();
		
		res.json({
			types,
			counts,
			suddenDeathCount: suddenDeath.length,
			suddenDeathQuestions: suddenDeath.map(q => ({
				id: q._id,
				prompt: q.prompt?.substring(0, 50),
				questionType: q.questionType,
				hasOptions: (q.options?.length || 0) > 0
			}))
		});
	} catch (error) {
		next(error);
	}
};

export const listGameQuestions = async (req, res, next) => {
	try {
		const { limit, random, round } = req.query;
		const questionsPerRound = limit ? Number(limit) : 5;
		const roundIndex = round !== undefined ? Number(round) : null;

		// Get settings to check for global time limit override
		const settings = await getQuizSettings();
		// Convert to plain object and handle null/undefined properly
		const settingsObj = settings.toObject ? settings.toObject() : settings;
		const globalTimeLimitOverride = (settingsObj.globalTimeLimitOverride !== undefined && settingsObj.globalTimeLimitOverride !== null && !isNaN(Number(settingsObj.globalTimeLimitOverride)))
			? Number(settingsObj.globalTimeLimitOverride)
			: null;
		
		console.log(`[listGameQuestions] Settings loaded - globalTimeLimitOverride: ${globalTimeLimitOverride} (raw: ${settingsObj.globalTimeLimitOverride}, type: ${typeof settingsObj.globalTimeLimitOverride})`);
		
		if (globalTimeLimitOverride !== null && globalTimeLimitOverride !== undefined) {
			console.log(`[listGameQuestions] ✅ Global time limit override is ACTIVE: ${globalTimeLimitOverride} seconds`);
		} else {
			console.log(`[listGameQuestions] ❌ No global time limit override (using question's timeLimit)`);
		}

		// IMPORTANT: Use stored questions if round is active to ensure all users get the same questions
		const currentState = getQuizState();
		let questions;
		
		console.log(`[listGameQuestions] 📋 Requested round: ${roundIndex}, Current round: ${currentState.currentRound}, Round started: ${currentState.roundStarted}, Stored questions: ${currentState.roundQuestions?.length || 0}`);
		
		if (currentState.roundStarted && 
			currentState.currentRound === roundIndex && 
			currentState.roundQuestions && 
			currentState.roundQuestions.length > 0) {
			// Use pre-fetched questions from round start - ensures consistency across all users
			questions = currentState.roundQuestions;
			console.log(`[listGameQuestions] ✅ Using ${questions.length} pre-stored questions for Round ${roundIndex + 1}`);
			console.log(`[listGameQuestions] ✅ Question IDs: ${questions.map(q => q._id || q.id).join(', ')}`);
		} else {
			// Fallback: fetch fresh questions (only happens if round not started or different round requested)
			console.log(`[listGameQuestions] ⚠️ FALLBACK: Fetching fresh questions (round mismatch or not started)`);
			console.log(`[listGameQuestions] ⚠️ Condition check: roundStarted=${currentState.roundStarted}, currentRound=${currentState.currentRound}, requestedRound=${roundIndex}, storedCount=${currentState.roundQuestions?.length}`);
			questions = await gameQuestionService.listByType({
				limit: questionsPerRound,
				round: roundIndex,
			});
			console.log(`[listGameQuestions] ⚠️ Fetched ${questions.length} FRESH questions for Round ${roundIndex !== null ? roundIndex + 1 : 'N/A'}`);
		}

		const payload = questions.map((q) => {
			// Determine timeLimit: use override if set, otherwise use question's timeLimit, fallback to 60
			const questionTimeLimit = q.meta?.timeLimit || 60;
			// Check if override exists and is a valid number
			const hasOverride = globalTimeLimitOverride !== null && globalTimeLimitOverride !== undefined && !isNaN(Number(globalTimeLimitOverride));
			const effectiveTimeLimit = hasOverride 
				? Number(globalTimeLimitOverride)
				: questionTimeLimit;
			
			if (hasOverride) {
				console.log(`[listGameQuestions] ✅ Question ${q.id}: Override applied (${questionTimeLimit}s → ${effectiveTimeLimit}s)`);
			} else {
				console.log(`[listGameQuestions] Question ${q.id}: Using question timeLimit (${questionTimeLimit}s)`);
			}

			return {
				id: q.id?.toString?.() || q._id?.toString?.(),
				question: q.prompt,
				questionType: q.questionType || "",
				options: formatOptionsForClient(q.options || []),
				timeLimit: effectiveTimeLimit, // Apply override if set
				hint: q.meta?.hint || null, // Pre-determined hint for Digital Oracle
				llm_response: q.meta?.llm_response || null, // AI's answer letter
				llm_rationale: q.meta?.llm_rationale || null, // AI's explanation
				llm_correctness: q.meta?.llm_correctness ?? null, // AI's correctness score
				llm_response_time: q.meta?.llm_response_time ?? null, // AI's response time
				llm_score: q.meta?.llm_score ?? null, // AI's score
				// Sudden Death specific fields
				imageUri: q.meta?.imageUri || null, // Image URI for Sudden Death
				isSuddenDeath: q.meta?.isSuddenDeath || false, // Flag for Sudden Death question
			};
		});

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
		
		// Get settings to check for global time limit override
		const settings = await getQuizSettings();
		// Convert to plain object and handle null/undefined properly
		const settingsObj = settings.toObject ? settings.toObject() : settings;
		const globalTimeLimitOverride = (settingsObj.globalTimeLimitOverride !== undefined && settingsObj.globalTimeLimitOverride !== null && !isNaN(Number(settingsObj.globalTimeLimitOverride)))
			? Number(settingsObj.globalTimeLimitOverride)
			: null;
		
		console.log(`[getCurrentQuizState] Settings loaded - globalTimeLimitOverride: ${globalTimeLimitOverride} (raw: ${settingsObj.globalTimeLimitOverride}, type: ${typeof settingsObj.globalTimeLimitOverride})`);
		
		if (globalTimeLimitOverride !== null && globalTimeLimitOverride !== undefined) {
			console.log(`[getCurrentQuizState] ✅ Global time limit override is ACTIVE: ${globalTimeLimitOverride} seconds`);
		} else {
			console.log(`[getCurrentQuizState] ❌ No global time limit override (using question's timeLimit)`);
		}

		// Format question for client if exists
		let formattedQuestion = null;
		if (state.currentQuestion) {
			// Determine timeLimit: use override if set, otherwise use question's timeLimit, fallback to global duration
			const questionTimeLimit = state.currentQuestion.meta?.timeLimit || Math.floor(state.questionDuration / 1000) || 60;
			// Check if override exists and is a valid number
			const hasOverride = globalTimeLimitOverride !== null && globalTimeLimitOverride !== undefined && !isNaN(Number(globalTimeLimitOverride));
			const effectiveTimeLimit = hasOverride 
				? Number(globalTimeLimitOverride)
				: questionTimeLimit;
			
			if (hasOverride) {
				console.log(`[getCurrentQuizState] ✅ Question ${state.currentQuestion.id}: Override applied (${questionTimeLimit}s → ${effectiveTimeLimit}s)`);
			} else {
				console.log(`[getCurrentQuizState] Question ${state.currentQuestion.id}: Using question timeLimit (${questionTimeLimit}s)`);
			}
			
			formattedQuestion = {
				id: state.currentQuestion.id?.toString?.() || state.currentQuestion._id?.toString?.(),
				question: state.currentQuestion.prompt,
				questionType: state.currentQuestion.questionType || "",
				options: formatOptionsForClient(state.currentQuestion.options || []),
				// Use override if set, otherwise use per-question timeLimit, fallback to global duration
				timeLimit: effectiveTimeLimit,
			};
		}

		// Calculate effective question duration (same logic as above)
		const questionTimeLimit = state.currentQuestion?.meta?.timeLimit || Math.floor(state.questionDuration / 1000) || 60;
		const hasOverride = globalTimeLimitOverride !== null && globalTimeLimitOverride !== undefined && !isNaN(Number(globalTimeLimitOverride));
		const effectiveQuestionDuration = hasOverride 
			? Number(globalTimeLimitOverride)
			: questionTimeLimit;

		// If auto-advanced, emit WebSocket event so all clients sync together
		if (state.autoAdvanced) {
			emitQuizEvent(QUIZ_EVENTS.QUESTION_ADVANCED, {
				roundIndex: state.currentRound,
				questionIndex: state.currentQuestionIndex,
				questionTimeRemaining: state.questionTimeRemaining,
				questionDuration: effectiveQuestionDuration,
				totalQuestionsInRound: state.totalQuestionsInRound || state.roundQuestions?.length || 0,
			});
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
				// Use override if set, otherwise use per-question timeLimit, fallback to global duration
				questionDuration: effectiveQuestionDuration,
				globalTimeLimitOverride: globalTimeLimitOverride, // Include override in response
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
			// Round 1 can only be started if no round is active OR Round 5 just finished
			const isAfterRound5 = currentState.currentRound === 4;
			if (currentState.currentRound !== -1 && currentState.roundStarted && !isAfterRound5) {
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

		// IMPORTANT: Fetch and shuffle questions ONCE when starting the round
		// This ensures all users get the same questions in the same order
		// Pass excludeIds to prevent question repetition across rounds
		const usedIds = getUsedQuestionIds();
		console.log(`[startRound] Fetching questions for Round ${roundIndex + 1}, excluding ${usedIds.length} already-used questions...`);
		const questions = await gameQuestionService.listByType({
			limit: 5,
			round: roundIndex,
			excludeIds: usedIds,
		});
		console.log(`[startRound] Loaded ${questions.length} questions for Round ${roundIndex + 1}`);

		// Start round with pre-fetched questions
		startRoundInStore(roundIndex, questions);

		// Reset AI team answers when starting a new round
		if (roundIndex === 0) {
			resetAITeamAnswers();
		}

		// Get updated state for response and WebSocket (after round started)
		const updatedRoundState = getQuizState();

		// Emit WebSocket event for real-time sync
		emitQuizEvent(QUIZ_EVENTS.ROUND_STARTED, {
			roundIndex,
			currentQuestionIndex: 0,
			questionTimeRemaining: updatedRoundState.questionTimeRemaining,
			questionDuration: updatedRoundState.questionDuration,
			totalQuestionsInRound: questions.length,
		});

		res.json({
			message: `Round ${roundIndex + 1} started successfully`,
			data: updatedRoundState,
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

		// Handle reset request (roundIndex = -1 means return to inactive state)
		if (roundIndex === -1) {
			console.log("[Quiz State] Resetting to inactive state (all rounds completed)");
			// Use the store's reset function but keep scores
			const { quizStateStore } = await import("../stores/quizState.store.js");
			quizStateStore.currentRound = -1;
			quizStateStore.currentQuestionIndex = 0;
			quizStateStore.roundStarted = false;
			quizStateStore.currentQuestion = null;
			// Don't reset roundQuestions - keep them for potential review

			return res.json({
				message: "Quiz state reset to inactive",
				data: getQuizState(),
			});
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

		// Get updated state
		const updatedState = getQuizState();

		// Emit WebSocket event if question actually advanced
		// This ensures all clients stay in sync
		if (updatedState.currentQuestionIndex !== currentState.currentQuestionIndex ||
			updatedState.currentRound !== currentState.currentRound) {
			emitQuizEvent(QUIZ_EVENTS.QUESTION_ADVANCED, {
				roundIndex: updatedState.currentRound,
				questionIndex: updatedState.currentQuestionIndex,
				questionTimeRemaining: updatedState.questionTimeRemaining,
				questionDuration: updatedState.questionDuration,
				totalQuestionsInRound: updatedState.totalQuestionsInRound,
			});
		}

		res.json({
			message: "Quiz state updated successfully",
			data: updatedState,
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

		// Emit WebSocket event for real-time sync
		emitQuizEvent(QUIZ_EVENTS.QUIZ_RESET, {
			message: "Quiz has been reset by the Quiz Master",
		});

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
		console.log("[Hint] Current quiz state:", {
			currentRound: state.currentRound,
			hasQuestion: !!state.currentQuestion,
			roundStarted: state.roundStarted
		});

		if (!state.currentQuestion) {
			console.log("[Hint] No active question available");
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

		console.log("[Hint] Requesting AI hint for question:", questionText.substring(0, 50) + "...");

		// Get hint from AI assistant
		const result = await getAIHint(
			questionText,
			options,
			state.currentQuestion.meta?.image || null,
			state.currentQuestion.meta?.audio || null
		);

		console.log("[Hint] AI result:", { success: result.success, error: result.error });

		if (!result.success) {
			// Return 503 for service unavailable instead of 500 for better clarity
			return res.status(503).json({
				message: result.error || "AI hint service temporarily unavailable",
			});
		}

		res.json({
			message: "Hint retrieved successfully",
			data: {
				hint: result.hint,
			},
		});
	} catch (error) {
		console.error("[Hint] Unexpected error:", error);
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
		} else if (state.currentQuestion.questionType === "SUDDEN_DEATH") {
			// Sudden Death scoring formula: multiplier × (remainingTime/totalTime) × currentTotalScore
			// Multiplier based on option: A=0, B=1, C=2, D=0.5
			const multiplierMap = { A: 0, B: 1, C: 2, D: 0.5 };
			const optionLetter = selectedOptionId?.toUpperCase() || "";
			const multiplier = multiplierMap[optionLetter] ?? 0;
			
			// Get user's current total score from the database
			const existingUserScore = onlineUsers.get(schoolId);
			const currentTotalScore = existingUserScore?.totalScore || 0;
			
			// If no existing score in memory, try to get from DB
			let userCurrentScore = currentTotalScore;
			if (userCurrentScore === 0) {
				try {
					const dbEntry = await gameLeaderboardService.getBySchoolId(schoolId);
					userCurrentScore = dbEntry?.totalScore || 0;
				} catch (e) {
					console.warn("Could not fetch user score from DB for Sudden Death:", e.message);
				}
			}
			
			const timeRatio = allocatedTime > 0 ? remainingTime / allocatedTime : 0;
			calculatedScore = Math.round(multiplier * timeRatio * userCurrentScore * 100) / 100;
			
			console.log(`🎯 Sudden Death scoring: ${multiplier} × (${remainingTime}/${allocatedTime}) × ${userCurrentScore} = ${calculatedScore}`);
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

// LB-05/LB-06: Publish announcement (admin only)
export const postAnnouncement = async (req, res, next) => {
	try {
		const { message, type, durationSeconds, persistent } = req.body;

		if (!message || typeof message !== 'string' || message.trim() === '') {
			return res.status(400).json({
				message: "Announcement message is required"
			});
		}

		const announcement = publishAnnouncement(
			message.trim(),
			type || 'info',
			durationSeconds || 30,
			persistent || false // LB-06: Persistent announcements can't be dismissed by users
		);

		res.json({
			message: "Announcement published successfully",
			data: announcement,
		});
	} catch (error) {
		next(error);
	}
};

// LB-05: Get all active announcements (for participants)
export const getAnnouncement = async (req, res, next) => {
	try {
		const announcements = getActiveAnnouncements();

		res.json({
			data: announcements, // Array of active announcements (empty if none)
		});
	} catch (error) {
		next(error);
	}
};

// LB-05: Clear announcement(s) (admin only)
// If id is provided in query, clear that specific one
// Otherwise clear all announcements
export const deleteAnnouncement = async (req, res, next) => {
	try {
		const { id } = req.query;

		if (id) {
			const removed = clearAnnouncementById(id);
			res.json({
				message: removed ? "Announcement cleared successfully" : "Announcement not found",
				success: removed,
			});
		} else {
			const count = clearAllAnnouncements();
			res.json({
				message: `Cleared ${count} announcement(s)`,
				count,
			});
		}
	} catch (error) {
		next(error);
	}
};

// Get summary for a specific round
export const getRoundSummary = async (req, res, next) => {
	try {
		const { roundIndex } = req.params;

		if (roundIndex === undefined) {
			return res.status(400).json({
				message: "Round index is required"
			});
		}

		console.log(`[Summary] Generating summary for Round ${Number(roundIndex) + 1}`);

		const summary = await gameLeaderboardService.getRoundSummary(Number(roundIndex));

		res.json({
			data: summary
		});
	} catch (error) {
		console.error("[Summary] Error generating summary:", error);
		next(error);
	}
};

// SUMM-04: Finalize a round and apply tier updates
export const finalizeRound = async (req, res, next) => {
	try {
		const { roundIndex } = req.body;

		if (roundIndex === undefined) {
			return res.status(400).json({
				message: "Round index is required"
			});
		}

		console.log(`[Finalize] Applying tier updates for Round ${Number(roundIndex) + 1}`);

		const result = await gameLeaderboardService.applyTierUpdates(Number(roundIndex));

		console.log(`[Finalize] Tier updates applied: ${result.promoted} promoted, ${result.demoted} demoted`);

		res.json({
			message: `Round ${Number(roundIndex) + 1} finalized`,
			data: result
		});
	} catch (error) {
		console.error("[Finalize] Error finalizing round:", error);
		next(error);
	}
};

// SUMM-05: Get final standings for the entire competition
export const getFinalStandings = async (req, res, next) => {
	try {
		console.log(`[FinalStandings] Generating final standings`);

		const standings = await gameLeaderboardService.getFinalStandings();

		res.json({
			data: standings
		});
	} catch (error) {
		console.error("[FinalStandings] Error generating final standings:", error);
		next(error);
	}
};

// SETTINGS: Get current quiz settings
export const getSettings = async (req, res, next) => {
	try {
		const settings = await getQuizSettings();
		const settingsObj = settings.toObject ? settings.toObject() : settings;
		const overrideValue = (settingsObj.globalTimeLimitOverride !== undefined && settingsObj.globalTimeLimitOverride !== null && !isNaN(Number(settingsObj.globalTimeLimitOverride)))
			? Number(settingsObj.globalTimeLimitOverride)
			: null;

		res.json({
			data: {
				questionDuration: settings.questionDuration, // in seconds
				globalTimeLimitOverride: overrideValue, // in seconds, null = no override
			}
		});
	} catch (error) {
		console.error("[Settings] Error getting settings:", error);
		next(error);
	}
};

// SETTINGS: Update quiz settings (admin only)
export const updateSettings = async (req, res, next) => {
	try {
		const { questionDuration, globalTimeLimitOverride } = req.body;

		console.log("[Settings] Received request body:", req.body);
		console.log("[Settings] questionDuration value:", questionDuration, "type:", typeof questionDuration);
		console.log("[Settings] globalTimeLimitOverride value:", globalTimeLimitOverride, "type:", typeof globalTimeLimitOverride);

		const updates = {};

		// Validate and update questionDuration
		if (questionDuration !== undefined) {
			const duration = Number(questionDuration);
			console.log("[Settings] Parsed duration:", duration);
			if (isNaN(duration) || duration < 5 || duration > 300) {
				console.log("[Settings] Validation failed - duration:", duration, "isNaN:", isNaN(duration));
				return res.status(400).json({
					message: "questionDuration must be a number between 5 and 300 seconds"
				});
			}

			updates.questionDuration = duration;
			// Also update in-memory store for immediate effect
			setQuestionDuration(duration);
			console.log(`[Settings] Question duration updated to ${duration} seconds (saved to DB)`);
		}

		// Validate and update globalTimeLimitOverride
		if (globalTimeLimitOverride !== undefined) {
			// Allow null to disable override
			if (globalTimeLimitOverride === null || globalTimeLimitOverride === "") {
				// Use $unset to remove the field from MongoDB (since Number fields can't be null)
				updates.$unset = updates.$unset || {};
				updates.$unset.globalTimeLimitOverride = "";
				setGlobalTimeLimitOverride(null);
				console.log(`[Settings] ✅ Global time limit override DISABLED (removing field from DB)`);
			} else {
				const override = Number(globalTimeLimitOverride);
				console.log(`[Settings] Parsing override: ${globalTimeLimitOverride} → ${override} (isNaN: ${isNaN(override)})`);
				if (isNaN(override) || override < 5 || override > 300) {
					console.log(`[Settings] ❌ Validation failed for override: ${override}`);
					return res.status(400).json({
						message: "globalTimeLimitOverride must be a number between 5 and 300 seconds, or null to disable"
					});
				}
				updates.globalTimeLimitOverride = override;
				setGlobalTimeLimitOverride(override);
				console.log(`[Settings] ✅ Global time limit override updated to ${override} seconds (saved to DB)`);
			}
		}

		// If updates were provided, save to database
		if (Object.keys(updates).length > 0) {
			const settings = await updateQuizSettings(updates);

			// Convert to plain object for response
			const settingsObj = settings.toObject ? settings.toObject() : settings;
			const overrideValue = (settingsObj.globalTimeLimitOverride !== undefined && settingsObj.globalTimeLimitOverride !== null && !isNaN(Number(settingsObj.globalTimeLimitOverride)))
				? Number(settingsObj.globalTimeLimitOverride)
				: null;

			// Emit WebSocket event for real-time sync
			emitQuizEvent(QUIZ_EVENTS.SETTINGS_UPDATED, {
				questionDuration: settings.questionDuration,
				globalTimeLimitOverride: overrideValue,
			});

			return res.json({
				message: "Settings updated successfully",
				data: {
					questionDuration: settings.questionDuration,
					globalTimeLimitOverride: overrideValue,
				}
			});
		}

		// If no updates provided, return current settings
		const settings = await getQuizSettings();
		const settingsObj = settings.toObject ? settings.toObject() : settings;
		const overrideValue = (settingsObj.globalTimeLimitOverride !== undefined && settingsObj.globalTimeLimitOverride !== null && !isNaN(Number(settingsObj.globalTimeLimitOverride)))
			? Number(settingsObj.globalTimeLimitOverride)
			: null;

		res.json({
			message: "No updates provided",
			data: {
				questionDuration: settings.questionDuration,
				globalTimeLimitOverride: overrideValue,
			}
		});
	} catch (error) {
		console.error("[Settings] Error updating settings:", error);
		next(error);
	}
};

// QUESTIONS: Upload quiz questions (admin only)
export const uploadQuestions = async (req, res, next) => {
	try {
		const { metadata, questions, clearExisting } = req.body;

		if (!questions || !Array.isArray(questions) || questions.length === 0) {
			return res.status(400).json({
				message: "Questions array is required and must not be empty"
			});
		}

		console.log(`[Questions] Uploading ${questions.length} questions`);
		if (metadata?.title) {
			console.log(`[Questions] Title: ${metadata.title}`);
		}

		// If clearExisting is true, delete all existing questions first
		let deletedCount = 0;
		if (clearExisting) {
			console.log(`[Questions] Clearing all existing questions...`);
			const deleteResult = await GameQuestion.deleteMany({});
			deletedCount = deleteResult.deletedCount || 0;
			console.log(`[Questions] Deleted ${deletedCount} existing questions`);
		}

		// Transform questions from JSON format to database schema
		const transformedQuestions = questions.map((q) => {
			// Map type to questionType (uppercase with underscores)
			const questionType = (q.type || "")
				.toUpperCase()
				.replace(/ /g, "_");

			// Map options with letter labels to text and correctness
			const options = (q.options || []).map((opt) => ({
				text: opt.text || "",
				// Use score as correctness, normalize if needed
				// Score of 10 is typically "correct", map to max correctness (3)
				correctness: opt.score === 10 ? 3 : (opt.score || 0) / 10 * 3,
			}));

			return {
				prompt: q.question || "",
				questionType,
				options,
				meta: {
					id: q.id,
					hint: q.hint,
					explanation: q.explanation,
					timeLimit: q.timeLimit,
					category: q.category,
					llm_response: q.llm_response,
					llm_rationale: q.llm_rationale,
					llm_correctness: q.llm_correctness,
					llm_response_time: q.llm_response_time,
					llm_score: q.llm_score,
					// Sudden Death specific fields
					imageUri: q.imageUri || null,
					isSuddenDeath: q.isSuddenDeath || false,
				},
			};
		});

		// Use bulkUpsert to insert/update questions
		const result = await gameQuestionService.bulkUpsert(transformedQuestions);

		console.log(`[Questions] Upload complete: ${result.insertedCount} inserted, ${result.modifiedCount || 0} modified`);

		res.json({
			message: `Successfully uploaded ${questions.length} questions`,
			data: {
				count: questions.length,
				deleted: deletedCount,
				inserted: result.insertedCount,
				modified: result.modifiedCount || 0,
			}
		});
	} catch (error) {
		console.error("[Questions] Error uploading questions:", error);
		next(error);
	}
};
