
import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { GameLeaderboard } from "../src/models/gameLeaderboard.model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "../.env") });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/edat-quiz";

async function debugUserState() {
    console.log("🔍 Starting User State Debug...");

    try {
        await mongoose.connect(MONGODB_URI);

        // ID from the log: 6962583d04180950e415a53d
        // Note: schoolId might be this string, or it might be an ObjectId. 
        // Based on logs "Batch Submit] 6962...", it's likely the schoolId string.
        const targetId = "6962583d04180950e415a53d";

        const user = await GameLeaderboard.findOne({ schoolId: targetId }).lean();

        if (!user) {
            console.error(`❌ User ${targetId} not found!`);
            return;
        }

        console.log(`\n👤 User: ${user.schoolName || user.schoolId}`);
        console.log(`🏆 Total Score: ${user.totalScore}`);
        console.log(`📊 Round Scores:`, user.roundScores);

        console.log(`\n📝 Round 4 (Index 3) Answers:`);
        const round3Keys = Object.keys(user.answers || {}).filter(k => k.startsWith('round3_'));

        if (round3Keys.length === 0) {
            console.log("   (No answers found for Round 4)");
        }

        round3Keys.sort().forEach(key => {
            const ans = user.answers[key];
            console.log(`   🔸 ${key}:`);
            console.log(`      Selected: ${ans.selectedOption}`);
            console.log(`      Time Remaining: ${ans.remainingTime}`);
            console.log(`      Calculated Score: ${ans.calculatedScore}`);
            console.log(`      Processed At: ${ans.processedAt}`);
            // Check if processedAt exists
            if (!ans.processedAt) {
                console.log(`      ⚠️  NOT PROCESSED YET`);
            }
        });

        await mongoose.disconnect();

    } catch (error) {
        console.error("❌ Error:", error);
    }
}

debugUserState();
