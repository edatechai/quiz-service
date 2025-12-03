import mongoose from "mongoose";
import dotenv from "dotenv";
import { GameQuestion } from "../src/models/gameQuestion.model.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "../.env") });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/edat-quiz";

async function checkQuestionTypes() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log("Connected to MongoDB\n");

        const questions = await GameQuestion.find({}).lean();

        console.log(`Total questions: ${questions.length}\n`);
        questions.forEach((q, i) => {
            console.log(`${i + 1}. questionType: "${q.questionType}" (type: ${typeof q.questionType}, length: ${q.questionType?.length})`);
            console.log(`   Prompt: ${q.prompt.substring(0, 50)}...`);
            console.log(`   Raw questionType bytes:`, Buffer.from(q.questionType || '').toString('hex'));
            console.log();
        });

        // Test the query
        console.log('\nTesting query for "INSIDE_THE_BOX":');
        const result = await GameQuestion.find({ questionType: "INSIDE_THE_BOX" }).lean();
        console.log(`Found ${result.length} questions`);

        await mongoose.disconnect();
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
}

checkQuestionTypes();
