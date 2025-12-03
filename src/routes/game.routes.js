import { Router } from "express";
import { listGameQuestions, getCurrentQuizState, updateCurrentQuizState, startRound, resetQuiz, getQuestionHint, submitAnswer } from "../controllers/game.controller.js";
import {
	listLeaderboardScores,
	submitLeaderboardScore,
	updateLiveScore,
	getQuizTime,
	startQuiz,
	stopQuiz,
} from "../controllers/gameLeaderboard.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.get("/questions", listGameQuestions);
router.get("/leaderboard", listLeaderboardScores);
router.post("/leaderboard", requireAuth, submitLeaderboardScore);
router.patch("/leaderboard/live", requireAuth, updateLiveScore);
router.get("/quiz-time", getQuizTime);
router.post("/quiz-time/start", startQuiz);
router.post("/quiz-time/stop", stopQuiz);
router.get("/quiz-state", getCurrentQuizState);
router.post("/quiz-state", requireAuth, updateCurrentQuizState);
router.post("/round/start", startRound); // Admin endpoint - no auth required for now, can add admin auth later
router.post("/reset", resetQuiz); // Admin endpoint to reset all quiz state
router.get("/hint", requireAuth, getQuestionHint); // Get AI hint for current question
router.post("/answer", requireAuth, submitAnswer); // Submit answer with time-based scoring

export default router;

