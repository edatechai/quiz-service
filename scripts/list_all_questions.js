import mongoose from "mongoose";
import dotenv from "dotenv";
import { GameQuestion } from "../src/models/gameQuestion.model.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "../.env") });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/edat-quiz";

async function listAll() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log("Connected to MongoDB\n");

        const questions = await GameQuestion.find({}).lean();

        console.log(`Total questions in database: ${questions.length}\n`);
        questions.forEach((q, i) => {
            console.log(`${i + 1}. Type: "${q.questionType || '(empty)'}" - ${q.prompt.substring(0, 70)}...`);
        });

        await mongoose.disconnect();
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
}

listAll();
