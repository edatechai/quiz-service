import http from "http";
import app from "./app.js";
import { env } from "./config/env.js";
import { connectToDatabase, disconnectFromDatabase } from "./config/db.js";
import { startAITeamPolling, stopAITeamPolling } from "./services/aiTeamQuiz.service.js";
import { initializeSocket } from "./services/socket.service.js";

const server = http.createServer(app);

// Initialize Socket.io for real-time quiz synchronization
initializeSocket(server);

async function start() {
	try {
		await connectToDatabase();
		// eslint-disable-next-line no-console
		console.log("Connected to MongoDB");

		// Load persisted quiz state from database (survives restarts)
		try {
			const { loadFromDatabase } = await import("./stores/quizState.store.js");
			await loadFromDatabase();
			console.log("[Server] Quiz state restored from database");
		} catch (error) {
			console.error("[Server] Failed to load quiz state from DB:", error);
		}

		// Initialize quiz settings from database
		try {
			const { getQuizSettings } = await import("./models/quizSettings.model.js");
			const { setQuestionDuration, setGlobalTimeLimitOverride } = await import("./stores/quizState.store.js");

			const settings = await getQuizSettings();
			setQuestionDuration(settings.questionDuration);
			setGlobalTimeLimitOverride(settings.globalTimeLimitOverride ?? null);
			console.log(`[Server] Loaded question duration from DB: ${settings.questionDuration} seconds`);
			if (settings.globalTimeLimitOverride !== null && settings.globalTimeLimitOverride !== undefined) {
				console.log(`[Server] Loaded global time limit override from DB: ${settings.globalTimeLimitOverride} seconds`);
			}
		} catch (error) {
			console.error("[Server] Failed to load settings from DB, using defaults:", error);
		}

		// Register error handler BEFORE calling listen
		server.on('error', (err) => {
			if (err.code === 'EADDRINUSE') {
				// eslint-disable-next-line no-console
				console.error(`Port ${env.port} is already in use. Kill the process using it or set a different QUIZ_SERVICE_PORT/PORT in .env`);
				process.exit(1);
			} else {
				// eslint-disable-next-line no-console
				console.error('Server error:', err);
				process.exit(1);
			}
		});

		server.listen(env.port, "0.0.0.0", () => {
			// eslint-disable-next-line no-console
			console.log(`Quiz service listening on port ${env.port} (0.0.0.0)`);

			// Start AI team polling (checks for new questions every 3 seconds)
			const apiKey = (env.deepseekApiKey || process.env.DEEPSEEK_API_KEY || "").trim();
			if (apiKey) {
				startAITeamPolling(3000);
				console.log("AI Team polling started");
			} else {
				console.warn("DEEPSEEK_API_KEY not configured. AI Team will not participate.");
			}
		});
	} catch (err) {
		// eslint-disable-next-line no-console
		console.error("Failed to connect to MongoDB", err);
		process.exit(1);
	}
}

// Graceful shutdown for nodemon restarts
async function shutdown(signal) {
	// eslint-disable-next-line no-console
	console.log(`${signal} received, shutting down gracefully...`);

	// Stop AI team polling
	stopAITeamPolling();

	server.close(async () => {
		await disconnectFromDatabase();
		// eslint-disable-next-line no-console
		console.log("Server closed");
		process.exit(0);
	});

	// Force exit if graceful shutdown takes too long
	setTimeout(() => {
		// eslint-disable-next-line no-console
		console.error("Forced shutdown");
		process.exit(1);
	}, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
