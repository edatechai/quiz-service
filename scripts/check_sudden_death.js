import 'dotenv/config';
import mongoose from 'mongoose';
import { GameQuestion } from '../src/models/gameQuestion.model.js';

async function checkSuddenDeath() {
    await mongoose.connect(process.env.MONGODB_URI);

    // Find SUDDEN_DEATH questions
    const suddenDeath = await GameQuestion.find({ questionType: 'SUDDEN_DEATH' }).lean();
    console.log('SUDDEN_DEATH questions found:', suddenDeath.length);
    if (suddenDeath.length > 0) {
        console.log('First SUDDEN_DEATH question:', JSON.stringify(suddenDeath[0], null, 2));
    }

    // Get all types with counts
    const types = await GameQuestion.distinct('questionType');
    console.log('\nAll question types in database:', types);

    // Count each type
    for (const type of types) {
        const count = await GameQuestion.countDocuments({ questionType: type });
        console.log(`  ${type}: ${count}`);
    }

    await mongoose.disconnect();
}

checkSuddenDeath().catch(console.error);
