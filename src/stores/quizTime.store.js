// In-memory store for quiz time
// Tracks when the quiz started and its duration
export const quizTimeStore = {
	quizStartTime: null,
	quizDuration: 25 * 60 * 1000, // 25 minutes in milliseconds (default)
	isActive: false,
};

// Initialize quiz time
export function startQuiz(durationMinutes = 25) {
	quizTimeStore.quizStartTime = Date.now();
	quizTimeStore.quizDuration = durationMinutes * 60 * 1000;
	quizTimeStore.isActive = true;
}

// Stop quiz
export function stopQuiz() {
	quizTimeStore.isActive = false;
}

// Get remaining time in milliseconds
export function getRemainingTime() {
	if (!quizTimeStore.isActive || !quizTimeStore.quizStartTime) {
		return 0;
	}

	const elapsed = Date.now() - quizTimeStore.quizStartTime;
	const remaining = quizTimeStore.quizDuration - elapsed;
	return Math.max(0, remaining);
}

// Get quiz status
export function getQuizStatus() {
	return {
		isActive: quizTimeStore.isActive,
		startTime: quizTimeStore.quizStartTime,
		duration: quizTimeStore.quizDuration,
		remainingTime: getRemainingTime(),
	};
}

