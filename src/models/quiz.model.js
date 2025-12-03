import mongoose, { Schema } from "mongoose";

const QuestionSchema = new Schema(
	{
		prompt: { type: String, required: true, trim: true },
		choices: { type: [String], default: [] },
		answerIndex: { type: Number, default: null },
	},
	{ _id: false }
);

const QuizSchema = new Schema(
	{
		title: { type: String, required: true, trim: true },
		description: { type: String, default: "" },
		questions: { type: [QuestionSchema], default: [] },
	},
	{ timestamps: true }
);

QuizSchema.set("toJSON", {
	virtuals: true,
	versionKey: false,
	transform: (_, ret) => {
		ret.id = ret._id.toString();
		delete ret._id;
		return ret;
	},
});

export const Quiz = mongoose.models.Quiz || mongoose.model("Quiz", QuizSchema);
