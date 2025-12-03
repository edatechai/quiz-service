// Quick test to verify Round 2 questions
import mongoose from "mongoose";
import dotenv from "dotenv";
import { gameQuestionService } from "../src/services/gameQuestion.service.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "../.env") });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/edat-quiz";

async function testRound2Questions() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log("Connected to MongoDB\n");

        console.log("Testing Round 2 (roundIndex = 1) question selection:");
        const round2Questions = await gameQuestionService.listByType({ limit: 5, round: 1 });

        console.log(`\nFound ${round2Questions.length} questions for Round 2:`);
        round2Questions.forEach((q, i) => {
            console.log(`  ${i + 1}. Type: "${q.questionType}" - ${q.prompt.substring(0, 60)}...`);
        });

        console.log("\n\nTesting Round 1 (roundIndex = 0) question selection:");
        const round1Questions = await gameQuestionService.listByType({ limit: 5, round: 0 });

        console.log(`\nFound ${round1Questions.length} questions for Round 1:`);
        round1Questions.forEach((q, i) => {
            console.log(`  ${i + 1}. Type: "${q.questionType}" - ${q.prompt.substring(0, 60)}...`);
        });

        await mongoose.disconnect();
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
}

testRound2Questions();
