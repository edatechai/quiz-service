import mongoose from "mongoose";
import dotenv from "dotenv";
import { GameLeaderboard } from "../src/models/gameLeaderboard.model.js";
import { gameLeaderboardService } from "../src/services/gameLeaderboard.service.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, "../.env") });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/edat-quiz";

async function testConsensusScoring() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log("Connected to MongoDB");

        const round = 0;
        const questionIndex = 0;
        const answerKey = `answers.round${round}_q${questionIndex}`;

        // 1. Clear existing answers for this question
        console.log("Clearing existing answers...");
        await GameLeaderboard.updateMany(
            {},
            { $unset: { [answerKey]: "" } }
        );

        // 2. Simulate submissions
        console.log("Simulating submissions...");
        const submissions = [
            { schoolId: "team_a", schoolName: "Team A", selectedOption: "Option-1", remainingTime: 20 },
            { schoolId: "team_b", schoolName: "Team B", selectedOption: "Option-1", remainingTime: 10 },
            { schoolId: "team_c", schoolName: "Team C", selectedOption: "Option-2", remainingTime: 15 },
        ];

        for (const sub of submissions) {
            await gameLeaderboardService.incrementScore({
                schoolId: sub.schoolId,
                schoolName: sub.schoolName,
                teamName: sub.schoolName,
                scoreDelta: 0, // Deferred scoring
                round,
                questionIndex,
                answerRecord: {
                    questionId: "test_q_1",
                    questionPrompt: "Test Question",
                    selectedOption: sub.selectedOption,
                    correctnessScore: 0,
                    remainingTime: sub.remainingTime,
                    timeTaken: 30 - sub.remainingTime,
                    calculatedScore: 0,
                    isDeferred: true,
                }
            });
        }

        // 3. Run consensus calculation
        console.log("Running consensus calculation...");
        const result = await gameLeaderboardService.processConsensusScores(round, questionIndex);
        console.log("Calculation result:", result);

        // 4. Verify scores
        console.log("Verifying scores...");
        const teams = await GameLeaderboard.find({
            schoolId: { $in: ["team_a", "team_b", "team_c"] }
        }).lean();

        const teamA = teams.find(t => t.schoolId === "team_a");
        const teamB = teams.find(t => t.schoolId === "team_b");
        const teamC = teams.find(t => t.schoolId === "team_c");

        // Expected:
        // Total Answers: 3
        // Option-1 Count: 2 -> Proportion: 0.666...
        // Option-2 Count: 1 -> Proportion: 0.333...

        // Team A: 20 * (2/3) = 13.33 -> 13.3
        // Team B: 10 * (2/3) = 6.66 -> 6.7
        // Team C: 15 * (1/3) = 5.0

        const scoreA = teamA.answers[`round${round}_q${questionIndex}`].calculatedScore;
        const scoreB = teamB.answers[`round${round}_q${questionIndex}`].calculatedScore;
        const scoreC = teamC.answers[`round${round}_q${questionIndex}`].calculatedScore;

        console.log(`Team A Score: ${scoreA} (Expected ~13.3)`);
        console.log(`Team B Score: ${scoreB} (Expected ~6.7)`);
        console.log(`Team C Score: ${scoreC} (Expected ~5.0)`);

        if (Math.abs(scoreA - 13.3) < 0.2 && Math.abs(scoreB - 6.7) < 0.2 && Math.abs(scoreC - 5.0) < 0.2) {
            console.log("✅ TEST PASSED: Scores match expected values.");
        } else {
            console.error("❌ TEST FAILED: Scores do not match.");
        }

        await mongoose.disconnect();
        console.log("Disconnected from MongoDB");
    } catch (error) {
        console.error("Error running test:", error);
        process.exit(1);
    }
}

testConsensusScoring();
