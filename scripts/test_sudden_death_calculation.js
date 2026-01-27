import 'dotenv/config';
import mongoose from 'mongoose';
import { GameQuestion } from '../src/models/gameQuestion.model.js';

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/edat-quiz";

async function testSuddenDeathCalculation() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log("✅ Connected to MongoDB\n");

        // Get the Sudden Death question using raw MongoDB driver (same as in controller)
        const db = mongoose.connection.db;
        const rawQuestion = await db.collection("gamequestions").findOne({ questionType: "SUDDEN_DEATH" });
        
        if (!rawQuestion) {
            console.log("❌ No SUDDEN_DEATH question found");
            await mongoose.disconnect();
            return;
        }

        console.log("📋 Raw options from database:");
        console.log(JSON.stringify(rawQuestion.options, null, 2));
        console.log("\n");

        const options = rawQuestion.options || [];
        const labels = ["A", "B", "C", "D", "E", "F"];

        // Test with the actual score from the logs: 865 points
        const testPreRound5Score = 865;

        console.log("🧪 Testing Round 5 Calculation Logic:");
        console.log(`   Pre-Round-5 Score: ${testPreRound5Score} points\n`);

        console.log("┌─────────────────────────────────────────────────────────────┐");
        console.log("│ Option │ Text              │ Multiplier │ Final Score     │");
        console.log("├────────┼────────────────────┼────────────┼─────────────────┤");

        options.forEach((opt, i) => {
            const label = labels[i] || '?';
            const text = (opt.text || '').padEnd(18);
            const multiplier = opt.multiplier ?? opt.score ?? 1;
            const finalTotal = Math.round(testPreRound5Score * multiplier * 100) / 100;
            const delta = finalTotal - testPreRound5Score;
            
            const multiplierStr = multiplier.toString().padEnd(10);
            const finalScoreStr = finalTotal.toString().padEnd(15);
            
            console.log(`│   ${label}    │ ${text} │ ${multiplierStr} │ ${finalScoreStr} │`);
        });

        console.log("└─────────────────────────────────────────────────────────────┘\n");

        // Test specific case: Option C (15) should give 865 × 2 = 1730
        const optionC = options.find((opt, i) => labels[i] === "C");
        if (optionC) {
            const multiplier = optionC.multiplier ?? optionC.score ?? 1;
            const finalTotal = Math.round(testPreRound5Score * multiplier * 100) / 100;
            const delta = finalTotal - testPreRound5Score;
            
            console.log("🎯 Specific Test: Option C (15)");
            console.log(`   Expected: 865 × 2 = 1730`);
            console.log(`   Actual:   ${testPreRound5Score} × ${multiplier} = ${finalTotal}`);
            console.log(`   Delta:    ${delta >= 0 ? '+' : ''}${delta}`);
            
            if (multiplier === 2 && finalTotal === 1730) {
                console.log("   ✅ PASS: Calculation is correct!\n");
            } else {
                console.log(`   ❌ FAIL: Expected multiplier=2, got ${multiplier}`);
                console.log(`   ❌ FAIL: Expected finalTotal=1730, got ${finalTotal}\n`);
            }
        }

        // Verify all multipliers are present
        console.log("🔍 Verifying multipliers are present:");
        let allHaveMultipliers = true;
        options.forEach((opt, i) => {
            const label = labels[i] || '?';
            if (opt.multiplier === undefined) {
                console.log(`   ❌ Option ${label} (${opt.text}): multiplier is undefined`);
                allHaveMultipliers = false;
            } else {
                console.log(`   ✅ Option ${label} (${opt.text}): multiplier = ${opt.multiplier}`);
            }
        });

        if (allHaveMultipliers) {
            console.log("\n✅ All options have multipliers defined!");
        } else {
            console.log("\n❌ Some options are missing multipliers!");
        }

        await mongoose.disconnect();
        console.log("\n✅ Test completed!");
    } catch (error) {
        console.error("❌ Error:", error);
        process.exit(1);
    }
}

testSuddenDeathCalculation();

