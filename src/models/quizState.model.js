import mongoose from 'mongoose';

/**
 * QuizState Model - Singleton document for persistent quiz state
 * 
 * This model stores the current quiz state in MongoDB so it survives
 * server restarts. Uses a fixed _id of 'current' for singleton pattern.
 */

const QuizStateSchema = new mongoose.Schema({
    // Singleton document ID (always 'current')
    _id: {
        type: String,
        default: 'current',
    },
    // Current round index (-1 means no round started, 0-4 when active)
    currentRound: {
        type: Number,
        default: -1,
    },
    // Current question index within the round (0-indexed)
    currentQuestionIndex: {
        type: Number,
        default: 0,
    },
    // Current question object (denormalized for fast access)
    currentQuestion: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
    },
    // All questions for the current round (pre-fetched)
    roundQuestions: {
        type: [mongoose.Schema.Types.Mixed],
        default: [],
    },
    // Whether quiz is active
    isActive: {
        type: Boolean,
        default: false,
    },
    // Whether the current round has been started
    roundStarted: {
        type: Boolean,
        default: false,
    },
    // When the current question started (for timer calculations)
    questionStartTime: {
        type: Number,
        default: null,
    },
    // Question duration in milliseconds
    questionDuration: {
        type: Number,
        default: 60000,
    },
    // Auto-advance enabled
    autoAdvanceEnabled: {
        type: Boolean,
        default: true,
    },
    // Global time limit override in seconds (null = no override)
    globalTimeLimitOverride: {
        type: Number,
        default: null,
    },
    // Used question IDs to prevent repetition across rounds
    usedQuestionIds: {
        type: [String],
        default: [],
    },
}, {
    timestamps: true,
});

export const QuizState = mongoose.model('QuizState', QuizStateSchema);

/**
 * Get current quiz state from database
 * Creates default state if none exists
 */
export async function getPersistedQuizState() {
    let state = await QuizState.findById('current');

    if (!state) {
        state = await QuizState.create({
            _id: 'current',
            currentRound: -1,
            currentQuestionIndex: 0,
            currentQuestion: null,
            roundQuestions: [],
            isActive: false,
            roundStarted: false,
            questionStartTime: null,
            questionDuration: 60000,
            autoAdvanceEnabled: true,
            globalTimeLimitOverride: null,
            usedQuestionIds: [],
        });
    }

    return state;
}

/**
 * Save quiz state to database
 * Uses upsert to create or update
 */
export async function savePersistedQuizState(stateData) {
    const state = await QuizState.findByIdAndUpdate(
        'current',
        stateData,
        { new: true, upsert: true }
    );

    return state;
}

/**
 * Reset quiz state in database
 */
export async function resetPersistedQuizState() {
    const state = await QuizState.findByIdAndUpdate(
        'current',
        {
            currentRound: -1,
            currentQuestionIndex: 0,
            currentQuestion: null,
            roundQuestions: [],
            isActive: false,
            roundStarted: false,
            questionStartTime: null,
            usedQuestionIds: [],
        },
        { new: true, upsert: true }
    );

    return state;
}
