
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

async function verifyRound4Scoring() {
    console.log("🚀 Starting Round 4 Scoring Verification...");

    try {
        await mongoose.connect(MONGODB_URI);
        console.log("✅ Connected to MongoDB");

        // 1. Cleanup previous test data
        const testSchoolIds = ["test-school-A", "test-school-B", "test-school-C"];
        await GameLeaderboard.deleteMany({ schoolId: { $in: testSchoolIds } });
        console.log("🧹 Cleaned up old test data");

        // 2. Simulate Submissions for Round 4 (Index 3), Question 0
        const round = 3;
        const qIndex = 0;

        // Team A: Option A, 30s remaining
        await gameLeaderboardService.incrementScore({
            schoolId: "test-school-A",
            schoolName: "Test School A",
            teamName: "Team A",
            scoreDelta: 0, // Deferred
            round: round,
            questionIndex: qIndex,
            answerRecord: {
                questionId: "ITB-TEST-01",
                questionPrompt: "Test Question",
                selectedOption: "A",
                correctnessScore: 0, // Not used for ITB
                remainingTime: 30,
                timeTaken: 30, // 60 - 30
                calculatedScore: 0,
                isDeferred: true,
                optionScore: 10 // Mocking the option score usually present in IQ questions? No, wait. 
                // In gameLeaderboardService.js: const baseScore = answer.optionScore || 10;
                // I'll leave it undefined to test default, or set it if needed.
            }
        });

        // Team B: Option A, 40s remaining
        await gameLeaderboardService.incrementScore({
            schoolId: "test-school-B",
            schoolName: "Test School B",
            teamName: "Team B",
            scoreDelta: 0,
            round: round,
            questionIndex: qIndex,
            answerRecord: {
                questionId: "ITB-TEST-01",
                questionPrompt: "Test Question",
                selectedOption: "A",
                correctnessScore: 0,
                remainingTime: 40,
                timeTaken: 20,
                calculatedScore: 0,
                isDeferred: true
            }
        });

        // Team C: Option B, 20s remaining
        await gameLeaderboardService.incrementScore({
            schoolId: "test-school-C",
            schoolName: "Test School C",
            teamName: "Team C",
            scoreDelta: 0,
            round: round,
            questionIndex: qIndex,
            answerRecord: {
                questionId: "ITB-TEST-01",
                questionPrompt: "Test Question",
                selectedOption: "B",
                correctnessScore: 0,
                remainingTime: 20,
                timeTaken: 40,
                calculatedScore: 0,
                isDeferred: true
            }
        });

        console.log("📝 Submitted answers for 3 teams");

        // 3. Process Consensus Scores
        console.log("⚙️  Processing consensus scores...");
        const result = await gameLeaderboardService.processConsensusScores(round, qIndex);
        console.log("✅ Processing result:", result);

        // 4. Verify Results
        console.log("\n📊 Verifying Scores...");
        const teams = await GameLeaderboard.find({ schoolId: { $in: testSchoolIds } }).lean();

        // Expected Logic:
        // Total Teams = 3
        // Option A Count = 2 => Proportion = 2/3 ≈ 0.666...
        // Option B Count = 1 => Proportion = 1/3 ≈ 0.333...
        // Base Score = 10 (default)

        // Expected A: 10 * (2/3) * 30 = 200
        // Expected B: 10 * (2/3) * 40 = 266.67
        // Expected C: 10 * (1/3) * 20 = 66.67

        teams.forEach(team => {
            const answer = team.answers[`round${round}_q${qIndex}`];
            console.log(`\n🏫 ${team.schoolName}:`);
            console.log(`   Selected: ${answer.selectedOption}`);
            console.log(`   Time Remaining: ${answer.remainingTime}`);
            console.log(`   Consensus Proportion: ${answer.consensusProportion}`);
            console.log(`   Calculated Score: ${answer.calculatedScore}`);
            console.log(`   Total Score: ${team.totalScore}`);
        });

        // assertions
        const teamA = teams.find(t => t.schoolId === "test-school-A");
        const teamB = teams.find(t => t.schoolId === "test-school-B");
        const teamC = teams.find(t => t.schoolId === "test-school-C");

        const scoreA = teamA.answers[`round${round}_q${qIndex}`].calculatedScore;
        const scoreB = teamB.answers[`round${round}_q${qIndex}`].calculatedScore;
        const scoreC = teamC.answers[`round${round}_q${qIndex}`].calculatedScore;

        // Allow small floating point diffs
        if (Math.abs(scoreA - 200) < 0.5) console.log("✅ Team A Score Correct");
        else console.error(`❌ Team A Score Incorrect. Expected ~200, got ${scoreA}`);

        if (Math.abs(scoreB - 266.7) < 0.5) console.log("✅ Team B Score Correct");
        else console.error(`❌ Team B Score Incorrect. Expected ~266.7, got ${scoreB}`);

        if (Math.abs(scoreC - 66.7) < 0.5) console.log("✅ Team C Score Correct");
        else console.error(`❌ Team C Score Incorrect. Expected ~66.7, got ${scoreC}`);

        // Cleanup
        await GameLeaderboard.deleteMany({ schoolId: { $in: testSchoolIds } });
        console.log("\n🧹 Cleanup complete");

        await mongoose.disconnect();
    } catch (error) {
        console.error("❌ Error:", error);
    }
}

verifyRound4Scoring();
