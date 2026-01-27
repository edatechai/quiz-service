import { gameQuestionService } from "../services/gameQuestion.service.js";
import { GameQuestion } from "../models/gameQuestion.model.js";
import { setCurrentQuestion, getCurrentQuizState as getQuizState, startRound as startRoundInStore, resetQuizState, advanceToNextQuestion, getQuestionTimingInfo, setQuestionDuration, setGlobalTimeLimitOverride, quizStateStore, getRoundQuestions, getQuestionsForRound, getUsedQuestionIds, recordRoundSubmission, hasSubmittedRound, getAllRoundSubmissions, setRoundQuestions } from "../stores/quizState.store.js";
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
		multiplier: option.multiplier, // Sudden Death multiplier (0.25, 0.5, 1, 2)
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



		// IMPORTANT: Use stored questions if round is active to ensure all users get the same questions
		const currentState = getQuizState();
		let questions;

		// Priority 1: Check if questions are already in the current active round state
		if (currentState.roundStarted &&
			currentState.currentRound === roundIndex &&
			currentState.roundQuestions &&
			currentState.roundQuestions.length > 0) {
			console.log(`[Questions] Serving active round questions for Round ${roundIndex + 1}`);
			questions = currentState.roundQuestions;
		} else {
			// Priority 2: Check if we have historical/persisted questions for this specific round
			const historicalQuestions = getQuestionsForRound(roundIndex);
			if (historicalQuestions && historicalQuestions.length > 0) {
				console.log(`[Questions] Serving persisted questions for Round ${roundIndex + 1} from history`);
				questions = historicalQuestions;
			} else {
				// Priority 3: Fallback - fetch fresh questions and LOCK them for this round to ensure consistency
				console.log(`[Questions] No pre-picked questions for Round ${roundIndex + 1}. Fetching and locking...`);
				questions = await gameQuestionService.listByType({
					limit: questionsPerRound,
					round: roundIndex,
				});

				// Lock them in history so subsequent requests from other devices get the same set
				if (roundIndex !== null) {
					console.log(`[Questions] Locking questions for Round ${roundIndex + 1} to ensure consistency`);
					setRoundQuestions(roundIndex, questions);
				}
			}
		}

		const payload = questions.map((q) => {
			// Determine timeLimit: use override if set, otherwise use question's timeLimit, fallback to 60
			const questionTimeLimit = q.meta?.timeLimit || 60;
			// Check if override exists and is a valid number
			const hasOverride = globalTimeLimitOverride !== null && globalTimeLimitOverride !== undefined && !isNaN(Number(globalTimeLimitOverride));
			const effectiveTimeLimit = hasOverride
				? Number(globalTimeLimitOverride)
				: questionTimeLimit;



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

		// Track question received (after response is sent)
		// Use schoolId from auth session if available
		const schoolId = req.session?.sid;
		if (schoolId && roundIndex !== null) {
			markQuestionReceived(schoolId, roundIndex, 0);
		}
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

		// Before starting Round 5 (Sudden Death), calculate all Inside the Box scores from Round 4
		if (roundIndex === 4) {
			console.log(`\n========== CALCULATING INSIDE THE BOX SCORES BEFORE ROUND 5 ==========`);

			// Round 4 (index 3) is Inside the Box - process all 5 questions
			const insideTheBoxRound = 3;
			const questionsInRound = 5;
			let totalProcessed = 0;

			for (let qIndex = 0; qIndex < questionsInRound; qIndex++) {
				try {
					const result = await gameLeaderboardService.processConsensusScores(insideTheBoxRound, qIndex);
					totalProcessed += result.processed || 0;
					console.log(`[Inside the Box] Question ${qIndex + 1}: Processed ${result.processed} answers`);
				} catch (err) {
					console.error(`[Inside the Box] Error processing Q${qIndex + 1}:`, err.message);
				}
			}

			console.log(`[Inside the Box] Total answers processed: ${totalProcessed}`);

			// Log all team scores before Sudden Death
			console.log(`\n---------- PRE-SUDDEN DEATH SCORES (End of Round 4) ----------`);
			const leaderboard = await gameLeaderboardService.list(100);
			leaderboard.forEach((team, index) => {
				console.log(`  ${index + 1}. ${team.schoolName || team.schoolId}: ${team.totalScore} points`);
			});
			console.log(`==============================================================\n`);
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

			// Persist this reset to the database
			const { syncToDatabase } = await import("../stores/quizState.store.js");
			await syncToDatabase();

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
			let questionsToUse = getQuestionsForRound(roundIndex) || currentState.roundQuestions;

			// Only fetch new questions if we don't have any stored
			if (!questionsToUse || questionsToUse.length === 0) {
				console.log(`[Question Fetch] Fetching NEW questions for Round ${roundIndex + 1} (roundIndex: ${roundIndex})`);
				questionsToUse = await gameQuestionService.listByType({
					limit: 5,
					round: roundIndex // Pass the round to get round-specific questions
				});
				console.log(`[Question Fetch] Got ${questionsToUse.length} questions:`, questionsToUse.map(q => `${q.questionType}: ${q.prompt.substring(0, 30)}...`));
			} else {
				console.log(`[Question Fetch] Using existing questions for Round ${roundIndex + 1}`);
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
import { onlineUsers, AI_TEAM_ID } from "../stores/onlineUsers.store.js";
import { markQuestionReceived, markAnswerSubmitted, resetParticipationTracker, getParticipationStats } from "../stores/participationTracker.store.js";

// ... existing imports ...

// Reset quiz state (admin only)
export const resetQuiz = async (req, res, next) => {
	try {
		// 1. Reset quiz flow state
		await resetQuizState();

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

		// 5. Reset participation tracker
		resetParticipationTracker();

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

// NEW: System Wipe (Total Reset + Logout All)
export const systemWipe = async (req, res, next) => {
	try {
		console.log("🔥 [System] EXECUTING TOTAL SYSTEM WIPE...");

		// 1. Reset quiz flow state
		await resetQuizState();

		// 2. Reset AI team answers tracking
		resetAITeamAnswers();

		// 3. Clear all leaderboard data from database
		await gameLeaderboardService.resetLeaderboard();

		// 4. Force logout ALL users and clear in-memory scores
		let logoutCount = 0;
		for (const [schoolId, user] of onlineUsers.entries()) {
			const isAdmin = user.coordinatorEmail?.endsWith('@edatech.ai') || schoolId === 'admin';
			const isAI = schoolId === AI_TEAM_ID;

			if (!isAdmin && !isAI) {
				// Mark as force-logged-out in the onlineUsers map
				onlineUsers.set(schoolId, {
					...user,
					sessionId: null,
					forceLoggedOut: true,
					currentScore: 0,
					lastScore: 0,
					totalScore: 0,
				});
				logoutCount++;
			} else {
				// For admin/AI, just reset scores
				onlineUsers.set(schoolId, {
					...user,
					currentScore: 0,
					lastScore: 0,
					totalScore: 0,
				});
			}
		}

		// 5. Reset participation tracker
		resetParticipationTracker();

		// 6. Broadcast reset/logout events
		// Reset event first so app handles state clearing before redirecting
		emitQuizEvent(QUIZ_EVENTS.QUIZ_RESET, {
			message: "The entire system has been reset by the Quiz Master.",
			timestamp: Date.now()
		});

		emitQuizEvent(QUIZ_EVENTS.FORCE_LOGOUT, {
			message: "System has been wiped for a new session. Please re-login.",
			timestamp: Date.now()
		});

		console.log(`✅ [System] Wipe complete. Logged out ${logoutCount} teams.`);

		res.json({
			message: "Total system wipe completed successfully",
			loggedOutCount: logoutCount,
			data: getQuizState(),
		});
	} catch (error) {
		console.error("❌ [System] System wipe failed:", error);
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
			// Sudden Death scoring formula: finalTotal = preRound5Total × multiplier
			// The total from Rounds 1-4 is multiplied by the option's multiplier

			// Fetch fresh question data using RAW MongoDB driver (bypassing Mongoose model)
			// Mongoose was stripping the multiplier field even with .lean()
			let options = state.currentQuestion.options || [];
			try {
				const mongoose = (await import("mongoose")).default;
				const db = mongoose.connection.db;
				console.log(`🔍 Querying MongoDB for SUDDEN_DEATH question...`);
				console.log(`🔍 Database name: ${db.databaseName}`);
				const rawQuestion = await db.collection("gamequestions").findOne({ questionType: "SUDDEN_DEATH" });

				if (rawQuestion) {
					console.log(`✅ Found question in database`);
					console.log(`📥 Full raw question (first 500 chars):`, JSON.stringify(rawQuestion).substring(0, 500));

					if (rawQuestion.options) {
						options = rawQuestion.options;
						console.log(`🔄 Loaded RAW Sudden Death options from MongoDB`);
						console.log(`📥 Raw options data:`, JSON.stringify(options, null, 2));

						// Verify multipliers are present
						const hasMultipliers = options.every(opt => opt.multiplier !== undefined);
						if (!hasMultipliers) {
							console.error(`❌ ERROR: Some options are missing multiplier field!`);
							options.forEach((opt, i) => {
								console.error(`   Option ${i}: text="${opt.text}", multiplier=${opt.multiplier}, score=${opt.score}`);
							});

							// Auto-fix: Update the question with correct multipliers
							console.log(`🔧 Auto-fixing: Updating multipliers in database...`);
							const correctOptions = [
								{ text: "None of the above", correctness: 0, score: 0.25, multiplier: 0.25 },
								{ text: "30", correctness: 3, score: 1, multiplier: 1 },
								{ text: "15", correctness: 6, score: 2, multiplier: 2 },
								{ text: "200 plus", correctness: 1.5, score: 0.5, multiplier: 0.5 }
							];

							try {
								await db.collection("gamequestions").updateOne(
									{ questionType: "SUDDEN_DEATH" },
									{ $set: { options: correctOptions } }
								);
								console.log(`✅ Successfully updated multipliers in database!`);
								options = correctOptions; // Use the corrected options
							} catch (updateError) {
								console.error(`❌ Failed to update multipliers:`, updateError.message);
							}
						} else {
							console.log(`✅ All options have multiplier fields`);
						}
					} else {
						console.warn(`⚠️ No options found in raw question`);
					}
				} else {
					console.error(`❌ No SUDDEN_DEATH question found in database!`);
				}
			} catch (e) {
				console.error("❌ Error fetching raw Sudden Death question:", e.message);
				console.error(e);
			}

			const labels = ["A", "B", "C", "D", "E", "F"];

			// Debug: Log what we're looking for and what options we have
			console.log(`🔍 Looking for option: "${selectedOptionId}"`);
			console.log(`📋 Available options:`, options.map((o, i) => `${labels[i]}="${o.text}" (mult=${o.multiplier})`).join(', '));

			// Find the selected option by label (A, B, C, D)
			let selectedOptionData = null;
			for (let i = 0; i < options.length; i++) {
				const optionLabel = labels[i];
				// Match by label (A, B, C, D) - this is what the mobile sends
				if (optionLabel === selectedOptionId) {
					selectedOptionData = options[i];
					console.log(`✅ Found option ${optionLabel}: text="${selectedOptionData.text}", multiplier=${selectedOptionData.multiplier}`);
					break;
				}
			}

			if (!selectedOptionData) {
				console.warn(`⚠️ Option "${selectedOptionId}" not found in options array!`);
			}

			// Get multiplier from option data, default to 0.25 if not found (unanswered penalty)
			const multiplier = selectedOptionData?.multiplier ?? selectedOptionData?.score ?? 0.25;
			console.log(`🎯 Final multiplier value: ${multiplier}`);

			// Get user's current total score (from Rounds 1-4)
			const existingUserScore = onlineUsers.get(schoolId);
			let preRound5Total = existingUserScore?.totalScore || 0;

			// If no existing score in memory, try to get from DB
			if (preRound5Total === 0) {
				try {
					const dbEntry = await gameLeaderboardService.getBySchoolId(schoolId);
					preRound5Total = dbEntry?.totalScore || 0;
				} catch (e) {
					console.warn("Could not fetch user score from DB for Sudden Death:", e.message);
				}
			}

			// NEW FORMULA: finalTotal = preRound5Total × multiplier
			// Example with 600 points from Rounds 1-4:
			// - If multiplier = 2: finalTotal = 600 × 2 = 1200
			// - If multiplier = 1: finalTotal = 600 × 1 = 600
			// - If multiplier = 0.5: finalTotal = 600 × 0.5 = 300
			// - If multiplier = 0: finalTotal = 600 × 0 = 0
			const finalTotal = Math.round(preRound5Total * multiplier * 100) / 100;

			// Calculate the delta needed to achieve this final total
			calculatedScore = finalTotal - preRound5Total;

			console.log(`🎲 Sudden Death: Selected ${selectedOptionId}, multiplier = ${multiplier}`);
			console.log(`🎯 Sudden Death scoring: ${preRound5Total} × ${multiplier} = ${finalTotal} (delta: ${calculatedScore >= 0 ? '+' : ''}${calculatedScore})`);
		} else {
			// Academic scoring formula: originalScore × remaining_time
			// Convert correctness back to original JSON score (1-10 scale)
			// DB stores: correctness = score/10 * 3, so originalScore = correctness * 10/3
			const originalScore = Math.round(rawCorrectness * 10 / 3);
			calculatedScore = Math.round(originalScore * remainingTime * 10) / 10; // Round to 1 decimal
			console.log(`📊 Academic scoring: originalScore=${originalScore} (from correctness=${rawCorrectness}) × ${remainingTime}s = ${calculatedScore}`);
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

		// Track answer submitted in participation tracker
		markAnswerSubmitted(schoolId, state.currentRound, state.currentQuestionIndex);

		// Log final score summary after Round 5 (Sudden Death)
		if (state.currentRound === 4) {
			console.log(`\n========== FINAL SCORE AFTER ROUND 5 (SUDDEN DEATH) ==========`);
			console.log(`School: ${schoolName || schoolId}`);
			console.log(`Pre-Sudden Death Score: ${existingUser?.totalScore || 0}`);
			console.log(`Sudden Death Calculation:`);
			console.log(`  - Selected Option: ${selectedOptionId}`);
			console.log(`  - Score Delta: ${calculatedScore >= 0 ? '+' : ''}${calculatedScore}`);
			console.log(`  - Formula: Pre-Score × (multiplier - 1) = Delta`);
			console.log(`FINAL CUMULATIVE SCORE: ${totalScore}`);
			console.log(`===============================================================\n`);
		}

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

// Batch submit all answers for a round
export const submitRound = async (req, res, next) => {
	try {
		const { schoolId, schoolName, roundIndex, answers } = req.body;

		// Validate input
		if (!schoolId || roundIndex === undefined || !Array.isArray(answers)) {
			return res.status(400).json({
				message: "Missing required fields: schoolId, roundIndex, and answers array"
			});
		}

		const state = getQuizState();

		// Verify round matches current active round
		if (state.currentRound !== roundIndex) {
			return res.status(400).json({
				message: `Round mismatch: expected round ${state.currentRound}, got ${roundIndex}`
			});
		}

		// Check if already submitted
		if (hasSubmittedRound(schoolId)) {
			return res.status(409).json({
				message: "Already submitted answers for this round"
			});
		}

		// Get questions for scoring verification
		const roundQuestions = getRoundQuestions();

		// Calculate scores for each answer
		let roundTotalScore = 0;
		const scoredAnswers = [];

		for (const answer of answers) {
			const { questionIndex, selectedOptionId, remainingTime, localScore } = answer;
			const question = roundQuestions[questionIndex];

			if (!question) {
				continue; // Skip invalid question index
			}

			// Find the selected option
			const options = question.options || [];
			const labels = ["A", "B", "C", "D", "E", "F"];
			let selectedOption = null;
			for (let i = 0; i < options.length; i++) {
				if (labels[i] === selectedOptionId) {
					selectedOption = options[i];
					break;
				}
			}

			if (!selectedOption) {
				continue; // Skip invalid option
			}

			let calculatedScore = 0;

			if (question.questionType === "INSIDE_THE_BOX") {
				// Deferred scoring - handled separately
				calculatedScore = 0;
			} else if (question.questionType === "SUDDEN_DEATH") {
				// Get existing user total - IMPORTANT: Check DB first since onlineUsers may be empty after server restart
				const existingUser = onlineUsers.get(schoolId);
				let preRound5Total = existingUser?.totalScore || 0;

				// If not in memory (server restart), fetch from database
				if (preRound5Total === 0) {
					try {
						const dbEntry = await gameLeaderboardService.getBySchoolId(schoolId);
						preRound5Total = dbEntry?.totalScore || 0;
						console.log(`[Sudden Death] Fetched preRound5Total from DB: ${preRound5Total}`);
					} catch (e) {
						console.warn(`[Sudden Death] Could not fetch user score from DB: ${e.message}`);
					}
				}

				// Default to 0.25 if no option selected (unanswered penalty)
				const multiplier = selectedOption?.multiplier ?? selectedOption?.score ?? 0.25;
				const finalTotal = Math.round(preRound5Total * multiplier * 100) / 100;
				calculatedScore = finalTotal - preRound5Total;
				console.log(`[Sudden Death Calc] preRound5Total=${preRound5Total}, multiplier=${multiplier}, finalTotal=${finalTotal}, delta=${calculatedScore}`);
			} else {
				// Rounds 1-3 scoring: score × remainingTime
				const optionScore = Number(selectedOption.score ?? selectedOption.correctness ?? 0);
				calculatedScore = Math.round(optionScore * remainingTime * 10) / 10;
			}

			roundTotalScore += calculatedScore;
			scoredAnswers.push({
				questionIndex,
				selectedOptionId,
				remainingTime,
				localScore,
				calculatedScore,
				verified: Math.abs(localScore - calculatedScore) < 1, // Allow small float differences
			});
		}

		// Record the submission to tracking store
		recordRoundSubmission(schoolId, scoredAnswers);

		// Fetch persistent user data from DB to get accurate previous total
		// (onlineUsers in-memory store might be reset on server restart)
		const dbUser = await gameLeaderboardService.getBySchoolId(schoolId);
		const previousTotalScore = dbUser?.totalScore || onlineUsers.get(schoolId)?.totalScore || 0;

		// Get the question type from the first answer to check if this is Sudden Death
		const firstQuestion = roundQuestions[0];
		const isSuddenDeathRound = firstQuestion?.questionType === "SUDDEN_DEATH";

		let newTotalScore;
		if (isSuddenDeathRound) {
			// For Sudden Death: final score = previousTotal × multiplier (not previousTotal + delta)
			// The multiplier was already applied in the loop, so finalTotal = previousTotal + roundTotalScore
			// But we want: finalTotal = previousTotal × multiplier
			// So we need to recalculate: finalTotal = previousTotal + roundTotalScore gives us the correct value
			// because roundTotalScore = (previousTotal × multiplier) - previousTotal
			newTotalScore = previousTotalScore + roundTotalScore;
			console.log(`[Sudden Death] previousTotal=${previousTotalScore}, delta=${roundTotalScore}, newTotal=${newTotalScore}`);
		} else {
			newTotalScore = previousTotalScore + roundTotalScore;
		}

		// Update user scores in onlineUsers (memory)
		const existingUser = onlineUsers.get(schoolId);
		onlineUsers.set(schoolId, {
			...(existingUser || {}),
			schoolId,
			schoolName: schoolName || existingUser?.schoolName || dbUser?.schoolName || "Unknown",
			currentScore: roundTotalScore,
			lastScore: previousTotalScore, // Score before this round was submitted (Last Round)
			totalScore: newTotalScore,
			lastActivity: Date.now(),
		});

		// Save to leaderboard database using recordScore
		// We pass newTotalScore as the 'score' because recordScore sets 'totalScore' to this value
		await gameLeaderboardService.recordScore({
			schoolId,
			schoolName: schoolName || existingUser?.schoolName || dbUser?.schoolName,
			score: newTotalScore, // Pass accumulated total score
			meta: {
				roundIndex,
				batchSubmission: true,
				roundScore: roundTotalScore, // Store round score in meta
				submittedAt: new Date().toISOString(),
			},
		});

		// Also update the round specific score atomically
		await gameLeaderboardService.updateRoundScore(schoolId, roundIndex, roundTotalScore);

		// CRITICAL: For Inside the Box (Round 4), store answers in DB for deferred consensus scoring
		// processConsensusScores expects answers in format: answers.round{roundIndex}_q{questionIndex}
		const isInsideTheBoxRound = firstQuestion?.questionType === "INSIDE_THE_BOX";
		if (isInsideTheBoxRound) {
			console.log(`[Inside the Box] Storing ${scoredAnswers.length} answers for deferred consensus scoring...`);
			const { GameLeaderboard } = await import("../models/gameLeaderboard.model.js");

			const answerUpdates = {};
			for (const scored of scoredAnswers) {
				const answerKey = `answers.round${roundIndex}_q${scored.questionIndex}`;
				answerUpdates[answerKey] = {
					selectedOption: scored.selectedOptionId,
					remainingTime: scored.remainingTime,
					optionScore: 10, // Default base score for consensus calculation
					submittedAt: new Date(),
					// Note: calculatedScore and processedAt will be set by processConsensusScores
				};
			}

			await GameLeaderboard.findOneAndUpdate(
				{ schoolId },
				{ $set: answerUpdates },
				{ upsert: false }
			);
			console.log(`[Inside the Box] Stored ${Object.keys(answerUpdates).length} answers for ${schoolId}`);
		}

		console.log(`[Batch Submit] ${schoolId} submitted round ${roundIndex + 1}: ${scoredAnswers.length} answers, round score: ${roundTotalScore}, new total: ${newTotalScore}`);

		res.json({
			message: "Round answers submitted successfully",
			data: {
				roundIndex,
				answerCount: scoredAnswers.length,
				roundScore: roundTotalScore,
				totalScore: newTotalScore,
				scoredAnswers,
			},
		});
	} catch (error) {
		console.error(`[Batch Scoring] Error:`, error);
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

		// If requesting Round 4 (Inside the Box) summary, calculate deferred scores first
		// This ensures scores are calculated before showing the round summary modal
		if (Number(roundIndex) === 3) {
			console.log(`[Summary] Processing Inside the Box deferred scores for Round 4...`);
			let totalProcessed = 0;
			for (let qIndex = 0; qIndex < 5; qIndex++) {
				try {
					const result = await gameLeaderboardService.processConsensusScores(3, qIndex);
					totalProcessed += result.processed || 0;
				} catch (err) {
					console.error(`[Summary] Error processing R4 Q${qIndex + 1}:`, err.message);
				}
			}
			console.log(`[Summary] Inside the Box: Processed ${totalProcessed} answers`);
		}

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

// Get participation stats (admin only)
export const getParticipationStatsEndpoint = async (req, res, next) => {
	try {
		const state = getQuizState();
		const stats = getParticipationStats(
			state.currentRound,
			state.currentQuestionIndex
		);

		res.json({
			message: "Participation stats retrieved successfully",
			data: stats,
		});
	} catch (error) {
		next(error);
	}
};

// Get submission status for all teams (admin only)
export const getSubmissionStatus = async (req, res, next) => {
	try {
		const state = getQuizState();
		const submissions = getAllRoundSubmissions();
		const onlineUsers = await import("../stores/onlineUsers.store.js").then(m => m.onlineUsers);

		// Support filtering by specific round (query param, defaults to current round)
		const roundParam = req.query.round;
		const targetRound = roundParam !== undefined ? parseInt(roundParam, 10) : state.currentRound;

		// Get all online users and their submission status for the target round
		const users = [];
		for (const [schoolId, userData] of onlineUsers.entries()) {
			// Skip AI team and admin users
			if (userData.isAITeam) continue;
			if (schoolId.toLowerCase().includes('admin') ||
				schoolId.toLowerCase().includes('quizmaster') ||
				userData.schoolName?.toLowerCase().includes('admin') ||
				userData.schoolName?.toLowerCase().includes('quiz master')) continue;

			const submission = submissions.find(s => s.schoolId === schoolId && s.round === targetRound);
			users.push({
				schoolId,
				schoolName: userData.schoolName || schoolId,
				region: userData.region || null,
				totalScore: userData.totalScore || 0,
				hasSubmitted: !!submission,
				submittedAt: submission?.submittedAt || null,
				answerCount: submission?.answers?.length || 0,
			});
		}

		// Sort: submitted first, then by school name
		users.sort((a, b) => {
			if (a.hasSubmitted !== b.hasSubmitted) {
				return a.hasSubmitted ? -1 : 1;
			}
			return a.schoolName.localeCompare(b.schoolName);
		});

		res.json({
			message: "Submission status retrieved successfully",
			data: {
				currentRound: state.currentRound,
				viewingRound: targetRound,
				roundStarted: state.roundStarted,
				submittedCount: users.filter(u => u.hasSubmitted).length,
				totalUsers: users.length,
				users,
			},
		});
	} catch (error) {
		next(error);
	}
};
