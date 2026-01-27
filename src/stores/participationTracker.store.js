// Participation Tracker Store
// Tracks logged-in users vs. users who have started/received questions
// to identify users who may be experiencing network issues

import { onlineUsers } from './onlineUsers.store.js';

// Participation state per user
// Key: schoolId
// Value: { loggedInAt, quizStartedAt, lastQuestionReceived, lastAnswerSubmitted, socketConnected, socketId }
export const participationTracker = new Map();

/**
 * Mark a user as logged in
 */
export function markLoggedIn(schoolId, schoolName = null) {
    const existing = participationTracker.get(schoolId);
    participationTracker.set(schoolId, {
        schoolId,
        schoolName: schoolName || existing?.schoolName || 'Unknown',
        loggedInAt: Date.now(),
        quizStartedAt: existing?.quizStartedAt || null,
        lastQuestionReceived: existing?.lastQuestionReceived || null,
        lastAnswerSubmitted: existing?.lastAnswerSubmitted || null,
        socketConnected: existing?.socketConnected || false,
        socketId: existing?.socketId || null,
    });
}

/**
 * Mark that a user has started the quiz (fetched first question)
 */
export function markQuizStarted(schoolId) {
    const existing = participationTracker.get(schoolId);
    if (existing) {
        participationTracker.set(schoolId, {
            ...existing,
            quizStartedAt: existing.quizStartedAt || Date.now(),
        });
    }
}

/**
 * Mark that a user received a question
 */
export function markQuestionReceived(schoolId, round, questionIndex) {
    const existing = participationTracker.get(schoolId);
    if (existing) {
        participationTracker.set(schoolId, {
            ...existing,
            quizStartedAt: existing.quizStartedAt || Date.now(),
            lastQuestionReceived: {
                round,
                questionIndex,
                timestamp: Date.now(),
            },
        });
    }
}

/**
 * Mark that a user submitted an answer
 */
export function markAnswerSubmitted(schoolId, round, questionIndex) {
    const existing = participationTracker.get(schoolId);
    if (existing) {
        participationTracker.set(schoolId, {
            ...existing,
            lastAnswerSubmitted: {
                round,
                questionIndex,
                timestamp: Date.now(),
            },
        });
    }
}

/**
 * Update socket connection state for a user
 */
export function updateSocketConnection(schoolId, connected, socketId = null) {
    const existing = participationTracker.get(schoolId);
    if (existing) {
        participationTracker.set(schoolId, {
            ...existing,
            socketConnected: connected,
            socketId: connected ? socketId : null,
        });
    }
}

/**
 * Get participation status for a user
 */
function getParticipationStatus(user, currentRound, currentQuestionIndex) {
    if (!user.quizStartedAt && !user.lastQuestionReceived) {
        return 'NEVER_STARTED';
    }

    if (!user.socketConnected) {
        return 'DISCONNECTED';
    }

    const lastQ = user.lastQuestionReceived;
    if (!lastQ) {
        return 'NEVER_STARTED';
    }

    // Check if user is up-to-date with current question
    if (lastQ.round === currentRound && lastQ.questionIndex === currentQuestionIndex) {
        return 'ACTIVE';
    }

    // User is behind
    if (lastQ.round < currentRound ||
        (lastQ.round === currentRound && lastQ.questionIndex < currentQuestionIndex)) {
        return 'BEHIND';
    }

    return 'ACTIVE';
}

/**
 * Get participation stats for admin dashboard
 */
export function getParticipationStats(currentRound, currentQuestionIndex) {
    const stats = {
        loggedInCount: 0,
        quizStartedCount: 0,
        socketConnectedCount: 0,
        currentRound,
        currentQuestionIndex,
        activeCount: 0,
        behindCount: 0,
        neverStartedCount: 0,
        disconnectedCount: 0,
        missingParticipants: [],
    };

    for (const [schoolId, user] of participationTracker.entries()) {
        stats.loggedInCount++;

        if (user.quizStartedAt) {
            stats.quizStartedCount++;
        }

        if (user.socketConnected) {
            stats.socketConnectedCount++;
        }

        const status = getParticipationStatus(user, currentRound, currentQuestionIndex);

        switch (status) {
            case 'ACTIVE':
                stats.activeCount++;
                break;
            case 'BEHIND':
                stats.behindCount++;
                stats.missingParticipants.push({
                    schoolId: user.schoolId,
                    schoolName: user.schoolName,
                    loggedInAt: user.loggedInAt,
                    quizStartedAt: user.quizStartedAt,
                    lastQuestionReceived: user.lastQuestionReceived,
                    lastAnswerSubmitted: user.lastAnswerSubmitted,
                    socketConnected: user.socketConnected,
                    status,
                });
                break;
            case 'NEVER_STARTED':
                stats.neverStartedCount++;
                stats.missingParticipants.push({
                    schoolId: user.schoolId,
                    schoolName: user.schoolName,
                    loggedInAt: user.loggedInAt,
                    quizStartedAt: null,
                    lastQuestionReceived: null,
                    lastAnswerSubmitted: null,
                    socketConnected: user.socketConnected,
                    status,
                });
                break;
            case 'DISCONNECTED':
                stats.disconnectedCount++;
                stats.missingParticipants.push({
                    schoolId: user.schoolId,
                    schoolName: user.schoolName,
                    loggedInAt: user.loggedInAt,
                    quizStartedAt: user.quizStartedAt,
                    lastQuestionReceived: user.lastQuestionReceived,
                    lastAnswerSubmitted: user.lastAnswerSubmitted,
                    socketConnected: false,
                    status,
                });
                break;
        }
    }

    // Sort missing participants: NEVER_STARTED first, then BEHIND, then DISCONNECTED
    const statusOrder = { 'NEVER_STARTED': 0, 'BEHIND': 1, 'DISCONNECTED': 2 };
    stats.missingParticipants.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    return stats;
}

/**
 * Reset participation tracker (on quiz reset)
 */
export function resetParticipationTracker() {
    // Keep login info but clear quiz progress
    for (const [schoolId, user] of participationTracker.entries()) {
        participationTracker.set(schoolId, {
            ...user,
            quizStartedAt: null,
            lastQuestionReceived: null,
            lastAnswerSubmitted: null,
        });
    }
}
