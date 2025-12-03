// In-memory store for current quiz state
// Tracks the current question and round being displayed
export const quizStateStore = {
	currentRound: -1, // -1 means no round started, 0-indexed when active
	currentQuestionIndex: 0, // 0-indexed within the round
	currentQuestion: null, // Current question object
	roundQuestions: [], // Questions for current round
	isActive: false,
	questionStartTime: null, // When current question started
	questionDuration: 30 * 1000, // 30 seconds per question (for academic scoring)
	roundStarted: false, // Whether the current round has been started by admin
	autoAdvanceEnabled: true, // Enable auto-advance when time runs out
};

// Start a round (called by admin)
export function startRound(roundIndex) {
	quizStateStore.currentRound = roundIndex;
	quizStateStore.currentQuestionIndex = 0;
	quizStateStore.currentQuestion = null;
	quizStateStore.roundQuestions = [];
	quizStateStore.isActive = true;
	quizStateStore.roundStarted = true;
	quizStateStore.questionStartTime = null; // Will be set when first question is displayed
}

// Set current round and question (called by mobile app when displaying questions)
export function setCurrentQuestion(roundIndex, questionIndex, question, roundQuestions) {
	// Only allow setting question if round has been started
	if (quizStateStore.currentRound !== roundIndex || !quizStateStore.roundStarted) {
		return false; // Round not started yet
	}
	
	quizStateStore.currentQuestionIndex = questionIndex;
	quizStateStore.currentQuestion = question;
	quizStateStore.roundQuestions = roundQuestions;
	quizStateStore.questionStartTime = Date.now(); // Track when question started
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
	quizStateStore.questionStartTime = Date.now();
	
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
		autoAdvanced: advanceResult?.success || false,
		roundComplete: advanceResult?.reason === 'round_complete',
	};
}

// Reset quiz state
export function resetQuizState() {
	quizStateStore.currentRound = -1;
	quizStateStore.currentQuestionIndex = 0;
	quizStateStore.currentQuestion = null;
	quizStateStore.roundQuestions = [];
	quizStateStore.isActive = false;
	quizStateStore.roundStarted = false;
	quizStateStore.questionStartTime = null;
}

// Set question duration (in seconds)
export function setQuestionDuration(seconds) {
	quizStateStore.questionDuration = seconds * 1000;
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

