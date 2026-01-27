import express from "express";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";
import healthRouter from "./routes/health.routes.js";
import quizRouter from "./routes/quiz.routes.js";
import authRouter from "./routes/auth.routes.js";
import gameRouter from "./routes/game.routes.js";

const corsOptions = {
	origin: true, // Allow all origins (simpler for development/admin endpoints)
	credentials: true,
	methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
	allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
	optionsSuccessStatus: 200, // Some legacy browsers choke on 204
};

const app = express();

// CORS middleware handles preflight automatically
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
// app.use(morgan(env.logLevel)); // Disabled to reduce terminal noise




app.use("/health", healthRouter);
app.use("/quiz/health", healthRouter);
app.use("/quiz/api/health", healthRouter);

const apiRouter = express.Router();
apiRouter.use("/quizzes", quizRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/game", gameRouter);

// Only register /api - nginx rewrites /quiz/api to /api
app.use("/api", apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
