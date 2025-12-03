import { quizService } from "../services/quiz.service.js";

export const listQuizzes = async (req, res, next) => {
	try {
		const quizzes = await quizService.list();
		res.json({ data: quizzes });
	} catch (err) {
		next(err);
	}
};

export const getQuiz = async (req, res, next) => {
	try {
		const quiz = await quizService.get(req.params.id);
		if (!quiz) return res.status(404).json({ message: "Quiz not found" });
		res.json({ data: quiz });
	} catch (err) {
		next(err);
	}
};

export const createQuiz = async (req, res, next) => {
	try {
		const created = await quizService.create(req.body);
		res.status(201).json({ data: created });
	} catch (err) {
		next(err);
	}
};

export const updateQuiz = async (req, res, next) => {
	try {
		const updated = await quizService.update(req.params.id, req.body);
		if (!updated) return res.status(404).json({ message: "Quiz not found" });
		res.json({ data: updated });
	} catch (err) {
		next(err);
	}
};

export const deleteQuiz = async (req, res, next) => {
	try {
		const ok = await quizService.remove(req.params.id);
		if (!ok) return res.status(404).json({ message: "Quiz not found" });
		res.status(204).send();
	} catch (err) {
		next(err);
	}
};
