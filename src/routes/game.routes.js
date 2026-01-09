import { Router } from "express";
import { debugQuestionTypes, listGameQuestions, uploadQuestions, getCurrentQuizState, updateCurrentQuizState, startRound, resetQuiz, getQuestionHint, submitAnswer, postAnnouncement, getAnnouncement, deleteAnnouncement, getRoundSummary, finalizeRound, getFinalStandings, getSettings, updateSettings } from "../controllers/game.controller.js";
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

router.get("/debug/question-types", debugQuestionTypes); // DEBUG endpoint
router.get("/questions", listGameQuestions);
router.post("/questions", uploadQuestions); // Admin endpoint to upload questions
router.get("/leaderboard", listLeaderboardScores);
router.post("/leaderboard", requireAuth, submitLeaderboardScore);
router.patch("/leaderboard/live", requireAuth, updateLiveScore);
router.get("/quiz-time", getQuizTime);
router.post("/quiz-time/start", startQuiz);
router.post("/quiz-time/stop", stopQuiz);
router.get("/quiz-state", getCurrentQuizState);
router.post("/quiz-state", updateCurrentQuizState); // Admin endpoint - no auth for consistency with startRound/reset
router.post("/round/start", startRound); // Admin endpoint - no auth required for now, can add admin auth later
router.post("/reset", resetQuiz); // Admin endpoint to reset all quiz state
router.get("/hint", requireAuth, getQuestionHint); // Get AI hint for current question
router.post("/answer", requireAuth, submitAnswer); // Submit answer with time-based scoring

// LB-05: Announcement routes
router.post("/announcement", postAnnouncement); // Admin endpoint - publish announcement
router.get("/announcement", getAnnouncement);   // Get current announcement (no auth for simplicity)
router.delete("/announcement", deleteAnnouncement); // Admin endpoint - clear announcement

// SUMM-01: Round Summary (Rankings, MVP, Promotions)
router.get("/summary/:roundIndex", getRoundSummary);

// SUMM-04: Finalize Round (Apply tier updates)
router.post("/round/finalize", finalizeRound);

// SUMM-05: Final Standings (Overall competition results)
router.get("/final-standings", getFinalStandings);

// SETTINGS: Quiz settings endpoints (admin)
router.get("/settings", getSettings);
router.post("/settings", updateSettings);

export default router;

