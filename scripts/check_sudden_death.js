import 'dotenv/config';
import mongoose from 'mongoose';
import { GameQuestion } from '../src/models/gameQuestion.model.js';

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/edat-quiz";

async function checkSuddenDeath() {
    await mongoose.connect(MONGODB_URI);

    // Find SUDDEN_DEATH questions
    const suddenDeath = await GameQuestion.find({ questionType: 'SUDDEN_DEATH' }).lean();
    console.log('\n📊 SUDDEN_DEATH questions found:', suddenDeath.length);
    
    if (suddenDeath.length > 0) {
        const question = suddenDeath[0];
        console.log('\n📝 Question Prompt:');
        console.log('   ', question.prompt);
        
        console.log('\n🎯 Current Round 5 Scoring Configuration:');
        console.log('   ┌─────────────────────────────────────────────────────────────┐');
        console.log('   │ Option │ Text              │ Multiplier │ Formula          │');
        console.log('   ├────────┼────────────────────┼────────────┼──────────────────┤');
        
        const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
        const options = question.options || [];
        
        options.forEach((opt, i) => {
            const label = labels[i] || '?';
            const text = (opt.text || '').padEnd(18);
            const multiplier = (opt.multiplier ?? opt.score ?? 1).toString().padEnd(10);
            const formula = `Total × ${opt.multiplier ?? opt.score ?? 1}`.padEnd(16);
            console.log(`   │   ${label}    │ ${text} │ ${multiplier} │ ${formula} │`);
        });
        
        console.log('   └─────────────────────────────────────────────────────────────┘');
        
        console.log('\n💡 Scoring Formula:');
        console.log('   Final Score = Pre-Round-5 Total Score × Multiplier');
        console.log('\n📋 Example (if pre-Round-5 score is 600):');
        options.forEach((opt, i) => {
            const label = labels[i] || '?';
            const multiplier = opt.multiplier ?? opt.score ?? 1;
            const finalScore = Math.round(600 * multiplier);
            console.log(`   - Option ${label} (${opt.text}): 600 × ${multiplier} = ${finalScore} points`);
        });
    } else {
        console.log('❌ No SUDDEN_DEATH question found in database');
    }

    await mongoose.disconnect();
}

checkSuddenDeath().catch(console.error);
