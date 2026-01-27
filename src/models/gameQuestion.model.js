import mongoose, { Schema } from "mongoose";

const OptionSchema = new Schema(
	{
		text: { type: String, required: true, trim: true },
		correctness: { type: Number, default: 0 },
		score: { type: Number, default: 0 },
		multiplier: { type: Number, default: 1 },
	},
	{ _id: false }
);

const GameQuestionSchema = new Schema(
	{
		questionType: { type: String, default: "", trim: true },
		prompt: { type: String, required: true, trim: true, unique: true },
		options: { type: [OptionSchema], default: [] },
		meta: {
			type: Schema.Types.Mixed,
			default: {},
		},
	},
	{ timestamps: true }
);

GameQuestionSchema.set("toJSON", {
	virtuals: true,
	versionKey: false,
	transform: (_, ret) => {
		ret.id = ret._id.toString();
		delete ret._id;
		return ret;
	},
});

export const GameQuestion =
	mongoose.models.GameQuestion ||
	mongoose.model("GameQuestion", GameQuestionSchema);

