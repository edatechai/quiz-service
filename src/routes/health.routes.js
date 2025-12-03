import { Router } from "express";

const router = Router();

router.get("/", (req, res) => {
	res.json({ status: "ok", service: "quiz-service" });
});

export default router;
