import mongoose, { Schema } from "mongoose";

/**
 * GameLeaderboard Schema
 * 
 * GAME-08: Supports atomic score updates via the `answers` field
 * Each answer is stored with a unique key (round_questionIndex) to prevent duplicates
 * The totalScore is updated atomically using $inc operator
 */
const GameLeaderboardSchema = new Schema(
	{
		schoolId: { type: String, required: true, index: true, unique: true },
		schoolName: { type: String, required: true, trim: true },
		teamName: { type: String, default: "", trim: true },
		totalScore: { type: Number, default: 0 },
		roundsPlayed: { type: Number, default: 0 },
		lastSubmissionAt: { type: Date, default: Date.now },
		// Per-round score tracking: { "0": 15.5, "1": 22.0, "2": 18.3 }
		// Key is round index (as string), value is total score for that round
		roundScores: {
			type: Schema.Types.Mixed,
			default: {},
		},
		// GAME-08: Store individual answers for atomicity and duplicate prevention
		// Key format: "round{N}_q{M}" where N is round index, M is question index
		// This allows checking if an answer was already submitted before adding score
		answers: {
			type: Schema.Types.Mixed,
			default: {},
		},
		meta: {
			type: Schema.Types.Mixed,
			default: {},
		},
	},
	{ timestamps: true }
);

GameLeaderboardSchema.set("toJSON", {
	virtuals: true,
	versionKey: false,
	transform: (_, ret) => {
		ret.id = ret._id.toString();
		delete ret._id;
		return ret;
	},
});

export const GameLeaderboard =
	mongoose.models.GameLeaderboard ||
	mongoose.model("GameLeaderboard", GameLeaderboardSchema);

