import http from "http";
import app from "./app.js";
import { env } from "./config/env.js";
import { connectToDatabase, disconnectFromDatabase } from "./config/db.js";
import { startAITeamPolling, stopAITeamPolling } from "./services/aiTeamQuiz.service.js";

const server = http.createServer(app);

async function start() {
	try {
		await connectToDatabase();
		// eslint-disable-next-line no-console
		console.log("Connected to MongoDB");
		
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

		server.listen(env.port, () => {
			// eslint-disable-next-line no-console
			console.log(`Quiz service listening on port ${env.port}`);
			
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
