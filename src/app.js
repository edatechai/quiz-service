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
	origin: env.corsOrigin === "*" ? true : env.corsOrigin,
	credentials: true,
	methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
	allowedHeaders: ["Content-Type", "Authorization"],
};

const app = express();

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use(morgan(env.logLevel));

app.use("/health", healthRouter);
app.use("/api/quizzes", quizRouter);
app.use("/api/auth", authRouter);
app.use("/api/game", gameRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
