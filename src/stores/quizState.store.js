// In-memory store for current quiz state
// Tracks the current question and round being displayed
// Now backed by MongoDB for persistence across restarts

import { getPersistedQuizState, savePersistedQuizState, resetPersistedQuizState } from '../models/quizState.model.js';

export const quizStateStore = {
	currentRound: -1, // -1 means no round started, 0-indexed when active
	currentQuestionIndex: 0, // 0-indexed within the round
	currentQuestion: null, // Current question object
	roundQuestions: [], // Questions for current round
	isActive: false,
	questionStartTime: null, // When current question started
	questionDuration: 60 * 1000, // 60 seconds per question (for academic scoring)
	roundStarted: false, // Whether the current round has been started by admin
	autoAdvanceEnabled: true, // Enable auto-advance when time runs out
	globalTimeLimitOverride: null, // Global time limit override in seconds (null = no override, uses question's timeLimit)
	usedQuestionIds: new Set(), // Track question IDs used across all rounds to prevent repetition
	// Batch submission tracking
	roundStartTime: null, // When admin started the round (for round-level countdown)
	roundTotalDuration: 0, // Total duration for entire round (5 × questionTime) in seconds
	roundSubmissions: new Map(), // Map<schoolId, { submittedAt, answers: [] }>
	questionsByRound: {}, // Map of round number to questions array (persisted)
};

// Flag to track if state has been loaded from DB
let isInitialized = false;

/**
 * Sync current in-memory state to database
 * Called after any state mutation
 */
export async function syncToDatabase() {
	try {
		await savePersistedQuizState({
			currentRound: quizStateStore.currentRound,
			currentQuestionIndex: quizStateStore.currentQuestionIndex,
			currentQuestion: quizStateStore.currentQuestion,
			roundQuestions: quizStateStore.roundQuestions,
			isActive: quizStateStore.isActive,
			roundStarted: quizStateStore.roundStarted,
			questionStartTime: quizStateStore.questionStartTime,
			questionDuration: quizStateStore.questionDuration,
			autoAdvanceEnabled: quizStateStore.autoAdvanceEnabled,
			globalTimeLimitOverride: quizStateStore.globalTimeLimitOverride,
			usedQuestionIds: Array.from(quizStateStore.usedQuestionIds),
			questionsByRound: quizStateStore.questionsByRound,
		});
		console.log('[QuizState] Synced to database');
	} catch (error) {
		console.error('[QuizState] Failed to sync to database:', error);
	}
}

/**
 * Load state from database on server startup
 * Called once during initialization
 */
export async function loadFromDatabase() {
	if (isInitialized) {
		console.log('[QuizState] Already initialized, skipping load');
		return;
	}

	try {
		const persistedState = await getPersistedQuizState();

		quizStateStore.currentRound = persistedState.currentRound ?? -1;
		quizStateStore.currentQuestionIndex = persistedState.currentQuestionIndex ?? 0;
		quizStateStore.currentQuestion = persistedState.currentQuestion ?? null;
		quizStateStore.roundQuestions = persistedState.roundQuestions ?? [];
		quizStateStore.isActive = persistedState.isActive ?? false;
		quizStateStore.roundStarted = persistedState.roundStarted ?? false;
		quizStateStore.questionStartTime = persistedState.questionStartTime ?? null;
		quizStateStore.questionDuration = persistedState.questionDuration ?? 60000;
		quizStateStore.autoAdvanceEnabled = persistedState.autoAdvanceEnabled ?? true;
		quizStateStore.globalTimeLimitOverride = persistedState.globalTimeLimitOverride ?? null;
		quizStateStore.usedQuestionIds = new Set(persistedState.usedQuestionIds ?? []);
		// Convert Map back to object or keep as Map if preferred, here we use object for JSON simplicity
		quizStateStore.questionsByRound = persistedState.questionsByRound instanceof Map
			? Object.fromEntries(persistedState.questionsByRound)
			: (persistedState.questionsByRound || {});

		isInitialized = true;
		console.log('[QuizState] Loaded from database:', {
			currentRound: quizStateStore.currentRound,
			currentQuestionIndex: quizStateStore.currentQuestionIndex,
			isActive: quizStateStore.isActive,
			roundStarted: quizStateStore.roundStarted,
			questionsLoaded: quizStateStore.roundQuestions.length,
		});
	} catch (error) {
		console.error('[QuizState] Failed to load from database:', error);
		isInitialized = true; // Mark as initialized even on error to prevent retry loops
	}
}

// Helper to get effective time limit (global override takes precedence)
function getEffectiveTimeLimit(questionTimeLimit) {
	// Global override takes precedence if set
	if (quizStateStore.globalTimeLimitOverride !== null && quizStateStore.globalTimeLimitOverride !== undefined) {
		return quizStateStore.globalTimeLimitOverride * 1000; // convert to ms
	}
	// Fall back to question's timeLimit
	if (questionTimeLimit) {
		return questionTimeLimit * 1000; // convert to ms
	}
	// Default to current duration
	return quizStateStore.questionDuration;
}

/**
 * Persistently associate a set of questions with a specific round.
 * Used to ensure all devices get the same questions for a round,
 * even if they fetch before the round has officially started.
 */
export function setRoundQuestions(roundIndex, questions) {
	if (roundIndex === null || roundIndex === undefined) return;

	quizStateStore.questionsByRound = {
		...quizStateStore.questionsByRound,
		[roundIndex]: questions
	};

	// Also track used IDs to prevent repeats in subsequent rounds
	questions.forEach(q => {
		const qId = q._id?.toString() || q.id?.toString();
		if (qId) quizStateStore.usedQuestionIds.add(qId);
	});

	// Trigger async sync to DB
	syncToDatabase();
}

// Start a round (called by admin) - questions should be pre-fetched and passed in
export function startRound(roundIndex, questions = []) {
	quizStateStore.currentRound = roundIndex;
	quizStateStore.currentQuestionIndex = 0;
	quizStateStore.currentQuestion = questions.length > 0 ? questions[0] : null;
	quizStateStore.roundQuestions = questions; // Store pre-fetched questions so all users get the same set

	// PERSISTENCE FIX: Save questions for this round so late joiners get the same set
	quizStateStore.questionsByRound = {
		...quizStateStore.questionsByRound,
		[roundIndex]: questions
	};

	quizStateStore.isActive = true;
	quizStateStore.roundStarted = true;

	// Set question duration - global override takes precedence over question's timeLimit
	const firstQuestion = questions[0];
	quizStateStore.questionDuration = getEffectiveTimeLimit(firstQuestion?.meta?.timeLimit);
	console.log(`[QuizState] Question duration set to ${quizStateStore.questionDuration}ms (globalOverride: ${quizStateStore.globalTimeLimitOverride}, questionTimeLimit: ${firstQuestion?.meta?.timeLimit})`);

	// START THE TIMER NOW - this is the official start time for Question 1
	// All users will have their remaining time calculated from this moment
	quizStateStore.questionStartTime = Date.now();

	// Track round-level timing for batch submissions
	quizStateStore.roundStartTime = Date.now();
	const questionsInRound = roundIndex === 4 ? 1 : 5; // Sudden Death has 1 question
	const perQuestionSeconds = quizStateStore.globalTimeLimitOverride || (quizStateStore.questionDuration / 1000) || 60;
	quizStateStore.roundTotalDuration = questionsInRound * perQuestionSeconds;
	quizStateStore.roundSubmissions = new Map(); // Clear submissions for new round
	console.log(`[QuizState] Round total duration: ${quizStateStore.roundTotalDuration}s (${questionsInRound} questions × ${perQuestionSeconds}s each)`);

	// Track used question IDs to prevent repetition across rounds
	questions.forEach(q => {
		const qId = q._id?.toString() || q.id?.toString();
		if (qId) {
			quizStateStore.usedQuestionIds.add(qId);
		}
	});

	console.log(`[QuizState] Round ${roundIndex + 1} started with ${questions.length} pre-loaded questions`);
	console.log(`[QuizState] Timer started at ${new Date(quizStateStore.questionStartTime).toISOString()}`);
	console.log(`[QuizState] Total used question IDs: ${quizStateStore.usedQuestionIds.size}`);

	// Sync to database
	syncToDatabase();
}

// Get stored round questions (for serving to all users consistently)
export function getRoundQuestions() {
	return quizStateStore.roundQuestions;
}

// Get persisted questions for a specific round (history)
export function getQuestionsForRound(roundIndex) {
	return quizStateStore.questionsByRound[roundIndex] || null;
}

// Get used question IDs (for excluding from future rounds)
export function getUsedQuestionIds() {
	return Array.from(quizStateStore.usedQuestionIds);
}

// Set current round and question (called by mobile app when displaying questions)
// NOTE: This does NOT reset the timer - the timer is controlled by startRound() and advanceToNextQuestion()
export function setCurrentQuestion(roundIndex, questionIndex, question, roundQuestions) {
	// Only allow setting question if round has been started
	if (quizStateStore.currentRound !== roundIndex || !quizStateStore.roundStarted) {
		return false; // Round not started yet
	}

	// Only update if this is a NEW question (advancing), not just a user fetching current state
	const isNewQuestion = quizStateStore.currentQuestionIndex !== questionIndex;

	quizStateStore.currentQuestionIndex = questionIndex;
	quizStateStore.currentQuestion = question;
	quizStateStore.roundQuestions = roundQuestions;

	// Update duration - global override takes precedence over question's timeLimit
	quizStateStore.questionDuration = getEffectiveTimeLimit(question?.meta?.timeLimit);

	// Only reset timer if advancing to a NEW question
	// DO NOT reset timer when users are just fetching current state
	if (isNewQuestion) {
		quizStateStore.questionStartTime = Date.now();
		console.log(`[QuizState] Advanced to question ${questionIndex + 1}, timer reset at ${new Date().toISOString()}`);

		// Sync to database on question change
		syncToDatabase();
	}

	return true;
}

// Advance to next question (called when timer expires or manually)
export function advanceToNextQuestion() {
	if (!quizStateStore.roundStarted || quizStateStore.roundQuestions.length === 0) {
		return { success: false, reason: 'no_round' };
	}

	const nextIndex = quizStateStore.currentQuestionIndex + 1;

	// Check if we've reached the end of the round
	if (nextIndex >= quizStateStore.roundQuestions.length) {
		return { success: false, reason: 'round_complete' };
	}

	// Advance to next question
	quizStateStore.currentQuestionIndex = nextIndex;
	quizStateStore.currentQuestion = quizStateStore.roundQuestions[nextIndex];

	// Update duration - global override takes precedence over question's timeLimit
	quizStateStore.questionDuration = getEffectiveTimeLimit(quizStateStore.currentQuestion?.meta?.timeLimit);
	console.log(`[QuizState] Advanced to Q${nextIndex + 1}, duration: ${quizStateStore.questionDuration}ms (globalOverride: ${quizStateStore.globalTimeLimitOverride})`);

	quizStateStore.questionStartTime = Date.now();

	// Sync to database
	syncToDatabase();

	return { success: true, questionIndex: nextIndex };
}

// Check if time expired and auto-advance if enabled
export function checkAndAutoAdvance() {
	if (!quizStateStore.autoAdvanceEnabled || !quizStateStore.questionStartTime) {
		return null;
	}

	const now = Date.now();
	const elapsed = now - quizStateStore.questionStartTime;

	if (elapsed >= quizStateStore.questionDuration) {
		return advanceToNextQuestion();
	}

	return null;
}

// Get current quiz state (with auto-advance check)
export function getCurrentQuizState() {
	// Check and auto-advance if time expired
	const advanceResult = checkAndAutoAdvance();

	const now = Date.now();
	const elapsed = quizStateStore.questionStartTime
		? now - quizStateStore.questionStartTime
		: 0;
	const remaining = Math.max(0, quizStateStore.questionDuration - elapsed);

	// Calculate round-level timing
	const roundElapsed = quizStateStore.roundStartTime
		? Math.floor((now - quizStateStore.roundStartTime) / 1000)
		: 0;
	const roundTimeRemaining = Math.max(0, quizStateStore.roundTotalDuration - roundElapsed);

	return {
		currentRound: quizStateStore.currentRound,
		currentQuestionIndex: quizStateStore.currentQuestionIndex,
		currentQuestion: quizStateStore.currentQuestion,
		roundQuestions: quizStateStore.roundQuestions,
		totalQuestionsInRound: quizStateStore.roundQuestions.length,
		isActive: quizStateStore.isActive,
		roundStarted: quizStateStore.roundStarted,
		questionTimeRemaining: Math.floor(remaining / 1000), // in seconds
		questionDuration: Math.floor(quizStateStore.questionDuration / 1000), // in seconds
		globalTimeLimitOverride: quizStateStore.globalTimeLimitOverride, // in seconds (null if not set)
		autoAdvanced: advanceResult?.success || false,
		roundComplete: advanceResult?.reason === 'round_complete',
		// Batch submission tracking for admin
		roundStartTime: quizStateStore.roundStartTime,
		roundTotalDuration: quizStateStore.roundTotalDuration,
		roundTimeRemaining,
		submittedCount: quizStateStore.roundSubmissions.size,
	};
}

// Reset quiz state
export async function resetQuizState() {
	quizStateStore.currentRound = -1;
	quizStateStore.currentQuestionIndex = 0;
	quizStateStore.currentQuestion = null;
	quizStateStore.roundQuestions = [];
	quizStateStore.isActive = false;
	quizStateStore.roundStarted = false;
	quizStateStore.questionStartTime = null;
	quizStateStore.roundStartTime = null;
	quizStateStore.usedQuestionIds = new Set(); // Clear used questions on full reset
	quizStateStore.questionsByRound = {}; // Clear persisted history
	// Reset batch submission tracking
	quizStateStore.roundStartTime = null;
	quizStateStore.roundTotalDuration = 0;
	quizStateStore.roundSubmissions = new Map();

	// Sync to database
	try {
		await resetPersistedQuizState();
		console.log('[QuizState] Reset and synced to database');
	} catch (error) {
		console.error('[QuizState] Failed to reset in database:', error);
	}
}

// Set question duration (in seconds)
export function setQuestionDuration(seconds) {
	quizStateStore.questionDuration = seconds * 1000;
}

// Set global time limit override (in seconds, null to disable override)
export function setGlobalTimeLimitOverride(seconds) {
	quizStateStore.globalTimeLimitOverride = seconds === null || seconds === undefined ? null : seconds;
}

// Get question timing info for scoring
export function getQuestionTimingInfo() {
	const now = Date.now();
	const elapsed = quizStateStore.questionStartTime
		? now - quizStateStore.questionStartTime
		: 0;
	const remaining = Math.max(0, quizStateStore.questionDuration - elapsed);

	return {
		questionStartTime: quizStateStore.questionStartTime,
		questionDuration: quizStateStore.questionDuration,
		elapsedMs: elapsed,
		remainingMs: remaining,
		elapsedSeconds: Math.floor(elapsed / 1000),
		remainingSeconds: Math.floor(remaining / 1000),
		allocatedSeconds: Math.floor(quizStateStore.questionDuration / 1000),
	};
}

// Batch submission functions

/**
 * Record a batch submission for a school
 */
export function recordRoundSubmission(schoolId, answers) {
	quizStateStore.roundSubmissions.set(schoolId, {
		submittedAt: Date.now(),
		answers,
		round: quizStateStore.currentRound,
	});
	console.log(`[QuizState] Recorded round submission for ${schoolId} (${quizStateStore.roundSubmissions.size} total)`);
}

/**
 * Check if a school has submitted for current round
 */
export function hasSubmittedRound(schoolId) {
	return quizStateStore.roundSubmissions.has(schoolId);
}

/**
 * Get submission for a school
 */
export function getRoundSubmission(schoolId) {
	return quizStateStore.roundSubmissions.get(schoolId);
}

/**
 * Get all round submissions (for admin)
 */
export function getAllRoundSubmissions() {
	return Array.from(quizStateStore.roundSubmissions.entries()).map(([schoolId, data]) => ({
		schoolId,
		...data,
	}));
}
