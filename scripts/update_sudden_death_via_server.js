import "dotenv/config";
import mongoose from "mongoose";
import { connectToDatabase, disconnectFromDatabase } from "../src/config/db.js";

async function updateSuddenDeathViaServer() {
    try {
        // Use the exact same database connection as the server
        await connectToDatabase();
        const db = mongoose.connection.db;
        console.log(`✅ Connected to database: ${db.databaseName}`);

        const options = [
            { text: "None of the above", correctness: 0, score: 0.25, multiplier: 0.25 },
            { text: "30", correctness: 3, score: 1, multiplier: 1 },
            { text: "15", correctness: 6, score: 2, multiplier: 2 },
            { text: "200 plus", correctness: 1.5, score: 0.5, multiplier: 0.5 }
        ];

        console.log("\n📝 Updating options:");
        options.forEach((opt, i) => {
            console.log(`  ${['A', 'B', 'C', 'D'][i]}: "${opt.text}" → multiplier: ${opt.multiplier}, score: ${opt.score}`);
        });

        // Update using raw MongoDB driver (same as server uses)
        const result = await db.collection("gamequestions").findOneAndUpdate(
            { questionType: "SUDDEN_DEATH" },
            {
                $set: {
                    options: options
                }
            },
            { returnDocument: "after" }
        );

        if (result) {
            console.log("\n✅ Updated successfully!");
            
            // Verify
            const savedQuestion = await db.collection("gamequestions").findOne({ questionType: "SUDDEN_DEATH" });
            if (savedQuestion?.options) {
                console.log("\n📥 Verifying saved data:");
                const labels = ["A", "B", "C", "D"];
                savedQuestion.options.forEach((opt, i) => {
                    console.log(`  ${labels[i]}: "${opt.text}" → multiplier: ${opt.multiplier ?? 'MISSING'}, score: ${opt.score ?? 'MISSING'}`);
                });
                
                const allHaveMultipliers = savedQuestion.options.every(opt => opt.multiplier !== undefined);
                if (allHaveMultipliers) {
                    console.log("\n✅ All multipliers saved correctly!");
                } else {
                    console.log("\n❌ ERROR: Some multipliers are missing!");
                }
            }
        } else {
            console.log("\n❌ Question not found. Make sure the server has the SUDDEN_DEATH question.");
        }

        await disconnectFromDatabase();
        console.log("\n✅ Done!");
    } catch (error) {
        console.error("❌ Error:", error);
        process.exit(1);
    }
}

updateSuddenDeathViaServer();

