#!/usr/bin/env node

/**
 * Seed gameplay questions from a JSON file.
 *
 * Usage:
 *   nvm use 20
 *   node scripts/seed-game-questions.js --file ./data/outside-the-box.json
 *
 * If --file is omitted, the script falls back to the OUTSIDE_BOX_FILE env var,
 * or `./data/outside-the-box.json` relative to the project root.
 */

import fs from "fs/promises";
import path from "path";
import url from "url";
import mongoose from "mongoose";
import dotenv from "dotenv";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { gameQuestionService } from "../src/services/gameQuestion.service.js";
import "../src/models/gameQuestion.model.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config();

const argv = yargs(hideBin(process.argv))
	.option("file", {
		type: "string",
		describe: "Path to JSON file containing game questions",
	})
	.option("dry-run", {
		type: "boolean",
		default: false,
		describe: "Validate and preview without writing to the database",
	})
	.help()
	.alias("help", "h").argv;

const resolveFilePath = () => {
	if (argv.file) {
		return path.resolve(process.cwd(), argv.file);
	}
	if (process.env.OUTSIDE_BOX_FILE) {
		return path.resolve(process.cwd(), process.env.OUTSIDE_BOX_FILE);
	}
	return path.resolve(__dirname, "../data/outside-the-box.json");
};

const normaliseQuestion = (question, index) => {
	if (!question) return null;

	const options = Array.isArray(question.options)
		? question.options
				.filter((opt) => opt && typeof opt.text === "string")
				.map((opt) => ({
					text: String(opt.text).trim(),
					correctness:
						Number.isFinite(opt.correctness) && opt.correctness >= 0
							? Number(opt.correctness)
							: 0,
				}))
		: [];

	if (!question.question && !question.prompt) {
		throw new Error(`Question at index ${index} is missing the "question" field`);
	}

	if (options.length === 0) {
		throw new Error(`Question "${question.question}" has no valid options`);
	}

	return {
		questionType: question.question_type || question.questionType || "",
		prompt: String(question.question || question.prompt).trim(),
		options,
		meta: question.meta || {},
	};
};

async function main() {
	const filePath = resolveFilePath();
	const mongoUri =
		process.env.MONGO_URL ||
		process.env.MONGODB_URI ||
		"mongodb://127.0.0.1:27017/quiz_service";

	console.log("📄 Reading questions from:", filePath);
	console.log("🛢️  Mongo URI:", mongoUri);

	const buffer = await fs.readFile(filePath, "utf8");
	const raw = JSON.parse(buffer);
	const questions = Array.isArray(raw) ? raw : raw?.questions;

	if (!Array.isArray(questions) || questions.length === 0) {
		throw new Error("Parsed file does not contain any questions");
	}

	const normalised = questions.map(normaliseQuestion).filter(Boolean);

	console.log(`✅ Parsed ${normalised.length} questions`);

	if (argv["dry-run"]) {
		console.log("Dry-run enabled. Preview of first question:", normalised[0]);
		return;
	}

	await mongoose.connect(mongoUri);
	console.log("✅ Connected to MongoDB");

	const result = await gameQuestionService.bulkUpsert(normalised);

	console.log("📥 Seed result:", result);

	await mongoose.disconnect();
	console.log("👋 Disconnected from MongoDB");
}

main()
	.then(() => {
		console.log("🎉 Seeding complete");
		process.exit(0);
	})
	.catch((err) => {
		console.error("❌ Seeding failed", err);
		process.exit(1);
	});

