
import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { gameLeaderboardService } from "../src/services/gameLeaderboard.service.js";
import { GameLeaderboard } from "../src/models/gameLeaderboard.model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "../.env") });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/edat-quiz";

async function verifySingleUserWithAI() {
    console.log("🚀 Starting Single User + AI Verification...");

    try {
        await mongoose.connect(MONGODB_URI);

        // 1. Cleanup
        const testIds = ["human-user-1", "ai-team-id"];
        await GameLeaderboard.deleteMany({ schoolId: { $in: testIds } });

        const round = 3; // Round 4 (Inside the Box)
        const qIndex = 0;

        // 2. Simulate SINGLE Human User
        // Picks Option A, with 30s remaining
        await gameLeaderboardService.incrementScore({
            schoolId: "human-user-1",
            schoolName: "Human User",
            teamName: "Human Team",
            scoreDelta: 0,
            round: round,
            questionIndex: qIndex,
            answerRecord: {
                questionId: "ITB-TEST-SINGLE",
                questionPrompt: "Test Question",
                selectedOption: "A",
                correctnessScore: 0,
                remainingTime: 30,
                timeTaken: 30,
                calculatedScore: 0,
                isDeferred: true
            }
        });

        // 3. Simulate AI Team (The system uses AI_TEAM_ID usually, but we'll mock it here)
        // AI Picks Option B (Different from user)
        await gameLeaderboardService.incrementScore({
            schoolId: "ai-team-id",
            schoolName: "Edat AI Team",
            teamName: "Edat AI Team",
            scoreDelta: 0,
            round: round,
            questionIndex: qIndex,
            answerRecord: {
                questionId: "ITB-TEST-SINGLE",
                questionPrompt: "Test Question",
                selectedOption: "B",
                correctnessScore: 0,
                remainingTime: 5, // AI answers fast?
                timeTaken: 55,
                calculatedScore: 0,
                isDeferred: true
            }
        });

        console.log("📝 Submitted: 1 Human (Option A), 1 AI (Option B)");

        // 4. Process Consensus
        const result = await gameLeaderboardService.processConsensusScores(round, qIndex);
        console.log("✅ Processing Result:", result);

        // 5. Verify Human Score
        const human = await GameLeaderboard.findOne({ schoolId: "human-user-1" }).lean();
        const ai = await GameLeaderboard.findOne({ schoolId: "ai-team-id" }).lean();

        // Total Teams = 2
        // Human (Opt A): 1 vote / 2 total = 50%
        // AI (Opt B): 1 vote / 2 total = 50%

        // Expected Human Score: 10 * 0.5 * 30 = 150
        // (If AI wasn't there, it would be 10 * 1.0 * 30 = 300)

        const humanScore = human.answers[`round${round}_q${qIndex}`].calculatedScore;
        console.log(`\n👤 Human Score: ${humanScore} (Expected: 150)`);
        console.log(`🤖 AI Score: ${ai.answers[`round${round}_q${qIndex}`].calculatedScore}`);

        if (Math.abs(humanScore - 150) < 0.5) console.log("✅ Consensus works correctly with AI!");
        else console.error(`❌ Unexpected score. Is AI counted?`);

        // Cleanup
        await GameLeaderboard.deleteMany({ schoolId: { $in: testIds } });
        await mongoose.disconnect();

    } catch (error) {
        console.error("❌ Error:", error);
    }
}

verifySingleUserWithAI();
