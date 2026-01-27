import mongoose from "mongoose";
import "dotenv/config";

const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/edat-quiz";
console.log("Connecting to:", uri.substring(0, 30) + "...");

mongoose.connect(uri).then(async () => {
    console.log("Connected!");
    const db = mongoose.connection.db;

    // Get all users
    const users = await db.collection("gameleaderboards").find({}).toArray();
    console.log("\n=== LEADERBOARD ===");
    console.log("Total users:", users.length);

    for (const u of users) {
        console.log("\n-------------------");
        console.log("School:", u.schoolName || u.schoolId);
        console.log("Total Score:", u.totalScore);
        console.log("Round Scores:", JSON.stringify(u.roundScores || {}));

        // Check Round 4 (index 3) answers specifically
        const r4Answers = Object.keys(u.answers || {}).filter(k => k.startsWith("round3_"));
        console.log("Round 4 Answers:", r4Answers.length);

        for (const key of r4Answers) {
            const ans = u.answers[key];
            console.log(`  ${key}:`);
            console.log(`    Selected: ${ans.selectedOption}`);
            console.log(`    Remaining Time: ${ans.remainingTime}s`);
            console.log(`    Calculated Score: ${ans.calculatedScore}`);
            console.log(`    Processed: ${ans.processedAt ? "YES" : "NO"}`);
            if (ans.consensusProportion !== undefined) {
                console.log(`    Consensus %: ${(ans.consensusProportion * 100).toFixed(1)}%`);
            }
        }
    }

    await mongoose.disconnect();
    process.exit(0);
}).catch(e => {
    console.error("Error:", e.message);
    process.exit(1);
});
