
import mongoose from 'mongoose';

const MONGO_URL = 'mongodb://localhost:27017/edat-quiz';

async function run() {
    try {
        await mongoose.connect(MONGO_URL);
        console.log('Connected to MongoDB');

        const db = mongoose.connection.db;
        const collection = db.collection('gameleaderboards');

        // 1. Check AI Team
        const aiTeam = await collection.findOne({ schoolId: 'edat-ai-team' });
        console.log('AI Team found:', !!aiTeam);
        if (aiTeam) {
            console.log('AI Team Data:', JSON.stringify(aiTeam, null, 2));
        }

        // 2. Find ANY team with non-empty answers
        const teamsWithAnswers = await collection.find({ answers: { $exists: true, $ne: {} } }).toArray();
        console.log('Teams with non-empty answers:', teamsWithAnswers.length);
        if (teamsWithAnswers.length > 0) {
            console.log('Sample data from team with answers:', JSON.stringify(teamsWithAnswers[0].answers, null, 2));
        }

        // 3. Check for specific Round 4 answers
        const round4Answers = await collection.find({ 'answers.round3_q0': { $exists: true } }).toArray();
        console.log('Teams with Round 4 (index 3) answers:', round4Answers.length);

        // 4. Summarize roundScores
        const allTeams = await collection.find({}).toArray();
        const roundStats = {};
        allTeams.forEach(t => {
            if (t.roundScores) {
                Object.keys(t.roundScores).forEach(r => {
                    roundStats[r] = (roundStats[r] || 0) + 1;
                });
            }
        });
        console.log('Round score entries counts:', roundStats);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

run();
