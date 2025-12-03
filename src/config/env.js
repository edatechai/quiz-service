import dotenv from "dotenv";

dotenv.config();

export const env = {
	nodeEnv: process.env.NODE_ENV || "development",
	port: Number(process.env.QUIZ_SERVICE_PORT || process.env.PORT || 1234),
	logLevel: process.env.LOG_LEVEL || "dev",
	corsOrigin: process.env.CORS_ORIGIN || "*",
	mongoUri: process.env.MONGO_URL || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/quiz_service",
	sessionSecret: process.env.SESSION_SECRET || "change-me-in-production",
	deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
};
