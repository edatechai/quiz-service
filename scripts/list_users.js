
import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { GameLeaderboard } from "../src/models/gameLeaderboard.model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "../.env") });

// Use env var or fallback
const MONGODB_URI = process.env.MONGO_URL || process.env.MONGODB_URI || "mongodb://localhost:27017/edat-quiz";

async function listUsers() {
    console.log(`🔍 Listing users from ${MONGODB_URI}...`);

    try {
        await mongoose.connect(MONGODB_URI);

        const count = await GameLeaderboard.countDocuments();
        console.log(`📊 Total users in DB: ${count}`);

        const users = await GameLeaderboard.find().select('schoolId schoolName totalScore').limit(20).lean();

        users.forEach(u => {
            console.log(` - ID: "${u.schoolId}" | Name: "${u.schoolName}" | Score: ${u.totalScore}`);
        });

        await mongoose.disconnect();

    } catch (error) {
        console.error("❌ Error:", error);
    }
}

listUsers();
