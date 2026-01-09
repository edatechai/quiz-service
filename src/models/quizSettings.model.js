import mongoose from 'mongoose';

const QuizSettingsSchema = new mongoose.Schema({
    // Singleton document ID (always 'default')
    _id: {
        type: String,
        default: 'default',
    },
    // Question duration in seconds
    questionDuration: {
        type: Number,
        default: 60,
        min: 5,
        max: 300,
    },
    // Global time limit override in seconds (null/undefined means no override, uses question's timeLimit)
    globalTimeLimitOverride: {
        type: Number,
        default: undefined, // Don't set default, allow null/undefined
        min: 5,
        max: 300,
        required: false, // Make it optional
    },
}, {
    timestamps: true,
});

export const QuizSettings = mongoose.model('QuizSettings', QuizSettingsSchema);

// Helper function to get or create settings
export async function getQuizSettings() {
    let settings = await QuizSettings.findById('default');

    if (!settings) {
        // Create default settings on first run
        settings = await QuizSettings.create({
            _id: 'default',
            questionDuration: 60,
        });
    }

    return settings;
}

// Helper function to update settings
export async function updateQuizSettings(updates) {
    const settings = await QuizSettings.findByIdAndUpdate(
        'default',
        updates,
        { new: true, upsert: true, runValidators: true }
    );

    return settings;
}
