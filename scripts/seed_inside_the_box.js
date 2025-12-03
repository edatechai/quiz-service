import mongoose from "mongoose";
import dotenv from "dotenv";
import { GameQuestion } from "../src/models/gameQuestion.model.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, "../.env") });

const MONGODB_URI = process.env.MONGO_URL || process.env.MONGODB_URI || "mongodb://localhost:27017/edat-quiz";

console.log("Using MongoDB URI:", MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')); // Hide credentials

const insideTheBoxQuestions = [
    {
        prompt: "Which color is the most popular among the teams here?",
        questionType: "INSIDE_THE_BOX",
        options: [
            { text: "Blue", correctness: 0 },
            { text: "Red", correctness: 0 },
            { text: "Green", correctness: 0 },
            { text: "Yellow", correctness: 0 },
        ],
        meta: {
            category: "Consensus",
            difficulty: "Medium",
        },
    },
    {
        prompt: "If you had to choose a superpower, which one would the majority pick?",
        questionType: "INSIDE_THE_BOX",
        options: [
            { text: "Flight", correctness: 0 },
            { text: "Invisibility", correctness: 0 },
            { text: "Teleportation", correctness: 0 },
            { text: "Time Travel", correctness: 0 },
        ],
        meta: {
            category: "Consensus",
            difficulty: "Hard",
        },
    },
    {
        prompt: "What is the best pizza topping according to this room?",
        questionType: "INSIDE_THE_BOX",
        options: [
            { text: "Pepperoni", correctness: 0 },
            { text: "Mushrooms", correctness: 0 },
            { text: "Pineapple", correctness: 0 },
            { text: "Extra Cheese", correctness: 0 },
        ],
        meta: {
            category: "Consensus",
            difficulty: "Easy",
        },
    },
];

async function seed() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log("Connected to MongoDB");

        console.log("Seeding Inside the Box questions...");

        const operations = insideTheBoxQuestions.map((question) => ({
            updateOne: {
                filter: { prompt: question.prompt },
                update: { $set: question },
                upsert: true,
            },
        }));

        const result = await GameQuestion.bulkWrite(operations);
        console.log(`Seeded ${result.upsertedCount + result.modifiedCount} questions.`);

        await mongoose.disconnect();
        console.log("Disconnected from MongoDB");
    } catch (error) {
        console.error("Error seeding questions:", error);
        process.exit(1);
    }
}

seed();
