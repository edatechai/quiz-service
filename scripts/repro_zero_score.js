
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

async function reproZeroScore() {
    console.log("🚀 Starting Zero Score Reproduction...");

    try {
        await mongoose.connect(MONGODB_URI);

        const testId = "repro-user-zero";
        await GameLeaderboard.deleteMany({ schoolId: testId });

        const round = 3;
        const qIndex = 0;

        // 1. Simulate Batch Submission (sets roundScores = 0 initially)
        // Using updateRoundScore which happens in submitRound
        await gameLeaderboardService.recordScore({
            schoolId: testId,
            schoolName: "Repro School",
            score: 0,
            meta: { roundIndex: round }
        });
        // Specifically set roundScore to 0 as submitRound does
        await gameLeaderboardService.updateRoundScore(testId, round, 0);

        // Add the answer (deferred)
        await GameLeaderboard.updateOne(
            { schoolId: testId },
            {
                $set: {
                    [`answers.round${round}_q${qIndex}`]: {
                        selectedOption: "A",
                        remainingTime: 30,
                        optionScore: 10,
                        isDeferred: true,
                        calculatedScore: 0
                    }
                }
            }
        );

        console.log("📝 Initial state: Round Score = 0, Answer = Deferred");

        // 2. Process Consensus
        // This calculates score (e.g. 10 * 1.0 * 30 = 300)
        // It should update totalScore AND roundScores theoretically
        const result = await gameLeaderboardService.processConsensusScores(round, qIndex);
        console.log(`⚙️  Processed consensus:`, result);

        // 3. Get Summary
        const summary = await gameLeaderboardService.getRoundSummary(round);
        const myRank = summary.rankings.find(r => r.schoolId === testId);

        console.log(`\n📊 Summary Result:`);
        console.log(`   Round Score: ${myRank.roundScore} (Expected: 300)`);
        console.log(`   Total Score: ${myRank.totalScore} (Expected: 300)`);

        if (myRank.roundScore === 0) {
            console.error("❌ BUG REPRODUCED: Round Score is 0");
        } else if (myRank.roundScore === 300) {
            console.log("✅ FIXED: Round Score is 300");
        } else {
            console.log(`❓ Strange result: ${myRank.roundScore}`);
        }

        // Cleanup
        await GameLeaderboard.deleteMany({ schoolId: testId });
        await mongoose.disconnect();

    } catch (error) {
        console.error("❌ Error:", error);
    }
}

reproZeroScore();
