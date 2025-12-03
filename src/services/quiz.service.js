import { Quiz } from "../models/quiz.model.js";

function validateQuizPayload(payload) {
	const errors = [];
	if (!payload || typeof payload !== "object") errors.push("Body must be an object");
	const { title, description, questions } = payload || {};
	if (!title || typeof title !== "string" || !title.trim()) errors.push("title is required");
	if (description !== undefined && typeof description !== "string") errors.push("description must be a string");
	if (questions !== undefined && !Array.isArray(questions)) errors.push("questions must be an array");
	return { errors, value: { title: title?.trim(), description, questions: questions || [] } };
}

export const quizService = {
	async list() {
		const docs = await Quiz.find().sort({ createdAt: -1 }).lean({ virtuals: true });
		return docs;
	},
	async get(id) {
		const doc = await Quiz.findById(id).lean({ virtuals: true });
		return doc;
	},
	async create(payload) {
		const { errors, value } = validateQuizPayload(payload);
		if (errors.length) {
			const err = new Error(errors.join(", "));
			err.status = 400;
			throw err;
		}
		const created = await Quiz.create(value);
		return created.toJSON();
	},
	async update(id, payload) {
		const { title, description, questions } = payload || {};
		const updateData = {};
		if (title !== undefined) {
			if (typeof title !== "string" || !title.trim()) {
				const err = new Error("title must be a non-empty string");
				err.status = 400;
				throw err;
			}
			updateData.title = title.trim();
		}
		if (description !== undefined) {
			if (typeof description !== "string") {
				const err = new Error("description must be a string");
				err.status = 400;
				throw err;
			}
			updateData.description = description;
		}
		if (questions !== undefined) {
			if (!Array.isArray(questions)) {
				const err = new Error("questions must be an array");
				err.status = 400;
				throw err;
			}
			updateData.questions = questions;
		}
		const updated = await Quiz.findByIdAndUpdate(
			id,
			{ $set: updateData },
			{ new: true, runValidators: true }
		);
		return updated ? updated.toJSON() : null;
	},
	async remove(id) {
		const res = await Quiz.findByIdAndDelete(id);
		return Boolean(res);
	},
};
