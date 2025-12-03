import { Router } from "express";
import { listQuizzes, getQuiz, createQuiz, updateQuiz, deleteQuiz } from "../controllers/quiz.controller.js";

const router = Router();

router.get("/", listQuizzes);
router.get("/:id", getQuiz);
router.post("/", createQuiz);
router.patch("/:id", updateQuiz);
router.delete("/:id", deleteQuiz);

export default router;
