import "dotenv/config";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import the GameQuestion model
import { GameQuestion } from "../src/models/gameQuestion.model.js";

const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/edat-quiz";

async function seedQuestions() {
    try {
        // Connect to MongoDB
        await mongoose.connect(MONGO_URI);
        console.log("Connected to MongoDB");

        // Read the JSON file
        const jsonPath = path.resolve(__dirname, "../../quizQuesions.JSON");
        const jsonData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

        console.log(`\nFound ${jsonData.metadata.totalQuestions} questions in JSON file`);
        console.log("Categories:", jsonData.metadata.categories);

        // Clear existing questions (optional - comment out if you want to keep existing)
        const deleteResult = await GameQuestion.deleteMany({});
        console.log(`\nCleared ${deleteResult.deletedCount} existing questions`);

        // Transform questions to database schema
        const transformedQuestions = jsonData.questions.map((q) => {
            // Map type to questionType (uppercase with underscores)
            const questionType = (q.type || "")
                .toUpperCase()
                .replace(/ /g, "_");

            // Map options
            const options = (q.options || []).map((opt) => ({
                text: opt.text || "",
                // Score of 10 is "correct", normalize to correctness scale (0-3)
                // null scores are for inside_the_box questions (no right answer)
                correctness: opt.score === null ? 0 : (opt.score === 10 ? 3 : (opt.score / 10) * 3),
                score: opt.score, // Keep original score for 50/50 elimination
            }));

            return {
                prompt: q.question || "",
                questionType,
                options,
                meta: {
                    id: q.id,
                    hint: q.hint,
                    explanation: q.explanation,
                    timeLimit: q.timeLimit || 60,
                    category: q.category,
                    llm_response: q.llm_response,
                    llm_rationale: q.llm_rationale,
                    llm_correctness: q.llm_correctness,
                    llm_response_time: q.llm_response_time,
                    llm_score: q.llm_score,
                    // Mark sudden death questions if any
                    isSuddenDeath: q.type === "sudden_death",
                    imageUri: q.imageUri || null,
                },
            };
        });

        // Insert all questions
        const result = await GameQuestion.insertMany(transformedQuestions);
        console.log(`\nInserted ${result.length} questions`);

        // Count by type
        const typeCounts = {};
        transformedQuestions.forEach((q) => {
            typeCounts[q.questionType] = (typeCounts[q.questionType] || 0) + 1;
        });
        console.log("\nQuestions by type:");
        Object.entries(typeCounts).forEach(([type, count]) => {
            console.log(`  ${type}: ${count}`);
        });

        console.log("\n✅ Seeding complete!");

    } catch (error) {
        console.error("Error seeding questions:", error);
    } finally {
        await mongoose.disconnect();
        console.log("Disconnected from MongoDB");
    }
}

seedQuestions();
