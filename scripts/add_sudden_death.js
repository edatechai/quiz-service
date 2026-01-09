import "dotenv/config";
import mongoose from "mongoose";
import { GameQuestion } from "../src/models/gameQuestion.model.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "../.env") });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/edat-quiz";

async function addSuddenDeath() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log("Connected to MongoDB");

        // Add the Sudden Death question
        const sdQuestion = {
            prompt: "Based on the probability matrix shown above, what is the expected value of drawing two balls from the container?",
            questionType: "SUDDEN_DEATH",
            options: [
                { text: "None of the above", correctness: 0, score: 0 },
                { text: "30", correctness: 3, score: 10 },
                { text: "15", correctness: 6, score: 20 },
                { text: "185", correctness: 1.5, score: 5 }
            ],
            meta: {
                id: "SD01",
                hint: "Calculate the probability of each outcome and multiply by the points for that outcome.",
                explanation: "This is a Sudden Death question - your score multiplier depends on your answer choice!",
                timeLimit: 60,
                imageUri: "sd.jpeg",
                isSuddenDeath: true
            }
        };

        // Upsert the question
        const result = await GameQuestion.findOneAndUpdate(
            { questionType: "SUDDEN_DEATH" },
            sdQuestion,
            { upsert: true, new: true }
        );

        console.log("\n✅ Sudden Death question added:");
        console.log("  ID:", result._id);
        console.log("  Type:", result.questionType);
        console.log("  Prompt:", result.prompt.substring(0, 60) + "...");
        console.log("  Image:", result.meta?.imageUri);

        // Verify total count
        const count = await GameQuestion.countDocuments();
        const sdCount = await GameQuestion.countDocuments({ questionType: "SUDDEN_DEATH" });
        console.log(`\nTotal questions: ${count}`);
        console.log(`Sudden Death questions: ${sdCount}`);

        await mongoose.disconnect();
        console.log("\nDone!");
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
}

addSuddenDeath();
