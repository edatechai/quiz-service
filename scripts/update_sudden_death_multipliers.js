import "dotenv/config";
import mongoose from "mongoose";

// Use the same MongoDB URI as the server
// The server connects to "production" database, so we need to match that
// You can override this by setting MONGODB_URI environment variable
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URL || "mongodb://127.0.0.1:27017/production";

async function updateSuddenDeathMultipliers() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log("Connected to MongoDB");
        const db = mongoose.connection.db;
        console.log(`Database name: ${db.databaseName}`);

        // Use raw MongoDB driver to ensure all fields are saved correctly
        const options = [
            { text: "None of the above", correctness: 0, score: 0.25, multiplier: 0.25 },
            { text: "30", correctness: 3, score: 1, multiplier: 1 },
            { text: "15", correctness: 6, score: 2, multiplier: 2 },
            { text: "200 plus", correctness: 1.5, score: 0.5, multiplier: 0.5 }
        ];

        console.log("\n📝 Updating options with raw MongoDB driver:");
        options.forEach((opt, i) => {
            console.log(`  ${['A', 'B', 'C', 'D'][i]}: "${opt.text}" → multiplier: ${opt.multiplier}, score: ${opt.score}`);
        });

        // First check if question exists
        const existingQuestion = await db.collection("gamequestions").findOne({ questionType: "SUDDEN_DEATH" });
        if (!existingQuestion) {
            console.log("\n⚠️  SUDDEN_DEATH question not found in database!");
            console.log("   Checking what question types exist...");
            const allTypes = await db.collection("gamequestions").distinct("questionType");
            console.log(`   Found question types: ${allTypes.join(", ")}`);
            
            // Try to find by other criteria
            const anySuddenDeath = await db.collection("gamequestions").findOne({ 
                $or: [
                    { "meta.isSuddenDeath": true },
                    { questionType: { $regex: /sudden/i } }
                ]
            });
            if (anySuddenDeath) {
                console.log(`\n   Found question with ID: ${anySuddenDeath._id}`);
                console.log(`   Question type: ${anySuddenDeath.questionType}`);
                console.log(`   Will update this question...`);
            } else {
                console.log("\n❌ No Sudden Death question found. Please create it first.");
                await mongoose.disconnect();
                return;
            }
        }

        // Update using raw MongoDB driver
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
            console.log("\n✅ Updated Sudden Death multipliers using raw MongoDB driver");
            console.log(`📥 Verifying saved data:`);
            const savedQuestion = await db.collection("gamequestions").findOne({ questionType: "SUDDEN_DEATH" });
            
            if (savedQuestion?.options) {
                const labels = ["A", "B", "C", "D"];
                savedQuestion.options.forEach((opt, i) => {
                    console.log(`  ${labels[i]}: "${opt.text}" → multiplier: ${opt.multiplier ?? 'MISSING'}, score: ${opt.score ?? 'MISSING'}`);
                });
                
                // Verify all multipliers are present
                const allHaveMultipliers = savedQuestion.options.every(opt => opt.multiplier !== undefined);
                if (allHaveMultipliers) {
                    console.log("\n✅ All options have multiplier fields saved correctly!");
                } else {
                    console.log("\n❌ ERROR: Some options are missing multiplier fields!");
                }
            }
            
            console.log("\nNew scoring formula: Final Score = Pre-Round-5 Total × multiplier");
            console.log("  - Option A (None of the above): Score × 0.25 = 25% of score");
            console.log("  - Option B (30): Score × 1 = Keep same score");
            console.log("  - Option C (15): Score × 2 = Double score");
            console.log("  - Option D (200 plus): Score × 0.5 = Half score");
        } else {
            console.log("❌ Sudden Death question not found");
        }

        await mongoose.disconnect();
        console.log("\nDone!");
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
}

updateSuddenDeathMultipliers();
