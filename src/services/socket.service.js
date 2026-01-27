import { Server } from "socket.io";
import { updateSocketConnection } from "../stores/participationTracker.store.js";

let io = null;

/**
 * Initialize Socket.io with the HTTP server
 * @param {http.Server} server - The HTTP server instance
 */
export function initializeSocket(server) {
	io = new Server(server, {
		path: "/quiz/socket.io/", // Match frontend path for production reverse proxy
		cors: {
			origin: "*", // Allow all origins for mobile app
			methods: ["GET", "POST"],
		},
		// Optimize for mobile connections
		pingTimeout: 60000,
		pingInterval: 25000,
	});

	io.on("connection", (socket) => {
		const clientCount = io.sockets.sockets.size;
		console.log(`[Socket] ✅ Client CONNECTED: ${socket.id}`);
		console.log(`[Socket] 📊 Total connected clients: ${clientCount}`);
		console.log(`[Socket] 🔌 Transport: ${socket.conn.transport.name}`);

		// Join the quiz room for broadcast events
		socket.join("quiz");
		console.log(`[Socket] 🏠 Client ${socket.id} joined "quiz" room`);

		// Handle client joining with their school ID for targeted messages
		socket.on("join-quiz", (data) => {
			const { schoolId } = data || {};
			if (schoolId) {
				socket.data.schoolId = schoolId;
				socket.join(`school-${schoolId}`);
				console.log(`[Socket] 🏫 School "${schoolId}" joined quiz room (socket: ${socket.id})`);

				// Track socket connection in participation tracker
				updateSocketConnection(schoolId, true, socket.id);
			}
		});

		// Handle disconnection
		socket.on("disconnect", (reason) => {
			const remainingClients = io.sockets.sockets.size;
			console.log(`[Socket] ❌ Client DISCONNECTED: ${socket.id}`);
			console.log(`[Socket] ❌ Reason: ${reason}`);
			console.log(`[Socket] 📊 Remaining clients: ${remainingClients}`);

			// Track socket disconnection in participation tracker
			const schoolId = socket.data.schoolId;
			if (schoolId) {
				updateSocketConnection(schoolId, false, null);
			}
		});

		// Handle errors
		socket.on("error", (error) => {
			console.error(`[Socket] ⚠️ Error for ${socket.id}:`, error);
		});
	});

	console.log("[Socket] Socket.io initialized");
	return io;
}

/**
 * Get the Socket.io instance
 * @returns {Server|null}
 */
export function getIO() {
	return io;
}

/**
 * Emit quiz state update to all connected clients
 * @param {string} event - Event name
 * @param {object} data - Event data
 */
export function emitQuizEvent(event, data) {
	if (!io) {
		console.warn("[Socket] ⚠️ Socket.io not initialized, cannot emit event");
		return;
	}

	// Get count of clients in quiz room
	const quizRoom = io.sockets.adapter.rooms.get("quiz");
	const clientCount = quizRoom ? quizRoom.size : 0;

	const eventData = {
		...data,
		timestamp: Date.now(),
	};

	// Broadcast to all clients in the quiz room
	io.to("quiz").emit(event, eventData);

	console.log(`[Socket] 📤 EMITTING EVENT`);
	console.log(`[Socket] 📤 Event: "${event}"`);
	console.log(`[Socket] 📤 To ${clientCount} client(s) in "quiz" room`);
	console.log(`[Socket] 📤 Data:`, JSON.stringify(eventData, null, 2));
}

/**
 * Emit event to a specific school
 * @param {string} schoolId - School identifier
 * @param {string} event - Event name
 * @param {object} data - Event data
 */
export function emitToSchool(schoolId, event, data) {
	if (!io) {
		console.warn("[Socket] Socket.io not initialized, cannot emit event");
		return;
	}

	io.to(`school-${schoolId}`).emit(event, {
		...data,
		timestamp: Date.now(),
	});
}

// Event types for quiz synchronization
export const QUIZ_EVENTS = {
	// Round lifecycle
	ROUND_STARTED: "round:started",
	ROUND_COMPLETED: "round:completed",

	// Question lifecycle
	QUESTION_STARTED: "question:started",
	QUESTION_ADVANCED: "question:advanced",
	TIMER_SYNC: "timer:sync",

	// Quiz lifecycle
	QUIZ_RESET: "quiz:reset",

	// Announcements
	ANNOUNCEMENT: "announcement",
	ANNOUNCEMENT_CLEARED: "announcement:cleared",

	// Settings
	SETTINGS_UPDATED: "settings:updated",

	// Leaderboard/Scores
	LEADERBOARD_UPDATED: "leaderboard:updated",

	// Session management
	FORCE_LOGOUT: "auth:force-logout",
};

