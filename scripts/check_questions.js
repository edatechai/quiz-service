import mongoose from "mongoose";
import dotenv from "dotenv";
import { GameQuestion } from "../src/models/gameQuestion.model.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "../.env") });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/edat-quiz";

async function checkQuestions() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log("Connected to MongoDB");

        const distribution = await GameQuestion.aggregate([
            { $group: { _id: "$questionType", count: { $sum: 1 } } }
        ]);

        console.log("\nQuestion Distribution:");
        distribution.forEach(d => {
            console.log(`  ${d._id || '(empty)'}: ${d.count} questions`);
        });

        const insideTheBox = await GameQuestion.find({ questionType: "INSIDE_THE_BOX" });
        console.log(`\nInside the Box questions: ${insideTheBox.length}`);
        insideTheBox.forEach((q, i) => {
            console.log(`  ${i + 1}. ${q.prompt.substring(0, 50)}...`);
        });

        await mongoose.disconnect();
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
}

checkQuestions();
